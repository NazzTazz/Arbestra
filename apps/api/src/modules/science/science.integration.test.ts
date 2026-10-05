import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import type { Database } from '../../database/schema.js';
import { beginVillageEconomy, reconcileVillageEconomy, type VillageEconomy } from '../villages/reconcile-economy.js';
import { admitScience, scienceCommand, scienceSnapshot } from './service.js';
import { SCIENCE_PROGRAMS } from './programs.js';
import { getTerrain, getTerrainUpdates } from '../worlds/terrain.js';
import { wakeScience } from './worker.js';
import { getTerrainVillages } from '../worlds/terrain-villages.js';
import { constructBuilding, getVillageState, getStoneDepositDetails } from '../villages/service.js';

const url = testDatabaseUrl(), db = createDatabase(url), rollback = new Error('science fixture rollback');
beforeAll(async () => { await migrateToLatest(url); await resetE2eState(url); });
afterAll(() => db.destroy());
async function fixture(run: (tx: Transaction<Database>, economy: VillageEconomy, campusId: string) => Promise<void>) {
  await expect(db.transaction().execute(async tx => {
    const economy = await beginVillageEconomy(tx, ids.world, ids.village);
    const campus = await tx.insertInto('buildings').values({ worldId: ids.world, villageId: ids.village, buildingType: 'university', level: 1,
      targetLevel: null, status: 'completed', constructionStartedAt: null, constructionCompletesAt: null, completedAt: economy.through }).returning('id').executeTakeFirstOrThrow();
    await tx.updateTable('populationCohorts').set({ energy: 10, energyProgress: 0, energyUpdatedAt: economy.through, activity: 'idle',
      restingSince: null, harvestId: null, extractionId: null, scienceActivityId: null, restBuildingId: null }).where('worldId', '=', ids.world).where('villageId', '=', ids.village).execute();
    await admitScience(tx, economy);
    await run(tx, economy, campus.id); throw rollback;
  })).rejects.toBe(rollback);
}
async function grant(tx: Transaction<Database>, economy: VillageEconomy, code: string) {
  const p = SCIENCE_PROGRAMS.find(p => p.code === code)!;
  await tx.insertInto('sciencePrograms').values({ worldId: ids.world, accountId: ids.account, code, discipline: p.discipline, level: p.level,
    createdAt: economy.through, acquiredAt: economy.through, paused: false, workDoneMs: p.workRequiredMs, workerCap: 1 }).execute();
}
async function finishBatch(tx: Transaction<Database>, economy: VillageEconomy) {
  const batch = await tx.selectFrom('scienceActivities').selectAll().where('worldId', '=', economy.worldId).where('villageId', '=', economy.villageId)
    .where('status', '=', 'in-progress').orderBy('completesAt').executeTakeFirstOrThrow();
  const next = { ...economy, through: batch.completesAt };
  await reconcileVillageEconomy(tx, next); return next;
}
async function finishProgram(tx: Transaction<Database>, economy: VillageEconomy, code: string, target: 'acquired' | 'waiting-data') {
  let next = economy;
  for (let i = 0; i < 80; i++) {
    const program = (await scienceSnapshot(tx, next)).programs.find(p => p.code === code)!;
    if (program.status === target) return next;
    await admitScience(tx, next); next = await finishBatch(tx, next); await admitScience(tx, next);
  }
  throw new Error('Science progression did not reach its bounded target');
}

