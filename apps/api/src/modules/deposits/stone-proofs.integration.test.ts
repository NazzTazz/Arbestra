import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { buildApp } from '../../app.js';
import { migrateToLatest } from '../../database/migrate.js';
import { up as migrateStone, validateStoneDepositBackfill } from '../../database/migrations/012_stone_deposit_extractions.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import type { Database } from '../../database/schema.js';
import { DEVELOPMENT_IDS } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { processNextScheduledTask } from '../../jobs/scheduled-tasks.js';
import { completeStoneExtraction } from '../villages/complete-construction.js';
import { beginVillageEconomy, reconcileVillageEconomy } from '../villages/reconcile-economy.js';
import { constructBuilding, feedPopulation, getStoneDepositDetails, getVillageState, harvestGarden, restPopulation, startVillageStoneExtraction } from '../villages/service.js';
import { advanceEnergy } from '../population/energy.js';
import { materializeCohorts, energyState } from '../population/work.js';
import { startGardenHarvest } from '../population/garden-harvest.js';
import { generateWorld } from '../worlds/generation.js';
import { COMPLETE_STONE_EXTRACTION_TASK, startStoneExtraction } from './stone-extractions.js';

const databaseUrl = testDatabaseUrl(), worldId = DEVELOPMENT_IDS.world, villageId: string = DEVELOPMENT_IDS.village;
const otherVillage = '30000000-0000-4000-8000-000000000002', otherAccount = '10000000-0000-4000-8000-000000000002';
const handlers = { [COMPLETE_STONE_EXTRACTION_TASK]: completeStoneExtraction };
const village = (id = villageId) => ({ worldId, villageId: id, widthCells: 2048, heightCells: 1024 });
let db: Kysely<Database>, t0: Date;
const fixtureIds: string[] = [];

