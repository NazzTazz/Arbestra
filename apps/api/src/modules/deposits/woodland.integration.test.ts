import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Database } from '../../database/schema.js';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS } from '../../database/seed.js';
import { clearWoodland, materializeWoodland } from './woodland.js';
import { completeStoneExtractionAt, readStoneDeposit, startStoneExtraction } from './stone-extractions.js';
import { beginVillageEconomy } from '../villages/reconcile-economy.js';
import { getStoneDepositDetails, startVillageStoneExtraction, clearVillageWoodland } from '../villages/service.js';
import { getTerrainUpdates } from '../worlds/terrain.js';
import { completeGardenHarvestAt } from '../population/garden-harvest.js';
import { assignWorkers, eligibleWorkers, materializeCohorts } from '../population/work.js';

const url = testDatabaseUrl(), db = createDatabase(url), worldId = DEVELOPMENT_IDS.world, villageId = DEVELOPMENT_IDS.village;
beforeAll(async () => { await migrateToLatest(url); await resetE2eState(url); });
afterAll(() => db.destroy());
const rollback = new Error('woodland fixture rollback');

async function fixture(run: (tx: Transaction<Database>, id: string, t: Date) => Promise<void>, amount = 300) {
  try {
    await db.transaction().execute(async tx => {
      await tx.selectFrom('villages').select('id').where('id', '=', villageId).forUpdate().executeTakeFirstOrThrow();
      const t = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
      const id = randomUUID();
      await tx.insertInto('worldFeatures').values({ id, worldId, featureTypeCode: 'woodland', state: 'available', variantSeed: 1 }).execute();
      await tx.insertInto('woodlandDeposits').values({ worldId, featureId: id, cellX: 1024, cellY: 514,
        initialAmount: 300, remainingAmount: amount, reservedAmount: 0, revision: 1, updatedAt: t, regrowthUpdatedAt: t }).execute();
      await tx.insertInto('worldCellOccupancies').values({ worldId, cellX: 1024, cellY: 514, featureId: id, buildingId: null, role: 'body' }).execute();
      await tx.insertInto('populationCohorts').values({ worldId, villageId, originVillageId: villageId, memberCount: 10,
        activity: 'idle', energy: 10, energyProgress: 0, energyUpdatedAt: t, restingSince: null,
        foodUsedSinceRest: 0, harvestId: null, extractionId: null }).execute();
      await run(tx, id, t);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}
const village = { worldId, villageId, widthCells: 2048, heightCells: 1024 };
const stock = (tx: Transaction<Database>) => tx.selectFrom('villageResources').select('amount')
  .where('worldId', '=', worldId).where('villageId', '=', villageId).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();

it('regrows over fourteen days, retains fractions across reads, caps stock and reblocks an unused cell', async () => {
  await fixture(async (tx, id, t) => {
    await materializeWoodland(tx, worldId, id, t);
    expect(await tx.selectFrom('worldCellOccupancies').select('featureId').where('featureId', '=', id).execute()).toHaveLength(0);
    for (let i = 1; i <= 4; i++) await materializeWoodland(tx, worldId, id, new Date(t.getTime() + i * 3_600_000));
    const row = await tx.selectFrom('woodlandDeposits').selectAll().where('featureId', '=', id).executeTakeFirstOrThrow();
    expect(Number(row.remainingAmount)).toBeCloseTo(300 * 4 / 336, 8);
    await materializeWoodland(tx, worldId, id, new Date(t.getTime() + 40 * 3_600_000));
    expect(await tx.selectFrom('worldCellOccupancies').select('featureId').where('featureId', '=', id).execute()).toHaveLength(1);
    await materializeWoodland(tx, worldId, id, new Date(t.getTime() + 20 * 86400000));
    expect((await readStoneDeposit(tx, worldId, id)).remainingAmount).toBe(300);
  }, 0);
});

it('reservation is not depletion and a village cannot start a second mission on the same woodland', async () => {
  await fixture(async (tx, id, t) => {
    const command = randomUUID(), economy = { worldId, villageId, through: t };
    const work = await startStoneExtraction(tx, village, economy, id, command, 1);
    expect(await startStoneExtraction(tx, village, economy, id, command, 1)).toBe(work);
    expect((await readStoneDeposit(tx, worldId, id)).availableAmount).toBe(200);
    await expect(clearWoodland(tx, worldId, id, t)).rejects.toMatchObject({ code: 'WOODLAND_NOT_CLEARABLE' });
    await expect(startStoneExtraction(tx, village, economy, id, randomUUID(), 1)).rejects.toMatchObject({ code: 'WOODLAND_MISSION_IN_PROGRESS' });
  });
});

it('keeps fractional stock above the reclaim threshold blocked in details and chunks', async () => {
  await fixture(async (tx, id, t) => {
    const horizon = new Date(t.getTime() + 120000);
    await materializeWoodland(tx, worldId, id, horizon);
    const deposit = await readStoneDeposit(tx, worldId, id);
    expect(deposit).toMatchObject({ remainingAmount: 30, blocksCell: true, canClear: false });
    await expect(clearWoodland(tx, worldId, id, horizon)).rejects.toMatchObject({ code: 'WOODLAND_NOT_CLEARABLE' });
    expect(await tx.selectFrom('worldCellOccupancies').select('featureId').where('featureId', '=', id).execute()).toHaveLength(1);
    const source = { transaction: () => ({ setIsolationLevel: () => ({ execute: <T>(run: (tx: Transaction<Database>) => Promise<T>) => run(tx) }) }) } as unknown as typeof db;
    const chunks = await getTerrainUpdates(source, DEVELOPMENT_IDS.account, 'aube', '32,16');
    expect(chunks.chunks[0]!.occupiedCells).toContainEqual({ cellX: 1024, cellY: 514 });
    expect(chunks.chunks[0]!.features.find(f => f.id === id)?.deposit?.blocksCell).toBe(true);
  }, 30);
});

it('clearing during a last-lot mission preserves its delivery and stops regrowth without an extra reward', async () => {
  await fixture(async (tx, id, t) => {
    const before = BigInt((await stock(tx)).amount);
    const work = await startStoneExtraction(tx, village, { worldId, villageId, through: t }, id, randomUUID(), 1);
    await clearWoodland(tx, worldId, id, t);
    expect(BigInt((await stock(tx)).amount)).toBe(before);
    const due = new Date(t.getTime() + 600000);
    await completeStoneExtractionAt(tx, worldId, villageId, work, due);
    await completeStoneExtractionAt(tx, worldId, villageId, work, due);
    expect(BigInt((await stock(tx)).amount)).toBe(before + 30n);
    await materializeWoodland(tx, worldId, id, new Date(due.getTime() + 30 * 86400000));
    const after = await readStoneDeposit(tx, worldId, id);
    expect(after).toMatchObject({ remainingAmount: 0, reservedAmount: 0, cleared: true });
    expect(await tx.selectFrom('populationCohorts').select('id').where('extractionId', '=', work).execute()).toHaveLength(0);
  }, 30);
});

it('applies physical cuts in chronological order even before their villages claim the credit', async () => {
  await fixture(async (tx, id, t) => {
    const work = await startStoneExtraction(tx, village, { worldId, villageId, through: t }, id, randomUUID(), 1);
    const before = BigInt((await stock(tx)).amount);
    const due = new Date(t.getTime() + 600000), later = new Date(due.getTime() + 24 * 3600000);
    await materializeWoodland(tx, worldId, id, later);
    expect((await readStoneDeposit(tx, worldId, id)).remainingAmount).toBe(221);
    expect(BigInt((await stock(tx)).amount)).toBe(before);
    await completeStoneExtractionAt(tx, worldId, villageId, work, due);
    expect(BigInt((await stock(tx)).amount)).toBe(before + 100n);
    expect((await readStoneDeposit(tx, worldId, id)).remainingAmount).toBe(221);
  });
});

it('a construction on a liberated case stops regrowth without overwriting the building', async () => {
  await fixture(async (tx, id, t) => {
    await materializeWoodland(tx, worldId, id, t);
    await tx.insertInto('worldCellOccupancies').values({ worldId, cellX: 1024, cellY: 514,
      buildingId: DEVELOPMENT_IDS.townHall, featureId: null, role: 'extension' }).execute();
    await materializeWoodland(tx, worldId, id, new Date(t.getTime() + 336 * 3600000));
    expect((await readStoneDeposit(tx, worldId, id)).cleared).toBe(true);
    expect((await tx.selectFrom('worldCellOccupancies').select('buildingId').where('worldId', '=', worldId)
      .where('cellX', '=', 1024).where('cellY', '=', 514).executeTakeFirstOrThrow()).buildingId).toBe(DEVELOPMENT_IDS.townHall);
  }, 0);
});

it('serves woodland details and starts the existing API service with a real path and resource identity', async () => {
  await fixture(async (tx, id) => {
    const source = { transaction: () => ({ execute: <T>(run: (tx: Transaction<Database>) => Promise<T>) => run(tx) }) } as unknown as typeof db;
    const details = await getStoneDepositDetails(source, DEVELOPMENT_IDS.account, 'aube', villageId, id);
    expect(details.deposit).toMatchObject({ resourceCode: 'wood', initialAmount: 300, remainingAmount: 300 });
    expect(details.eligibility.workerOptions[0]?.canStart).toBe(true);
    const result = await startVillageStoneExtraction(source, DEVELOPMENT_IDS.account, 'aube', villageId, id, randomUUID(), 1);
    expect(result.extraction.resourceCode).toBe('wood');
    expect(result.extraction.path.length).toBeGreaterThan(1);
    expect(result.extraction.transportMs).toBe((result.extraction.path.length - 1) * 1000);
    expect(Date.parse(result.extraction.completesAt) - Date.parse(result.extraction.startedAt)).toBe(600000 + result.extraction.transportMs * 2);
    expect(result.deposit.availableAmount).toBe(200);
  });
});

it('rolls back observed stock, reservation, workers and accomplishment mutations together', async () => {
  const before = await db.selectFrom('villageResources').selectAll().where('villageId', '=', villageId).orderBy('resourceCode').execute();
  const cohorts = await db.selectFrom('populationCohorts').selectAll().where('villageId', '=', villageId).orderBy('id').execute();
  let workId = '';
  await fixture(async (tx, id, t) => {
    const amount = BigInt((await stock(tx)).amount);
    workId = await startStoneExtraction(tx, village, { worldId, villageId, through: t }, id, randomUUID(), 1);
    await clearWoodland(tx, worldId, id, t);
    await completeStoneExtractionAt(tx, worldId, villageId, workId, new Date(t.getTime() + 600000));
    expect(BigInt((await stock(tx)).amount)).toBe(amount + 30n);
    expect((await readStoneDeposit(tx, worldId, id)).cleared).toBe(true);
    expect(await tx.selectFrom('villageAccomplishments').select('code').where('villageId', '=', villageId)
      .where('code', '=', 'first-woodcut').execute()).toHaveLength(1);
    // fixture injects the identified rollback sentinel after these observations.
  }, 30);
  expect(await db.selectFrom('villageResources').selectAll().where('villageId', '=', villageId).orderBy('resourceCode').execute()).toEqual(before);
  expect(await db.selectFrom('populationCohorts').selectAll().where('villageId', '=', villageId).orderBy('id').execute()).toEqual(cohorts);
  expect(await db.selectFrom('depositExtractions').select('id').where('id', '=', workId).execute()).toHaveLength(0);
  expect(await db.selectFrom('villageAccomplishments').select('code').where('villageId', '=', villageId)
    .where('code', '=', 'first-woodcut').execute()).toHaveLength(0);
});

it('checks the authenticated village and world for clearing and prevents regrowth after the public command', async () => {
  await fixture(async (tx, id, t) => {
    const source = { transaction: () => ({ execute: <T>(run: (tx: Transaction<Database>) => Promise<T>) => run(tx) }) } as unknown as typeof db;
    await expect(clearVillageWoodland(source, randomUUID(), 'aube', villageId, id)).rejects.toMatchObject({ code: 'VILLAGE_NOT_FOUND' });
    await expect(clearVillageWoodland(source, DEVELOPMENT_IDS.account, 'unknown-world', villageId, id)).rejects.toMatchObject({ code: 'VILLAGE_NOT_FOUND' });
    const before = BigInt((await stock(tx)).amount);
    const result = await clearVillageWoodland(source, DEVELOPMENT_IDS.account, 'aube', villageId, id);
    expect(result.region.features.find(f => f.id === id)?.deposit?.cleared).toBe(true);
    expect(BigInt((await stock(tx)).amount)).toBe(before);
    await materializeWoodland(tx, worldId, id, new Date(t.getTime() + 30 * 86400000));
    expect((await readStoneDeposit(tx, worldId, id)).remainingAmount).toBe(0);
  }, 20);
});

it('records the first positive garden delivery once without an additional carrot reward', async () => {
  await fixture(async (tx, _id, t) => {
    const garden = await tx.insertInto('buildings').values({ worldId, villageId, buildingType: 'garden', level: 1,
      targetLevel: null, status: 'completed', constructionStartedAt: null, constructionCompletesAt: null, completedAt: t })
      .returning('id').executeTakeFirstOrThrow();
    const due = new Date(t.getTime() + 60000);
    const work = await tx.insertInto('gardenHarvests').values({ worldId, villageId, buildingId: garden.id, commandId: randomUUID(),
      plotCellX: null, plotCellY: null, status: 'in-progress', startedAt: t, completesAt: due, completedAt: null,
      workerCount: 1, reservedCarrots: 7, transportMs: 0, pathCells: [] }).returning('id').executeTakeFirstOrThrow();
    const candidates = eligibleWorkers(await materializeCohorts(tx, worldId, villageId, t), 60000);
    await assignWorkers(tx, candidates, 1, { harvestId: work.id, extractionId: null });
    const carrot = () => tx.selectFrom('villageResources').select('amount').where('villageId', '=', villageId)
      .where('resourceCode', '=', 'carrot').executeTakeFirstOrThrow();
    const amount = BigInt((await carrot()).amount);
    await completeGardenHarvestAt(tx, worldId, villageId, work.id, due);
    await completeGardenHarvestAt(tx, worldId, villageId, work.id, due);
    expect(BigInt((await carrot()).amount)).toBe(amount + 7n);
    const entry = await tx.selectFrom('villageAccomplishments').select('completedAt').where('worldId', '=', worldId)
      .where('villageId', '=', villageId).where('code', '=', 'first-harvest').execute();
    expect(entry).toHaveLength(1); expect(entry[0]!.completedAt).toEqual(due);
  });
});

it('serializes two villages on the woodland lock and preserves both reservations', async () => {
  const featureId = randomUUID(), otherAccount = randomUUID(), otherVillage = randomUUID();
  const t = new Date();
  let release!: () => void, ready!: () => void, waiting!: (pid: number) => void;
  const held = new Promise<void>(resolve => { ready = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiterPid = new Promise<number>(resolve => { waiting = resolve; });
  let first: Promise<string> | undefined, second: Promise<string> | undefined;
  let holderPid = 0;
  const within = <T>(promise: Promise<T>) => {
    let timer!: ReturnType<typeof setTimeout>;
    return Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('woodland concurrency timeout')), 10000);
    })]).finally(() => clearTimeout(timer));
  };
  try {
    await db.transaction().execute(async tx => {
      await tx.insertInto('accounts').values({ id: otherAccount, email: `${otherAccount}@wood.test`, passwordHash: 'unused' }).execute();
      await tx.insertInto('worldMemberships').values({ worldId, accountId: otherAccount, playerName: 'Wood test' }).execute();
      await tx.insertInto('villages').values({ id: otherVillage, worldId, ownerAccountId: otherAccount,
        name: 'Wood test', anchorCellX: 1025, anchorCellY: 512 }).execute();
      const hall = await tx.insertInto('buildings').values({ worldId, villageId: otherVillage, buildingType: 'town-hall', level: 1,
        targetLevel: null, status: 'completed', constructionStartedAt: null, constructionCompletesAt: null, completedAt: t })
        .returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('worldCellOccupancies').values({ worldId, cellX: 1025, cellY: 512, buildingId: hall.id, featureId: null, role: 'anchor' }).execute();
      await tx.insertInto('populationCohorts').values({ worldId, villageId: otherVillage, originVillageId: otherVillage,
        memberCount: 10, activity: 'idle', energy: 10, energyProgress: 0, energyUpdatedAt: t, restingSince: null,
        foodUsedSinceRest: 0, harvestId: null, extractionId: null }).execute();
      await tx.insertInto('worldFeatures').values({ id: featureId, worldId, featureTypeCode: 'woodland', state: 'available', variantSeed: 1 }).execute();
      await tx.insertInto('woodlandDeposits').values({ worldId, featureId, cellX: 1024, cellY: 514,
        initialAmount: 300, remainingAmount: 300, reservedAmount: 0, revision: 1, updatedAt: t, regrowthUpdatedAt: t }).execute();
      await tx.insertInto('worldCellOccupancies').values({ worldId, cellX: 1024, cellY: 514, featureId, buildingId: null, role: 'body' }).execute();
    });
    first = db.transaction().execute(async tx => {
      holderPid = (await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;
      const economy = await beginVillageEconomy(tx, worldId, villageId, featureId);
      const id = await startStoneExtraction(tx, village, economy, featureId, randomUUID(), 1);
      ready(); await gate; return id;
    });
    await within(held);
    second = db.transaction().execute(async tx => {
      waiting((await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid);
      const economy = await beginVillageEconomy(tx, worldId, otherVillage, featureId);
      return startStoneExtraction(tx, { ...village, villageId: otherVillage }, economy, featureId, randomUUID(), 1);
    });
    const pid = await within(waiterPid), deadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < deadline) {
      blocked = (await db.selectNoFrom(sql<boolean>`${holderPid}=any(pg_blocking_pids(${pid}))`.as('blocked')).executeTakeFirstOrThrow()).blocked;
      if (blocked) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    release();
    await within(Promise.all([first, second]));
    const deposit = await db.selectFrom('woodlandDeposits').select(['remainingAmount', 'reservedAmount'])
      .where('featureId', '=', featureId).executeTakeFirstOrThrow();
    expect(Number(deposit.remainingAmount)).toBe(300);
    expect(Number(deposit.reservedAmount)).toBe(200);
    expect(await db.selectFrom('depositExtractions').select('id').where('featureId', '=', featureId).execute()).toHaveLength(2);
  } finally {
    release?.();
    await Promise.allSettled([first, second].filter((p): p is Promise<string> => Boolean(p)));
    await resetE2eState(url);
    await db.deleteFrom('worldCellOccupancies').where('featureId', '=', featureId).execute();
    await db.deleteFrom('woodlandDeposits').where('featureId', '=', featureId).execute();
    await db.deleteFrom('worldFeatures').where('id', '=', featureId).execute();
    await db.deleteFrom('accounts').where('id', '=', otherAccount).execute();
  }
});