it('uses real people and one centre, finishes once, shares mastery between villages without giving it to another player', async () => {
  await fixture(async (tx, economy, campusId) => {
    await scienceCommand(tx, economy, { action: 'research', buildingId: campusId, programCode: 'mathematics-1', workerCount: 5 });
    await admitScience(tx, economy);
    let state = await scienceSnapshot(tx, economy);
    expect(state.levels.mathematics).toBe(0); expect(state.universities[0]?.occupiedCentres).toBe(1);
    const assigned = await tx.selectFrom('populationCohorts').select('memberCount').where('worldId', '=', ids.world).where('scienceActivityId', 'is not', null).execute();
    expect(assigned.reduce((n, c) => n + c.memberCount, 0)).toBe(5);
    await scienceCommand(tx, economy, { action: 'research', buildingId: campusId, programCode: 'geography-1', workerCount: 5 });
    await admitScience(tx, economy); expect((await scienceSnapshot(tx, economy)).activities).toHaveLength(1);
    const next = await finishProgram(tx, economy, 'mathematics-1', 'acquired'); await reconcileVillageEconomy(tx, next);
    state = await scienceSnapshot(tx, next); expect(state.levels.mathematics).toBe(1);
    expect(Number((await tx.selectFrom('sciencePrograms').select('workDoneMs').where('worldId', '=', ids.world).where('code', '=', 'mathematics-1').executeTakeFirstOrThrow()).workDoneMs)).toBe(600000);
    const secondId = randomUUID(); await tx.insertInto('villages').values({ id: secondId, worldId: ids.world, ownerAccountId: ids.account, name: 'Autre campus', anchorCellX: 1030, anchorCellY: 512 }).execute();
    const second = await beginVillageEconomy(tx, ids.world, secondId);
    expect((await scienceSnapshot(tx, second)).levels.mathematics).toBe(1);
    const accountId = randomUUID(); await tx.insertInto('accounts').values({ id: accountId, email: `${accountId}@test.local`, passwordHash: 'fixture' }).execute();
    await tx.insertInto('worldMemberships').values({ worldId: ids.world, accountId, playerName: 'Autre joueur' }).execute();
    const otherId = randomUUID(); await tx.insertInto('villages').values({ id: otherId, worldId: ids.world, ownerAccountId: accountId, name: 'Autre civilisation', anchorCellX: 1040, anchorCellY: 512 }).execute();
    expect((await scienceSnapshot(tx, await beginVillageEconomy(tx, ids.world, otherId))).levels.mathematics).toBe(0);
  });
});

it('constructs one University with a thirty-cell footprint, charges its catalogue cost once, and grants no mastery', async()=>{
  await fixture(async(tx)=>{
    const inside={transaction:()=>({execute:<T>(run:(tx:Transaction<Database>)=>Promise<T>)=>run(tx)})} as unknown as Kysely<Database>;
    await tx.updateTable('villageResources').set({amount:1000}).where('worldId','=',ids.world).where('villageId','=',ids.village).where('resourceCode','=','stone').execute();
    const before=await getVillageState(inside,ids.account,'aube');
    const free=new Set(before.cells.filter(c=>c.canBuild).map(c=>`${c.cellX}:${c.cellY}`));
    const site=before.cells.find(c=>[-2,-1,0,1,2].every(dx=>[-2,-1,0,1,2,3].every(dy=>free.has(`${c.cellX+dx}:${c.cellY+dy}`))));
    expect(site).toBeDefined();
    const after=await constructBuilding(inside,ids.account,'aube',ids.village,site!.cellX,site!.cellY,'university',0);
    const building=after.cells.find(c=>c.cellX===site!.cellX&&c.cellY===site!.cellY)!.building!;
    expect(building.type).toBe('university');
    expect(await tx.selectFrom('worldCellOccupancies').select('cellX').where('worldId','=',ids.world).where('buildingId','=',building.id).execute()).toHaveLength(30);
    expect(after.science!.levels).toEqual({mathematics:0,geography:0,astronomy:0});
    expect(after.village.resources.find(r=>r.code==='stone')!.amount).toBe(700);
    expect(after.village.resources.find(r=>r.code==='wood')!.amount).toBe(before.village.resources.find(r=>r.code==='wood')!.amount-500);
  });
});