function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('stone barrier timeout')), 7000); })]); }
  finally { clearTimeout(timer); }
}
function inside(tx: Transaction<Database>): Kysely<Database> {
  return { transaction: () => ({ execute: <T>(run: (transaction: Transaction<Database>) => Promise<T>) => run(tx) }) } as unknown as Kysely<Database>;
}
async function backend(tx: Transaction<Database>) {
  await sql`set local lock_timeout = '6s'`.execute(tx);
  return (await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;
}
async function blocked(waiter: number, blocker: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = await db.selectNoFrom(sql<boolean>`${blocker} = any(pg_blocking_pids(${waiter}))`.as('blocked')).executeTakeFirstOrThrow();
    if (row.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected PostgreSQL lock wait was not observed');
}
async function lockVillage(tx: Transaction<Database>, id = villageId) {
  await tx.selectFrom('villages').select('id').where('worldId', '=', worldId).where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
}
async function lockStone(tx: Transaction<Database>, id: string) {
  await tx.selectFrom('stoneDeposits').select('featureId').where('worldId', '=', worldId).where('featureId', '=', id).forUpdate().executeTakeFirstOrThrow();
}
async function stone(amount = 1000, cellX = 1024, cellY = 514) {
  const id = randomUUID(); fixtureIds.push(id);
  await db.insertInto('worldFeatures').values({ id, worldId, featureTypeCode: 'stone_outcrop', state: 'available', variantSeed: 42 }).execute();
  await db.insertInto('worldCellOccupancies').values({ worldId, featureId: id, buildingId: null, pendingExpansionId: null, cellX, cellY, role: 'body' }).execute();
  await db.insertInto('stoneDeposits').values({ worldId, featureId: id, cellX, cellY, initialAmount: amount, remainingAmount: amount,
    reservedAmount: 0, revision: 1, updatedAt: t0 }).execute();
  return id;
}
async function start(id: string, count = 1, owner = villageId, through = t0) {
  return db.transaction().execute(async (tx) => {
    await lockVillage(tx, owner); await lockStone(tx, id);
    return startStoneExtraction(tx, village(owner), { worldId, villageId: owner, through }, id, randomUUID(), count);
  });
}
async function settle(through: Date, owner = villageId) {
  return db.transaction().execute(async (tx) => {
    await lockVillage(tx, owner);
    const ids = await tx.selectFrom('depositExtractions').select('featureId').where('worldId', '=', worldId)
      .where('villageId', '=', owner).where('status', '=', 'in-progress').where('completesAt', '<=', through).orderBy('featureId').execute();
    for (const { featureId } of ids) await lockStone(tx, featureId);
    await reconcileVillageEconomy(tx, { worldId, villageId: owner, through });
  });
}
async function rows() {
  return { deposits: await db.selectFrom('stoneDeposits').selectAll().where('featureId', 'in', fixtureIds).orderBy('featureId').execute(),
    works: await db.selectFrom('depositExtractions').selectAll().where('worldId', '=', worldId).orderBy('id').execute(),
    cohorts: await db.selectFrom('populationCohorts').selectAll().where('worldId', '=', worldId).orderBy('id').execute(),
    stock: await db.selectFrom('villageResources').selectAll().where('worldId', '=', worldId).orderBy('villageId').orderBy('resourceCode').execute(),
    occupancy: await db.selectFrom('worldCellOccupancies').selectAll().where('featureId', 'in', fixtureIds).orderBy('featureId').execute() };
}
async function stock(owner = villageId) {
  return Number((await db.selectFrom('villageResources').select('amount').where('worldId', '=', worldId)
    .where('villageId', '=', owner).where('resourceCode', '=', 'stone').executeTakeFirstOrThrow()).amount);
}
async function secondVillage() {
  await db.insertInto('accounts').values({ id: otherAccount, email: 'stone-tests@arbestra.local', passwordHash: 'unused' }).execute();
  await db.insertInto('worldMemberships').values({ accountId: otherAccount, worldId, playerName: 'Stone test' }).execute();
  await db.insertInto('villages').values({ id: otherVillage, worldId, ownerAccountId: otherAccount, name: 'Other', anchorCellX: 1025, anchorCellY: 512 }).execute();
  const building = await db.insertInto('buildings').values({ worldId, villageId: otherVillage, buildingType: 'town-hall', level: 1, targetLevel: null,
    status: 'completed', constructionStartedAt: null, constructionCompletesAt: null, completedAt: t0 }).returning('id').executeTakeFirstOrThrow();
  await db.insertInto('worldCellOccupancies').values({ worldId, buildingId: building.id, featureId: null, pendingExpansionId: null, cellX: 1025, cellY: 512, role: 'anchor' }).execute();
  await db.insertInto('villageResources').values(['wood','carrot','stone'].map((resourceCode) => ({ worldId, villageId: otherVillage, resourceCode, amount: 0 }))).execute();
  await db.insertInto('villageResourceFlows').values({ worldId, villageId: otherVillage, resourceCode: 'wood', baseRatePerHour: 60, remainder: 0, productionUpdatedAt: t0 }).execute();
  await db.insertInto('populationCohorts').values({ worldId, villageId: otherVillage, originVillageId: otherVillage, memberCount: 15,
    activity: 'idle', energy: 10, energyProgress: 0, energyUpdatedAt: t0, restingSince: null, foodUsedSinceRest: 0, harvestId: null, extractionId: null }).execute();
}

describe.sequential('stone regression proofs', () => {
  beforeAll(async () => { await migrateToLatest(databaseUrl); db = createDatabase(databaseUrl); });
  beforeEach(async () => {
    await resetE2eState(databaseUrl); t0 = new Date(Date.now() - 3600000);
    // Also restores the resource removed by the legacy rollback test.
    await db.insertInto('villageResources').values({ worldId, villageId, resourceCode: 'stone', amount: 0 }).onConflict((c) => c.columns(['worldId','villageId','resourceCode']).doUpdateSet({ amount: 0 })).execute();
    await db.updateTable('populationCohorts').set({ energyUpdatedAt: t0 }).where('worldId', '=', worldId).execute();
  });
  afterEach(async () => {
    await sql`drop trigger if exists test_stone_credit on village_resources; drop function if exists test_stone_credit();`.execute(db);
    await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
    await db.deleteFrom('depositExtractions').where('worldId', '=', worldId).execute();
    await db.deleteFrom('villages').where('id', '=', otherVillage).execute();
    await db.deleteFrom('worldMemberships').where('accountId', '=', otherAccount).execute();
    await db.deleteFrom('accounts').where('id', '=', otherAccount).execute();
    if (fixtureIds.length) {
      await db.deleteFrom('stoneDeposits').where('featureId', 'in', fixtureIds).execute();
      await db.deleteFrom('worldFeatures').where('id', 'in', fixtureIds).execute(); fixtureIds.length = 0;
    }
  });
  afterAll(async () => { await resetE2eState(databaseUrl); await db.destroy(); });

  it('A/G: applies D inclusively, never D-1, and spends exactly ten working minutes', async () => {
    const id = await stone(), workId = await start(id), due = new Date(t0.getTime() + 600000);
    await settle(new Date(due.getTime() - 1)); expect(await stock()).toBe(0);
    await settle(due); expect(await stock()).toBe(100);
    const all = await rows(); expect(all.deposits[0]).toMatchObject({ remainingAmount: '900', reservedAmount: '0' });
    expect(all.works[0]).toMatchObject({ id: workId, status: 'completed', completedAt: due });
    expect(all.cohorts.find((cohort) => cohort.memberCount === 1)).toMatchObject({ activity: 'idle', energy: 9, energyProgress: 66000000,
      energyUpdatedAt: due, extractionId: null, originVillageId: villageId });
    expect(all.cohorts.reduce((n, cohort) => n + cohort.memberCount, 0)).toBe(15);
  });

  it('B/J: depleted tombstones free their cell and expose consistent eligibility', async () => {
    const id = await stone(50);
    await expect(constructBuilding(db, DEVELOPMENT_IDS.account, 'aube', villageId, 1024, 514, 'dwelling', 0)).rejects.toBeDefined();
    await start(id); await settle(new Date(t0.getTime() + 600000));
    const snapshot = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube'); expect(await stock()).toBe(50);
    expect(snapshot.region.features.find((feature) => feature.id === id)?.deposit).toMatchObject({ state: 'depleted', remainingAmount: 0, reservedAmount: 0, revision: 3 });
    expect(snapshot.cells.find((cell) => cell.cellX === 1024 && cell.cellY === 514)?.canBuild).toBe(true);
    const detail = await getStoneDepositDetails(db, DEVELOPMENT_IDS.account, 'aube', villageId, id);
    expect(detail.eligibility.workerOptions.every((option) => !option.canStart && option.reasonCode === 'DEPOSIT_DEPLETED')).toBe(true);
    await constructBuilding(db, DEVELOPMENT_IDS.account, 'aube', villageId, 1024, 514, 'dwelling', 0);
  });

  it.each([[100,false],[150,false],[150,true]] as const)('C/I: two villages wait on a shared %i-stone reserve (chronological finish: %s)', async (amount, chronological) => {
    await secondVillage(); const id = await stone(amount);
    const held = gate(), release = gate(), entered = gate(); let pidA = 0, pidB = 0;
    const a = db.transaction().execute(async (tx) => {
      pidA = await backend(tx); const result = await startVillageStoneExtraction(inside(tx), DEVELOPMENT_IDS.account, 'aube', villageId, id, randomUUID(), 1);
      held.resolve(); await bounded(release.promise); return result;
    }); void a.catch(() => undefined); let b: Promise<unknown> | undefined;
    try {
      await bounded(held.promise);
      b = db.transaction().execute(async (tx) => { pidB = await backend(tx); entered.resolve();
        return startVillageStoneExtraction(inside(tx), otherAccount, 'aube', otherVillage, id, randomUUID(), 1); });
      void b.catch(() => undefined); await bounded(entered.promise); await blocked(pidB, pidA); release.resolve(); await bounded(a);
      if (amount === 100) await expect(b).rejects.toMatchObject({ code: 'DEPOSIT_FULLY_COMMITTED' }); else await bounded(b);
    } finally { release.resolve(); await Promise.allSettled([a, ...(b ? [b] : [])]); }
    const works = (await rows()).works, due = new Date(Math.max(...works.map((work) => work.completesAt.getTime())));
    await db.updateTable('depositExtractions').set({ completesAt: due }).where('worldId', '=', worldId).execute();
    if(chronological){await settle(due);await settle(due,otherVillage);}
    else {await settle(due, otherVillage); await settle(due);}
    expect(await stock()).toBe(100); expect(await stock(otherVillage)).toBe(amount - 100);
    expect((await rows()).deposits[0]).toMatchObject({ remainingAmount: '0', reservedAmount: '0' });
    for (const owner of [villageId, otherVillage]) {
      const cohorts = (await rows()).cohorts.filter((cohort) => cohort.villageId === owner);
      expect(cohorts.reduce((n, cohort) => n + cohort.memberCount, 0)).toBe(15);
      expect(cohorts.every((cohort) => cohort.originVillageId === owner && cohort.extractionId === null)).toBe(true);
    }
  });

  it('D: repeated handlers wait on the village and apply exactly once', async () => {
    const id = await stone(), work = await start(id);
    const task = await db.selectFrom('scheduledTasks').selectAll().where('subjectId', '=', work).executeTakeFirstOrThrow();
    const held = gate(), release = gate(), entered = gate(); let pidA = 0, pidB = 0;
    const a = db.transaction().execute(async (tx) => { pidA = await backend(tx); await completeStoneExtraction(tx, task); held.resolve(); await bounded(release.promise); });
    void a.catch(() => undefined); let b: Promise<void> | undefined;
    try {
      await bounded(held.promise);
      b = db.transaction().execute(async (tx) => { pidB = await backend(tx); entered.resolve(); await completeStoneExtraction(tx, task); });
      void b.catch(() => undefined); await bounded(entered.promise); await blocked(pidB, pidA); release.resolve(); await bounded(Promise.all([a,b]));
    } finally { release.resolve(); await Promise.allSettled([a, ...(b ? [b] : [])]); }
    expect(await stock()).toBe(100); expect((await rows()).deposits[0]).toMatchObject({ remainingAmount: '900', reservedAmount: '0', revision: '3' });
  });

  it('D/K: a worker holding an old task cannot block a new extraction; SKIP LOCKED acquires a distinct task', async () => {
    const id = await stone(), oldWork = await start(id); await settle(new Date(t0.getTime() + 600000));
    const held = gate(), release = gate(); let oldTaskId = '';
    const worker = processNextScheduledTask(db, { [COMPLETE_STONE_EXTRACTION_TASK]: async (tx, task) => {
      await backend(tx); oldTaskId = task.id; expect(task.subjectId).toBe(oldWork); held.resolve(); await bounded(release.promise); await completeStoneExtraction(tx, task);
    } }); void worker.catch(() => undefined);
    try {
      await bounded(held.promise);
      const next = await bounded(startVillageStoneExtraction(db, DEVELOPMENT_IDS.account, 'aube', villageId, id, randomUUID(), 1));
      expect(next.extraction.id).not.toBe(oldWork);
      // Duplicate an already-due business notification while the first row remains locked.
      const secondWork = await start(id, 1, villageId, new Date(Date.now() - 1000));
      await db.updateTable('depositExtractions').set({ startedAt: t0, completesAt: new Date(t0.getTime()+600000) }).where('id','=',secondWork).execute();
      await db.updateTable('scheduledTasks').set({ dueAt: t0, availableAt: t0 }).where('subjectId','=',secondWork).execute();
      const second = await bounded(processNextScheduledTask(db, handlers));
      expect(second?.taskId).not.toBe(oldTaskId); expect(second?.outcome).toBe('completed');
      release.resolve(); expect((await bounded(worker))?.outcome).toBe('completed'); expect(await stock()).toBe(200);
    } finally { release.resolve(); await worker; }
  });

  it('E: HTTP retry returns the same work before/after completion and rejects extra fields', async () => {
    const id = await stone();
    const app = await buildApp({ databaseUrl, host: '127.0.0.1', port: 0, isProduction: false, cookieName: 'test_session',
      sessionTtlDays: 1, constructionDurationOverrideMs: 0, scheduledTaskPollIntervalMs: 250 }, db);
    try {
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'player@arbestra.local', password: 'arbestra' } });
      const cookies = { test_session: login.cookies[0]!.value }, url = `/api/worlds/aube/villages/${villageId}/features/${id}/extractions`;
      const payload = { commandId: randomUUID(), workerCount: 2 };
      const first = await app.inject({ method: 'POST', url, cookies, payload }); expect(first.statusCode, first.body).toBe(200);
      const retry = await app.inject({ method: 'POST', url, cookies, payload }); expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json().extraction.id).toBe(first.json().extraction.id); await settle(new Date(first.json().extraction.completesAt));
      const done = await app.inject({ method: 'POST', url, cookies, payload }); expect(done.statusCode, done.body).toBe(200);
      expect(done.json().extraction).toMatchObject({ id: first.json().extraction.id, status: 'completed' });
      expect(await stock()).toBe(100); expect((await rows()).works).toHaveLength(1);
      expect((await app.inject({ method: 'POST', url, cookies, payload: { ...payload, workerCount: 1 } })).json().code).toBe('COMMAND_ID_CONFLICT');
      for (const body of [undefined, { ...payload, workerCount: 0 }, { ...payload, quantity: 1000 }]) {
        const result = await app.inject({ method: 'POST', url, cookies, ...(body ? { payload: body } : {}) }); expect(result.statusCode, result.body).toBe(400);
      }
    } finally { await app.close(); }
  });

  it('F: debit observed before injected credit failure, all rows rolled back, delayed retry credits once', async () => {
    const id = await stone(); await start(id); const before = await rows();
    // The UUID is locally generated. The trigger observes the debit inside the failing transaction.
    await sql`create function test_stone_credit() returns trigger language plpgsql as $$
      declare r bigint; s bigint;
      begin
        if NEW.resource_code = 'stone' then
          select remaining_amount, reserved_amount into r,s from stone_deposits where feature_id = '${sql.raw(id)}'::uuid;
          if r <> 900 or s <> 0 then raise exception 'debit was not observed'; end if;
          raise exception 'injected after observed R900 S0 before credit';
        end if; return NEW;
      end $$;
      create trigger test_stone_credit before update on village_resources for each row execute function test_stone_credit();`.execute(db);
    const result = await processNextScheduledTask(db, handlers, 60000); expect(result?.outcome).toBe('retry-scheduled');
    const task = await db.selectFrom('scheduledTasks').selectAll().where('id', '=', result!.taskId).executeTakeFirstOrThrow();
    expect(task.lastError).toContain('injected after observed R900 S0 before credit'); expect(task.attempts).toBe(1);
    expect(await rows()).toEqual(before); expect(await processNextScheduledTask(db, handlers)).toBeNull();
    await sql`drop trigger test_stone_credit on village_resources; drop function test_stone_credit();`.execute(db);
    await db.updateTable('scheduledTasks').set({ availableAt: t0 }).where('id', '=', task.id).execute();
    expect((await processNextScheduledTask(db, handlers))?.outcome).toBe('completed'); expect(await stock()).toBe(100);
  });

  it('H: a feature outside the snapshot is accepted by world reach, not by viewport membership', async () => {
    const id = await stone(1000,1080,512);
    const building = await db.insertInto('buildings').values({ worldId, villageId, buildingType: 'dwelling', level: 1, targetLevel: null,
      status: 'completed', completedAt: t0, constructionStartedAt: null, constructionCompletesAt: null }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('worldCellOccupancies').values({ worldId, buildingId: building.id, featureId: null, pendingExpansionId: null, cellX:1079,cellY:512,role:'anchor' }).execute();
    expect((await getVillageState(db, DEVELOPMENT_IDS.account, 'aube')).region.features.some((feature) => feature.id === id)).toBe(false);
    const accepted = await startVillageStoneExtraction(db, DEVELOPMENT_IDS.account, 'aube', villageId,id,randomUUID(),1);
    expect(accepted.deposit.featureId).toBe(id); expect(accepted.extraction.cellX).toBe(1080);
    await db.updateTable('buildings').set({ status:'under-construction',completedAt:null,constructionStartedAt:new Date(),constructionCompletesAt:new Date(Date.now()+60000) }).where('id','=',building.id).execute();
    await expect(startVillageStoneExtraction(db,DEVELOPMENT_IDS.account,'aube',villageId,id,randomUUID(),1)).rejects.toMatchObject({code:'DEPOSIT_OUT_OF_RANGE'});
  });

  it('L: opposite due orders across villages acquire shared deposits in UUID order', async () => {
    await secondVillage(); const ids = [await stone(),await stone(1000,1026,514)].sort();
    await start(ids[0]!,2); await start(ids[1]!,1); await start(ids[1]!,2,otherVillage); await start(ids[0]!,1,otherVillage);
    const held=gate(), release=gate(), entered=gate(); let pidA=0,pidB=0;
    const a=db.transaction().execute(async(tx)=>{pidA=await backend(tx);await lockVillage(tx);await lockStone(tx,ids[0]!);held.resolve();
      await bounded(release.promise);await beginVillageEconomy(tx,worldId,villageId,ids[1]);});void a.catch(()=>undefined);let b:Promise<unknown>|undefined;
    try{await bounded(held.promise);b=db.transaction().execute(async(tx)=>{pidB=await backend(tx);entered.resolve();return beginVillageEconomy(tx,worldId,otherVillage);});
      void b.catch(()=>undefined);await bounded(entered.promise);await blocked(pidB,pidA);release.resolve();await bounded(Promise.all([a,b]));
    }finally{release.resolve();await Promise.allSettled([a,...(b?[b]:[])]);}
    expect(await stock()).toBe(200);expect(await stock(otherVillage)).toBe(200);
    expect((await rows()).deposits.every(row=>row.remainingAmount==='800'&&row.reservedAmount==='0')).toBe(true);
  });

  it.each([0,1,-1])('M: exact sufficiency at a work boundary (%i quantum)',async(quantum)=>{
    const id=await stone();await db.updateTable('populationCohorts').set({energy:0,energyProgress:13200000+quantum}).where('worldId','=',worldId).execute();
    if(quantum<0){const before=await rows();await expect(start(id)).rejects.toMatchObject({code:'WORKERS_UNAVAILABLE'});expect(await rows()).toEqual(before);return;}
    await start(id);const due=new Date(t0.getTime()+600000);await settle(due);
    const worker=(await rows()).cohorts.find(row=>row.memberCount===1)!;expect(worker.activity).toBe(quantum===0?'resting':'idle');expect(worker.energyProgress).toBe(quantum);
    const initial=energyState(worker),end=new Date(due.getTime()+100*3600000);let stepped=initial;
    for(let hour=1;hour<=100;hour++)stepped=advanceEnergy(stepped,new Date(due.getTime()+hour*3600000));
    expect(advanceEnergy(initial,end)).toEqual(stepped);expect((await rows()).cohorts.reduce((n,row)=>n+row.memberCount,0)).toBe(15);
  });

  it('N: an island opens from the outer boundary',async()=>{
    const grid=new Map<string,string>();for(let x=1023;x<=1025;x++)for(let y=514;y<=516;y++)grid.set(`${x}:${y}`,await stone(100,x,y));
    const centre=grid.get('1024:515')!,edge=grid.get('1024:514')!;
    await expect(start(centre)).rejects.toMatchObject({code:'DEPOSIT_INTERIOR'});await start(edge);await settle(new Date(t0.getTime()+600000));
    await start(centre,1,villageId,new Date(t0.getTime()+600000));expect((await rows()).works).toHaveLength(2);
  });

  it('M: extraction and garden share workers, block meals/rest while working, and details project energy to H', async () => {
    const built = await constructBuilding(db, DEVELOPMENT_IDS.account, 'aube', villageId, 1024, 512, 'garden', 0);
    const gardenId = built.cells.find(cell => cell.building?.type === 'garden')!.building!.id;
    await db.updateTable('buildingResourceBuffers').set({ storedAmount:100, productionUpdatedAt:t0 }).where('buildingId','=',gardenId).execute();
    await db.updateTable('populationCohorts').set({energyUpdatedAt:t0}).where('worldId','=',worldId).execute();
    const id=await stone();
    await db.transaction().execute(async tx => { await lockVillage(tx); await startGardenHarvest(tx,worldId,villageId,gardenId,randomUUID(),t0); });
    await start(id,10);
    await expect(start(id,5)).rejects.toMatchObject({code:'WORKERS_UNAVAILABLE'});
    await start(id,4);
    // Keep both works in the future for interactive exclusion checks.
    const future = new Date(Date.now()+600000);
    await db.updateTable('depositExtractions').set({completesAt:future}).where('worldId','=',worldId).execute();
    await db.updateTable('gardenHarvests').set({completesAt:future}).where('worldId','=',worldId).execute();
    const otherGarden=await constructBuilding(db,DEVELOPMENT_IDS.account,'aube',villageId,1025,513,'garden',0);
    const otherGardenId=otherGarden.cells.find(cell=>cell.building?.type==='garden'&&cell.building.id!==gardenId)!.building!.id;
    await db.updateTable('buildingResourceBuffers').set({storedAmount:100}).where('buildingId','=',otherGardenId).execute();
    await expect(harvestGarden(db,DEVELOPMENT_IDS.account,'aube',villageId,otherGardenId)).rejects.toMatchObject({code:'HARVESTERS_UNAVAILABLE'});
    await expect(feedPopulation(db,DEVELOPMENT_IDS.account,'aube',villageId,randomUUID(),1)).rejects.toMatchObject({code:'POPULATION_FOOD_UNAVAILABLE'});
    await expect(restPopulation(db,DEVELOPMENT_IDS.account,'aube',villageId,randomUUID(),1)).rejects.toMatchObject({code:'POPULATION_REST_UNAVAILABLE'});
    const unavailable=await getStoneDepositDetails(db,DEVELOPMENT_IDS.account,'aube',villageId,id);
    expect(unavailable.eligibility.workerOptions.every(option=>!option.canStart)).toBe(true);
    // Releasing every group leaves fifteen people; past-rest eligibility must be projected,
    // not decided from the stored resting activity.
    await settle(future);
    await db.updateTable('populationCohorts').set({activity:'resting',energy:0,energyProgress:0,
      energyUpdatedAt:new Date(Date.now()-6*3600000),restingSince:new Date(Date.now()-6*3600000)}).where('worldId','=',worldId).execute();
    const rested=await getStoneDepositDetails(db,DEVELOPMENT_IDS.account,'aube',villageId,id);
    expect(rested.eligibility.workerOptions[1]).toMatchObject({availableWorkers:15,canStart:true});
    expect((await rows()).cohorts.reduce((total,row)=>total+row.memberCount,0)).toBe(15);
  });

  it('G: mixed construction, garden and stone deadlines match a chronological execution including exact energy', async () => {
    const garden = await constructBuilding(db,DEVELOPMENT_IDS.account,'aube',villageId,1024,512,'garden',0);
    const gardenId=garden.cells.find(cell=>cell.building?.type==='garden')!.building!.id;
    const saw = await constructBuilding(db,DEVELOPMENT_IDS.account,'aube',villageId,1023,513,'sawmill',60000);
    const sawId=saw.cells.find(cell=>cell.building?.type==='sawmill')!.building!.id;
    await db.updateTable('buildings').set({constructionStartedAt:t0,constructionCompletesAt:new Date(t0.getTime()+30000)}).where('id','=',sawId).execute();
    await db.updateTable('populationCohorts').set({energyUpdatedAt:t0}).where('worldId','=',worldId).execute();
    await db.updateTable('villageResourceFlows').set({productionUpdatedAt:t0}).where('worldId','=',worldId).execute();
    await db.updateTable('buildingResourceBuffers').set({storedAmount:100,productionUpdatedAt:t0,remainder:0.25}).where('buildingId','=',gardenId).execute();
    const id=await stone();
    await db.transaction().execute(async tx=>{await lockVillage(tx);await startGardenHarvest(tx,worldId,villageId,gardenId,randomUUID(),t0);});
    await start(id,10); // Same D as the garden.
    await start(id,1,villageId,new Date(t0.getTime()+1)); // H+1 stays active.
    const end=new Date(t0.getTime()+600000);
    await db.transaction().execute(async tx=>{
      await lockVillage(tx);await lockStone(tx,id);
      const capture=async()=>({cohorts:await tx.selectFrom('populationCohorts').selectAll().where('worldId','=',worldId).orderBy('id').execute(),
        stocks:await tx.selectFrom('villageResources').selectAll().where('worldId','=',worldId).orderBy('resourceCode').execute(),
        flows:await tx.selectFrom('villageResourceFlows').selectAll().where('worldId','=',worldId).orderBy('resourceCode').execute(),
        deposits:await tx.selectFrom('stoneDeposits').select(['remainingAmount','reservedAmount','revision']).where('featureId','=',id).execute(),
        works:await tx.selectFrom('depositExtractions').selectAll().where('worldId','=',worldId).orderBy('id').execute()});
      await sql`savepoint chronological_reference`.execute(tx);
      for(const ms of [30000,60000,600000])await reconcileVillageEconomy(tx,{worldId,villageId,through:new Date(t0.getTime()+ms)});
      await materializeCohorts(tx,worldId,villageId,end);const reference=await capture();
      await sql`rollback to savepoint chronological_reference`.execute(tx);
      await reconcileVillageEconomy(tx,{worldId,villageId,through:end});await materializeCohorts(tx,worldId,villageId,end);
      expect(await capture()).toEqual(reference);
      expect(reference.works.filter(work=>work.status==='in-progress')).toHaveLength(1);
    });
    expect(await stock()).toBe(100);
  });

  it('G: an old transaction reads its boundary after waiting on the village',async()=>{
    const id=await stone();const held=gate(),opened=gate(),release=gate();let pidA=0,pidB=0;let oldTime=new Date(0),unlockedAt=new Date(0);
    const a=db.transaction().execute(async tx=>{pidA=await backend(tx);await lockVillage(tx);held.resolve();await bounded(release.promise);
      unlockedAt=(await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('at')).executeTakeFirstOrThrow()).at;});void a.catch(()=>undefined);
    let b:ReturnType<typeof startVillageStoneExtraction>|undefined;
    try{await bounded(held.promise);b=db.transaction().execute(async tx=>{pidB=await backend(tx);oldTime=(await tx.selectNoFrom(sql<Date>`transaction_timestamp()`.as('at')).executeTakeFirstOrThrow()).at;opened.resolve();
      return startVillageStoneExtraction(inside(tx),DEVELOPMENT_IDS.account,'aube',villageId,id,randomUUID(),1);});void b.catch(()=>undefined);
      await bounded(opened.promise);await blocked(pidB,pidA);release.resolve();await bounded(a);const result=await bounded(b);
      expect(Date.parse(result.villageState.serverTime)).toBeGreaterThanOrEqual(unlockedAt.getTime());
      expect(Date.parse(result.extraction.startedAt)).toBeGreaterThan(oldTime.getTime());
      expect(result.extraction.startedAt).toBe(result.villageState.serverTime);
    }finally{release.resolve();await Promise.allSettled([a,...(b?[b]:[])]);}
  });

  it('N/H: protected clearings reject extraction, toroidal reach succeeds, other-world lookup fails',async()=>{
    const clearing=await db.selectFrom('worldClearings').selectAll().where('worldId','=',worldId).where('status','=','protected').executeTakeFirstOrThrow();
    const protectedId=await stone(1000,clearing.centerCellX,clearing.centerCellY);
    const building=await db.insertInto('buildings').values({worldId,villageId,buildingType:'dwelling',level:1,targetLevel:null,status:'completed',completedAt:t0,constructionStartedAt:null,constructionCompletesAt:null}).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('worldCellOccupancies').values({worldId,buildingId:building.id,featureId:null,pendingExpansionId:null,cellX:clearing.centerCellX+1,cellY:clearing.centerCellY,role:'anchor'}).execute();
    await expect(startVillageStoneExtraction(db,DEVELOPMENT_IDS.account,'aube',villageId,protectedId,randomUUID(),1)).rejects.toMatchObject({code:'DEPOSIT_PROTECTED'});
    const edgeId=await stone(1000,2047,0);
    await db.insertInto('worldCellOccupancies').values({worldId,buildingId:building.id,featureId:null,pendingExpansionId:null,cellX:0,cellY:0,role:'body'}).execute();
    expect((await startVillageStoneExtraction(db,DEVELOPMENT_IDS.account,'aube',villageId,edgeId,randomUUID(),1)).deposit.cellX).toBe(2047);
    await db.transaction().execute(async tx=>{await expect(startStoneExtraction(tx,{...village(),worldId:randomUUID()},
      {worldId:randomUUID(),villageId,through:t0},edgeId,randomUUID(),1)).rejects.toMatchObject({code:'DEPOSIT_NOT_FOUND'});});
  });

  it('migration preflight refuses ambiguous feature positions without mutations',async()=>{
    const id=await stone();await validateStoneDepositBackfill(db as unknown as Kysely<unknown>);
    await db.insertInto('worldCellOccupancies').values({worldId,featureId:id,buildingId:null,pendingExpansionId:null,cellX:1024,cellY:515,role:'body'}).execute();
    const before=await rows();await expect(validateStoneDepositBackfill(db as unknown as Kysely<unknown>)).rejects.toThrow('one available cell');expect(await rows()).toEqual(before);
  });

  it('migration 012 backfills deterministically in an isolated schema without changing existing stocks or world',async()=>{
    await stone();const before=await rows();const schema='stone_migration_'+randomUUID().replaceAll('-','');
    const rollback=new Error('rollback isolated migration schema');
    await expect(db.transaction().execute(async tx=>{
      await sql`create schema ${sql.id(schema)}`.execute(tx);
      await sql`set local search_path to ${sql.id(schema)}, public`.execute(tx);
      await sql`create table population_cohorts(world_id uuid, village_id uuid, harvest_id uuid)`.execute(tx);
      await migrateStone(tx as unknown as Kysely<unknown>);
      const result=await sql<{count:string;invalid:string}>`select count(*) as count,
        count(*) filter(where d.initial_amount <> 750 + mod(abs(f.variant_seed::bigint),501)
          or d.remaining_amount<>d.initial_amount or d.reserved_amount<>0) as invalid
        from stone_deposits d join public.world_features f on f.world_id=d.world_id and f.id=d.feature_id`.execute(tx);
      expect(Number(result.rows[0]!.count)).toBeGreaterThan(100);expect(result.rows[0]!.invalid).toBe('0');
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await rows()).toEqual(before);
  });

  it('H: a wrapped snapshot never leaks features from another world',async()=>{
    const rollback=new Error('rollback cross-world fixture');
    await expect(db.transaction().execute(async tx=>{
      const otherWorld=randomUUID(), featureId=randomUUID();
      await tx.insertInto('worlds').values({id:otherWorld,slug:'stone-world-isolation',name:'Other world',topology:'torus',widthCells:2048,heightCells:1024,chunkSize:32,seed:1}).execute();
      await tx.insertInto('worldFeatures').values({id:featureId,worldId:otherWorld,featureTypeCode:'woodland',state:'available',variantSeed:42}).execute();
      await tx.insertInto('worldCellOccupancies').values({worldId:otherWorld,featureId,buildingId:null,pendingExpansionId:null,cellX:0,cellY:0,role:'body'}).execute();
      await tx.updateTable('villages').set({anchorCellX:0,anchorCellY:0}).where('id','=',villageId).execute();
      const snapshot=await getVillageState(inside(tx),DEVELOPMENT_IDS.account,'aube');
      expect(snapshot.region.features.some(feature=>feature.id===featureId)).toBe(false);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it('new worlds generate stable 750..1250 deposits and a ready world is never replenished',async()=>{
    const rollback=new Error('rollback generated test worlds');
    await expect(db.transaction().execute(async tx=>{
      const worlds=[randomUUID(),randomUUID()];const results:unknown[]=[];
      for(const id of worlds){
        await tx.insertInto('worlds').values({id,slug:id,name:'Generation proof',topology:'torus',widthCells:128,heightCells:128,chunkSize:32,seed:12}).execute();
        await generateWorld(tx,id);
        const deposits=await tx.selectFrom('stoneDeposits').select(['cellX','cellY','initialAmount','remainingAmount']).where('worldId','=',id).orderBy('cellX').orderBy('cellY').execute();
        expect(deposits.length).toBeGreaterThan(0);
        expect(deposits.every(row=>Number(row.initialAmount)>=750&&Number(row.initialAmount)<=1250&&row.remainingAmount===row.initialAmount)).toBe(true);
        results.push(deposits);
      }
      expect(results[0]).toEqual(results[1]);
      await tx.updateTable('stoneDeposits').set({remainingAmount:sql`remaining_amount-1`}).where('worldId','=',worlds[0]!).execute();
      const before=await tx.selectFrom('stoneDeposits').selectAll().where('worldId','=',worlds[0]!).orderBy('featureId').execute();
      await generateWorld(tx,worlds[0]!);
      expect(await tx.selectFrom('stoneDeposits').selectAll().where('worldId','=',worlds[0]!).orderBy('featureId').execute()).toEqual(before);
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