it('keeps theory at 75 percent, releases means, and respects a manual pause when evidence returns', async () => {
  await fixture(async (tx, economy, campusId) => {
    await grant(tx, economy, 'mathematics-1'); await grant(tx, economy, 'mathematics-2');
    await scienceCommand(tx, economy, { action: 'research', buildingId: campusId, programCode: 'mathematics-3', workerCount: 5 });
    await admitScience(tx, economy); const next = await finishProgram(tx, economy, 'mathematics-3', 'waiting-data');
    let state = await scienceSnapshot(tx, next); const p = state.programs.find(p => p.code === 'mathematics-3')!;
    expect(p.status).toBe('waiting-data'); expect(p.workDoneMs).toBe(p.workRequiredMs * .75); expect(state.activities).toHaveLength(0);
    expect(await tx.selectFrom('scheduledTasks').select('id').where('worldId','=',ids.world).where('taskType','=','science.wake').where('subjectId','=',ids.village).execute()).toHaveLength(0);
    await scienceCommand(tx, next, { action: 'pause', programCode: p.code });
    await tx.updateTable('sciencePlaces').set({ surveyed: true }).where('worldId', '=', ids.world).where('accountId', '=', ids.account)
      .where('cellY', '=', 512).where('cellX', 'in', [1026, 1027]).execute();
    await admitScience(tx, next); state = await scienceSnapshot(tx, next);
    expect(state.activities).toHaveLength(0); expect(state.programs.find(p => p.code === 'mathematics-3')!.status).toBe('paused');
    await scienceCommand(tx, next, { action: 'resume', programCode: 'mathematics-3' }); await admitScience(tx, next);
    expect((await scienceSnapshot(tx, next)).activities).toHaveLength(1);
    const done = await finishProgram(tx, next, 'mathematics-3', 'acquired'); expect((await scienceSnapshot(tx, done)).levels.mathematics).toBe(3);
  });
});

it('keeps training durable and reports a survey only on its return, including its reserved return time', async () => {
  await fixture(async (tx, economy, campusId) => {
    await grant(tx, economy, 'geography-1');
    await scienceCommand(tx, economy, { action: 'train', buildingId: campusId });
    const trained = await finishBatch(tx, economy);
    expect((await scienceSnapshot(tx, trained)).cartographers).toBe(1);
    await scienceCommand(tx, trained, { action: 'survey', target: { cellX: 1026, cellY: 512 }, budgetSeconds: 120 });
    let state = await scienceSnapshot(tx, trained); expect(state.surveyedPlaces).toBe(0);
    const mission = state.activities[0]!;
    expect(Date.parse(mission.completesAt) - Date.parse(mission.startedAt)).toBe(64000);
    const returned = await finishBatch(tx, trained); state = await scienceSnapshot(tx, returned);
    expect(state.surveyedPlaces).toBe(1); expect(state.cartographers).toBe(1); expect(state.activities).toHaveLength(0);
    expect((await tx.selectFrom('populationCohorts').select('scienceActivityId').where('cartographer', '=', true).where('worldId', '=', ids.world).executeTakeFirstOrThrow()).scienceActivityId).toBeNull();
  });
});

it('starts astronomy spontaneously only after a real 24 hour observation window and never starts a duplicate', async () => {
  await fixture(async (tx, economy) => {
    for (const code of ['mathematics-1', 'mathematics-2', 'mathematics-3', 'geography-1', 'geography-2']) await grant(tx, economy, code);
    await admitScience(tx, economy); expect((await scienceSnapshot(tx, economy)).activities).toHaveLength(0);
    const later = { ...economy, through: new Date(economy.through.getTime() + 24 * 3600000) };
    // Ready habitants; the observation window remains genuine, not shortened by a renderer clock.
    await tx.updateTable('populationCohorts').set({ energy: 10, energyUpdatedAt: later.through }).where('worldId', '=', ids.world).where('villageId', '=', ids.village).execute();
    await admitScience(tx, later); await admitScience(tx, later);
    const state = await scienceSnapshot(tx, later); expect(state.solarObservations.complete).toBe(true);
    expect(state.activities.filter(a => a.programCode === 'astronomy-1')).toHaveLength(1);
    expect(state.activities[0]?.workerCount).toBe(1); expect(state.globalModelAvailable).toBe(false);
    const report = (await tx.selectFrom('playerScience').select('solarReport').where('worldId', '=', ids.world).where('accountId', '=', ids.account).executeTakeFirstOrThrow()).solarReport!;
    expect(typeof report.dayFraction).toBe('number'); expect(Number(report.dayFraction)).toBeGreaterThanOrEqual(0);
  });
});

it('shows remote landscape without acquiring science or exposing deposit amounts', async () => {
  const before = await db.selectFrom('sciencePlaces').selectAll().where('worldId', '=', ids.world).where('accountId', '=', ids.account).execute();
  const remote = await getTerrain(db, ids.account, 'aube', '0,0');
  expect(remote.chunks[0]?.terrainCodes.every(code => code > 0)).toBe(true);
  expect(remote.chunks[0]!.features.length).toBeGreaterThan(0);
  expect(remote.chunks[0]?.features.every(f => f.deposit === null)).toBe(true);
  expect(remote.chunks[0]?.occupiedCells).toEqual([]);
  const updates = await getTerrainUpdates(db, ids.account, 'aube', '0,0');
  expect(updates.chunks[0]!.features).toEqual(remote.chunks[0]!.features);
  const full = await getTerrain(db, ids.account, 'aube', '0,0', true);
  const deposit = full.chunks[0]!.features.find(f => f.deposit)!;
  expect(deposit).toBeDefined();
  await expect(getStoneDepositDetails(db, ids.account, 'aube', ids.village, deposit.id)).rejects.toMatchObject({ code: 'DEPOSIT_NOT_FOUND' });
  expect(await db.selectFrom('sciencePlaces').selectAll().where('worldId', '=', ids.world).where('accountId', '=', ids.account).execute()).toEqual(before);
});

it('keeps a discovered village as a dated report after its live buildings change', async () => {
  const accountId = randomUUID(), villageId = randomUUID();
  try {
    await db.insertInto('accounts').values({ id:accountId,email:`${accountId}@test.local`,passwordHash:'fixture' }).execute();
    await db.insertInto('worldMemberships').values({worldId:ids.world,accountId,playerName:'Rapport daté'}).execute();
    await db.insertInto('villages').values({id:villageId,worldId:ids.world,ownerAccountId:accountId,name:'Village inconnu',anchorCellX:1028,anchorCellY:512}).execute();
    await db.insertInto('playerScience').values({worldId:ids.world,accountId:ids.account,observationsSince:null,solarReport:null}).execute();
    const world=await db.selectFrom('worlds').select(['id','widthCells','heightCells','chunkSize','generationVersion']).where('id','=',ids.world).executeTakeFirstOrThrow();
    const unknown = (await getTerrainVillages(db,world,1024,512,ids.account)).villages.find(v=>v.anchorCellX===1028)!;
    expect(unknown).toEqual({ anchorCellX:1028, anchorCellY:512, blocks:[] });
    await db.insertInto('scienceVillageReports').values({worldId:ids.world,accountId:ids.account,villageId,name:'Nom relevé',anchorCellX:1028,anchorCellY:512,
      observedAt:new Date(),blocks:JSON.stringify([{x:0,y:0,width:1,depth:1,garden:false}])}).execute();
    const building=await db.insertInto('buildings').values({worldId:ids.world,villageId,buildingType:'dwelling',level:1,status:'completed',targetLevel:null,
      constructionStartedAt:null,constructionCompletesAt:null,completedAt:new Date()}).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('worldCellOccupancies').values({worldId:ids.world,buildingId:building.id,featureId:null,pendingExpansionId:null,cellX:1028,cellY:512,role:'anchor'}).execute();
    const reported=(await getTerrainVillages(db,world,1024,512,ids.account)).villages.find(v=>v.id===villageId)!;
    expect(reported.blocks).toEqual([{x:0,y:0,width:1,depth:1,garden:false}]);
    await db.updateTable('villages').set({name:'Nom ultérieur'}).where('id','=',villageId).execute();
    await db.deleteFrom('worldCellOccupancies').where('buildingId','=',building.id).execute();
    await db.insertInto('worldCellOccupancies').values({worldId:ids.world,buildingId:building.id,featureId:null,pendingExpansionId:null,cellX:1029,cellY:512,role:'anchor'}).execute();
    expect((await getTerrainVillages(db,world,1024,512,ids.account)).villages.find(v=>v.id===villageId)?.blocks).toEqual(reported.blocks);
    const terrain=await getTerrain(db,ids.account,'aube','32,16');
    expect(terrain.chunks[0]!.occupiedCells.some(c=>c.cellX===1029&&c.cellY===512)).toBe(false);
  } finally {
    await db.deleteFrom('scienceVillageReports').where('worldId','=',ids.world).where('accountId','=',ids.account).where('villageId','=',villageId).execute();
    await db.deleteFrom('playerScience').where('worldId','=',ids.world).where('accountId','=',ids.account).execute();
    await db.deleteFrom('buildings').where('worldId','=',ids.world).where('villageId','=',villageId).execute();
    await db.deleteFrom('villages').where('worldId','=',ids.world).where('id','=',villageId).execute();
    await db.deleteFrom('accounts').where('id','=',accountId).execute();
  }
});

it('the science worker honors an engaged deadline and starts the next batch at its current boundary', async () => {
  await fixture(async(tx,economy,campusId)=>{
    const earlier={...economy,through:new Date(economy.through.getTime()-120000)};
    await tx.updateTable('populationCohorts').set({energyUpdatedAt:earlier.through}).where('worldId','=',ids.world).where('villageId','=',ids.village).execute();
    await scienceCommand(tx,earlier,{action:'research',buildingId:campusId,programCode:'mathematics-1',workerCount:5});
    await admitScience(tx,earlier);
    const task=await tx.selectFrom('scheduledTasks').selectAll().where('worldId','=',ids.world).where('taskType','=','science.wake').orderBy('dueAt').executeTakeFirstOrThrow();
    await wakeScience(tx,task);
    const program=await tx.selectFrom('sciencePrograms').select('workDoneMs').where('worldId','=',ids.world).where('code','=','mathematics-1').executeTakeFirstOrThrow();
    expect(Number(program.workDoneMs)).toBe(300000);
    const next=await tx.selectFrom('scienceActivities').selectAll().where('worldId','=',ids.world).where('status','=','in-progress').executeTakeFirstOrThrow();
    expect(next.startedAt.getTime()).toBeGreaterThanOrEqual(economy.through.getTime());
    // A handler does not acknowledge any notification; only the scheduler does.
    expect((await tx.selectFrom('scheduledTasks').select('completedAt').where('id','=',task.id).executeTakeFirstOrThrow()).completedAt).toBeNull();
  });
});

it('serializes two campuses at the player latch and never exceeds the shared worker cap', async () => {
  const accountId=randomUUID(), villages=[randomUUID(),randomUUID()], campuses:string[]=[];
  let release!:()=>void, entered!:()=>void, blocked!:()=>void;
  const releasePromise=new Promise<void>(r=>{release=r;}), enteredPromise=new Promise<void>(r=>{entered=r;}), blockedPromise=new Promise<void>(r=>{blocked=r;});
  const bounded=async<T>(promise:Promise<T>)=>{let timer!:ReturnType<typeof setTimeout>;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('science barrier timeout')),15000);})]);}finally{clearTimeout(timer);}};
  let a:Promise<void>|undefined,b:Promise<void>|undefined,pidA=0,pidB=0;
  try{
    await db.insertInto('accounts').values({id:accountId,email:`${accountId}@test.local`,passwordHash:'fixture'}).execute();
    await db.insertInto('worldMemberships').values({worldId:ids.world,accountId,playerName:'Deux campus'}).execute();
    for(const [i,villageId] of villages.entries()){
      await db.insertInto('villages').values({id:villageId,worldId:ids.world,ownerAccountId:accountId,name:'Campus',anchorCellX:150+i*600,anchorCellY:100}).execute();
      const campus=await db.insertInto('buildings').values({worldId:ids.world,villageId,buildingType:'university',level:1,status:'completed',targetLevel:null,
        constructionStartedAt:null,constructionCompletesAt:null,completedAt:new Date()}).returning('id').executeTakeFirstOrThrow();campuses.push(campus.id);
      await db.insertInto('populationCohorts').values({worldId:ids.world,villageId,originVillageId:villageId,memberCount:10,activity:'idle',energy:10,energyProgress:0,
        energyUpdatedAt:new Date(),restingSince:null,foodUsedSinceRest:0,harvestId:null,extractionId:null}).execute();
      await db.transaction().execute(async tx=>{const economy=await beginVillageEconomy(tx,ids.world,villageId);await admitScience(tx,economy);
        await scienceCommand(tx,economy,{action:'research',buildingId:campus.id,programCode:'mathematics-1',workerCount:7});});
    }
    a=db.transaction().execute(async tx=>{await sql`set local lock_timeout='12s'`.execute(tx);pidA=(await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;
      const economy=await beginVillageEconomy(tx,ids.world,villages[0]!);await admitScience(tx,economy);entered();await bounded(releasePromise);});void a.catch(()=>undefined);
    await bounded(enteredPromise);
    b=db.transaction().execute(async tx=>{await sql`set local lock_timeout='12s'`.execute(tx);pidB=(await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;
      const economy=await beginVillageEconomy(tx,ids.world,villages[1]!);blocked();await admitScience(tx,economy);});void b.catch(()=>undefined);
    await bounded(blockedPromise);
    const deadline=Date.now()+10000;let observed=false;
    while(Date.now()<deadline){if((await db.selectNoFrom(sql<boolean>`${pidA}=any(pg_blocking_pids(${pidB}))`.as('waiting')).executeTakeFirstOrThrow()).waiting){observed=true;break;}await new Promise(r=>setTimeout(r,20));}
    expect(observed).toBe(true);release();await bounded(Promise.all([a,b]));
    const activities=await db.selectFrom('scienceActivities').select(['workerCount','workMs']).where('worldId','=',ids.world).where('accountId','=',accountId).where('status','=','in-progress').execute();
    expect(activities).toHaveLength(2);expect(activities.map(a=>a.workerCount).sort()).toEqual([2,5]);
    expect(activities.reduce((n,a)=>n+Number(a.workMs),0)).toBe(420000);
  }finally{
    release();await Promise.allSettled([...(a?[a]:[]),...(b?[b]:[])]);
    await db.deleteFrom('scheduledTasks').where('worldId','=',ids.world).where(sql<string>`payload->>'villageId'`,'in',villages).execute();
    await db.deleteFrom('populationCohorts').where('worldId','=',ids.world).where('villageId','in',villages).execute();
    await db.deleteFrom('sciencePlaces').where('worldId','=',ids.world).where('accountId','=',accountId).execute();
    await db.deleteFrom('scienceActivities').where('worldId','=',ids.world).where('accountId','=',accountId).execute();
    await db.deleteFrom('buildings').where('worldId','=',ids.world).where('villageId','in',villages).execute();
    await db.deleteFrom('villages').where('worldId','=',ids.world).where('id','in',villages).execute();
    await db.deleteFrom('accounts').where('id','=',accountId).execute();
  }
});
