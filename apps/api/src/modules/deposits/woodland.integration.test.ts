import { SyncV2ChangeSchema, travelDuration, type HarvestCancelReceipt, type TravelCell } from '@arbestra/contracts';
import { Value } from '@sinclair/typebox/value';
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Database } from '../../database/schema.js';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS } from '../../database/seed.js';
import { clearWoodland } from './woodland.js';
import { completeStoneExtractionAt, readStoneDeposit, startStoneExtraction } from './stone-extractions.js';
import { admitWorksites, createWorksite } from './worksites.js';
import { beginVillageEconomy } from '../villages/reconcile-economy.js';
import {
  readVillageDepositDetails,
  ownedVillage,
  prepareWorksiteSelection,
  reconcileVillageForRead,
  state,
} from '../villages/service.js';
import { startVillageStoneExtraction } from '../villages/legacy-commands.fixture.js';
import { admitVillageWorksites } from '../villages/worksite-admission.js';
import { acceptHarvestIntent } from '../villages/harvest-intents.js';
import { cancelHarvestIntent, cancelHarvestIntentIn } from '../villages/harvest-cancellations.js';
import {
  HARVEST_SUBMISSION_TASK,
  processHarvestSubmission,
  readHarvestReceipts,
  receiveHarvestIntent,
} from '../villages/harvest-submissions.js';
import type { ScheduledTask } from '../../jobs/scheduled-tasks.js';
import { readExtractionPools } from './extraction-pools.js';
import { readSpatialChanges } from '../villages/sync-v2-spatial-readers.js';
import { readTerrainProjection } from '../worlds/terrain.js';

/** The tree as the wood harvest unit (docs/SPEC-BOIS-ARBRE-UNITE.md): 500 per
 * tree, lots of 100 on one tree, felled at its first lot, a stump at its last;
 * no regrowth, no threshold; stumps removed one by one before a case clears. */
const url = testDatabaseUrl(),
  db = createDatabase(url),
  worldId = DEVELOPMENT_IDS.world,
  villageId = DEVELOPMENT_IDS.village;
beforeAll(async () => {
  await migrateToLatest(url);
  await resetE2eState(url);
});
afterAll(() => db.destroy());
const rollback = new Error('woodland fixture rollback');
const cell = { cellX: 1024, cellY: 514 };

/** A case of `trees` trees (500 each) beside the dev village of the test world. */
async function grove(tx: Transaction<Database>, t: Date, trees = 2) {
  const id = randomUUID();
  await tx
    .insertInto('worldFeatures')
    .values({ id, worldId, featureTypeCode: 'woodland', state: 'available', variantSeed: 4 })
    .execute();
  await tx
    .insertInto('woodlandDeposits')
    .values({
      worldId,
      featureId: id,
      ...cell,
      initialAmount: 500 * trees,
      remainingAmount: 500 * trees,
      reservedAmount: 0,
      revision: 1,
      updatedAt: t,
      regrowthUpdatedAt: t,
    })
    .execute();
  await tx
    .insertInto('worldCellOccupancies')
    .values({ worldId, ...cell, featureId: id, buildingId: null, role: 'body' })
    .execute();
  return id;
}
const cohort = (tx: Transaction<Database>, village: string, t: Date) =>
  tx
    .insertInto('populationCohorts')
    .values({
      worldId,
      villageId: village,
      originVillageId: village,
      memberCount: 10,
      activity: 'idle',
      energy: 10,
      energyProgress: 0,
      energyUpdatedAt: t,
      restingSince: null,
      foodUsedSinceRest: 0,
      harvestId: null,
      extractionId: null,
    })
    .execute();

async function fixture(run: (tx: Transaction<Database>, id: string, t: Date) => Promise<void>, trees = 2) {
  try {
    await db.transaction().execute(async (tx) => {
      await tx.selectFrom('villages').select('id').where('id', '=', villageId).forUpdate().executeTakeFirstOrThrow();
      const t = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
      const id = await grove(tx, t, trees);
      await cohort(tx, villageId, t);
      await run(tx, id, t);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
/** A second village of the same world, with its own team. */
async function neighbour(tx: Transaction<Database>, t: Date) {
  const account = randomUUID(),
    id = randomUUID();
  await tx
    .insertInto('accounts')
    .values({ id: account, email: `${account}@wood.test`, passwordHash: 'unused' })
    .execute();
  await tx.insertInto('worldMemberships').values({ worldId, accountId: account, playerName: 'Wood test' }).execute();
  await tx
    .insertInto('villages')
    .values({
      id,
      worldId,
      ownerAccountId: account,
      name: 'Wood test',
      anchorCellX: 1025,
      anchorCellY: 512,
      economyActivatedAt: t,
    })
    .execute();
  await tx.insertInto('villageResources').values({ worldId, villageId: id, resourceCode: 'wood', amount: 0 }).execute();
  const hall = await tx
    .insertInto('buildings')
    .values({
      worldId,
      villageId: id,
      buildingType: 'town-hall',
      level: 1,
      targetLevel: null,
      status: 'completed',
      constructionStartedAt: null,
      constructionCompletesAt: null,
      completedAt: t,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await tx
    .insertInto('worldCellOccupancies')
    .values({ worldId, cellX: 1025, cellY: 512, buildingId: hall.id, featureId: null, role: 'anchor' })
    .execute();
  await cohort(tx, id, t);
  return { account, id };
}
const village = { worldId, villageId, widthCells: 2048, heightCells: 1024 };
const stock = async (tx: Transaction<Database>, village: string = villageId) =>
  BigInt(
    (
      await tx
        .selectFrom('villageResources')
        .select('amount')
        .where('worldId', '=', worldId)
        .where('villageId', '=', village)
        .where('resourceCode', '=', 'wood')
        .executeTakeFirstOrThrow()
    ).amount,
  );
const tree = (tx: Transaction<Database>, id: string, treeIndex: number) =>
  tx
    .selectFrom('woodlandTrees')
    .selectAll()
    .where('worldId', '=', worldId)
    .where('featureId', '=', id)
    .where('treeIndex', '=', treeIndex)
    .executeTakeFirst();
const lot = (tx: Transaction<Database>, id: string) =>
  tx.selectFrom('depositExtractions').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const occupied = async (tx: Transaction<Database>, id: string) =>
  (
    await tx
      .selectFrom('worldCellOccupancies')
      .select('featureId')
      .where('worldId', '=', worldId)
      .where('featureId', '=', id)
      .execute()
  ).length;

it('cuts a tree in five lots of 100: felled at the first, a stump at the fifth, each debited at its deadline', async () => {
  await fixture(async (tx, id, t) => {
    const before = await stock(tx);
    let at = t;
    for (let n = 1; n <= 5; n++) {
      const work = await lot(
        tx,
        await startStoneExtraction(tx, village, { worldId, villageId, through: at }, id, randomUUID(), 1),
      );
      expect(work).toMatchObject({ treeIndex: 0, reservedAmount: '100' });
      // The first lot fells the tree; its trunk holds the wood left.
      expect(await tree(tx, id, 0)).toMatchObject({ remainingAmount: 600 - 100 * n, reservedAmount: 100, felledAt: t });
      // A read before the deadline debits nothing.
      await completeStoneExtractionAt(tx, worldId, villageId, work.id, new Date(work.completesAt.getTime() - 1));
      expect((await tree(tx, id, 0))!.remainingAmount).toBe(600 - 100 * n);
      at = work.completesAt;
      await completeStoneExtractionAt(tx, worldId, villageId, work.id, at);
      expect(await tree(tx, id, 0)).toMatchObject({ remainingAmount: 500 - 100 * n, reservedAmount: 0 });
      expect(await lot(tx, work.id)).toMatchObject({ status: 'completed', woodDebitedAt: at });
      expect(await readStoneDeposit(tx, worldId, id)).toMatchObject({
        cutAmount: 100 * n,
        remainingAmount: 1000 - 100 * n,
        reservedAmount: 0,
        state: 'available',
        blocksCell: true,
      });
    }
    // Five lots, one stump, its wood delivered once.
    expect(await tree(tx, id, 0)).toMatchObject({ remainingAmount: 0, stumpRemovedAt: null });
    expect(await stock(tx)).toBe(before + 500n);
    // The sixth lot fells the next tree.
    const sixth = await startStoneExtraction(tx, village, { worldId, villageId, through: at }, id, randomUUID(), 1);
    expect((await lot(tx, sixth)).treeIndex).toBe(1);
    expect(await tree(tx, id, 1)).toMatchObject({ remainingAmount: 500, reservedAmount: 100 });
  });
}, 60_000);

it('shares a tree between two villages and lets only the owner debit its lot, at its deadline', async () => {
  await fixture(async (tx, id, t) => {
    const other = await neighbour(tx, t);
    // A trunk of 150 left: one lot of 100 for the village, the remaining 50 for its neighbour.
    await tx
      .insertInto('woodlandTrees')
      .values({ worldId, featureId: id, treeIndex: 0, remainingAmount: 150, felledAt: t })
      .execute();
    await tx
      .updateTable('woodlandDeposits')
      .set({ remainingAmount: 650, cutAmount: 350 })
      .where('worldId', '=', worldId)
      .where('featureId', '=', id)
      .execute();
    const mine = await lot(
      tx,
      await startStoneExtraction(tx, village, { worldId, villageId, through: t }, id, randomUUID(), 1),
    );
    const theirs = await lot(
      tx,
      await startStoneExtraction(
        tx,
        { ...village, villageId: other.id },
        { worldId, villageId: other.id, through: t },
        id,
        randomUUID(),
        1,
      ),
    );
    expect(mine).toMatchObject({ treeIndex: 0, reservedAmount: '100' });
    expect(theirs).toMatchObject({ treeIndex: 0, reservedAmount: '50' });
    expect(await tree(tx, id, 0)).toMatchObject({ remainingAmount: 150, reservedAmount: 150 });
    // Long after both deadlines, the neighbour's wake debits its own lot only.
    const later = new Date(Math.max(mine.completesAt.getTime(), theirs.completesAt.getTime()) + 3_600_000);
    const theirStock = await stock(tx, other.id);
    await beginVillageEconomy(tx, worldId, other.id, undefined, [], [], false, [other.id], later);
    expect(await tree(tx, id, 0)).toMatchObject({ remainingAmount: 100, reservedAmount: 100 });
    expect(await stock(tx, other.id)).toBe(theirStock + 50n);
    expect((await lot(tx, mine.id)).woodDebitedAt).toBeNull();
    // Readers already see the lot due as cut, without writing it.
    await sql`select set_config('arbestra.economy_through', ${later.toISOString()}, true)`.execute(tx);
    expect(await readStoneDeposit(tx, worldId, id)).toMatchObject({ remainingAmount: 500, cutAmount: 500 });
    // The owner debits it at its own deadline.
    await completeStoneExtractionAt(tx, worldId, villageId, mine.id, mine.completesAt);
    expect(await tree(tx, id, 0)).toMatchObject({ remainingAmount: 0, reservedAmount: 0 });
    expect(await lot(tx, mine.id)).toMatchObject({ woodDebitedAt: mine.completesAt });
    expect(
      await tx
        .selectFrom('woodlandDeposits')
        .select(['remainingAmount', 'reservedAmount', 'cutAmount'])
        .where('featureId', '=', id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ remainingAmount: '500', reservedAmount: '0', cutAmount: '500' });
  });
}, 60_000);

it('clears a case of two trees: ten lots of wood, two stumps removed one by one, then cleared and free', async () => {
  await fixture(async (tx, id, t) => {
    const anchor = { cellX: 1024, cellY: 512 },
      path = [anchor, { cellX: 1024, cellY: 513 }, cell],
      transportMs = travelDuration(path, village);
    const siteId = await createWorksite(
      tx,
      { worldId, villageId, through: t },
      {
        commandId: randomUUID(),
        mode: 'clear',
        workerCap: 10,
        featureIds: [id],
      },
    );
    const lots: Array<Awaited<ReturnType<typeof lot>>> = [];
    let at = t;
    for (let step = 0; step < 80 && lots.length < 12; step++) {
      await admitWorksites(tx, { worldId, villageId, through: at }, village, async () => path);
      const running = await tx
        .selectFrom('depositExtractions')
        .selectAll()
        .where('worksiteId', '=', siteId)
        .where('status', '=', 'in-progress')
        .executeTakeFirst();
      if (!running) {
        at = new Date(at.getTime() + 3_600_000); // Workers rest, then the site resumes.
        continue;
      }
      // Until its last stump is removed, the case is occupied and blocks its cell.
      expect(await occupied(tx, id)).toBe(1);
      expect((await readStoneDeposit(tx, worldId, id)).blocksCell).toBe(true);
      lots.push(running);
      at = running.completesAt;
      await completeStoneExtractionAt(tx, worldId, villageId, running.id, at);
    }
    expect(lots.map((l) => [l.treeIndex, Number(l.reservedAmount)])).toEqual([
      ...Array.from({ length: 5 }, () => [0, 100]),
      ...Array.from({ length: 5 }, () => [1, 100]),
      [0, 0],
      [1, 0],
    ]);
    // A stump: one inhabitant, the time of a lot of 100 for one inhabitant.
    for (const stump of lots.slice(10)) {
      expect(stump.workerCount).toBe(1);
      expect(stump.completesAt.getTime() - stump.startedAt.getTime()).toBe(600_000 + 2 * transportMs);
    }
    expect((await tree(tx, id, 0))!.stumpRemovedAt).toEqual(lots[10]!.completesAt);
    expect((await tree(tx, id, 1))!.stumpRemovedAt).toEqual(lots[11]!.completesAt);
    expect(await readStoneDeposit(tx, worldId, id)).toMatchObject({
      cleared: true,
      state: 'depleted',
      blocksCell: false,
      remainingAmount: 0,
      cutAmount: 1000,
    });
    expect(await occupied(tx, id)).toBe(0);
    expect(
      (await tx.selectFrom('worldFeatures').select('state').where('id', '=', id).executeTakeFirstOrThrow()).state,
    ).toBe('depleted');
    expect(
      await tx
        .selectFrom('extractionWorksiteTargets')
        .select(['status', 'reason'])
        .where('worksiteId', '=', siteId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'completed', reason: 'goal-reached' });
  });
}, 120_000);

it('refuses to finish a clearing while a tree or a stump stands', async () => {
  await fixture(async (tx, id, t) => {
    await expect(clearWoodland(tx, worldId, id, t)).rejects.toMatchObject({ code: 'WOODLAND_NOT_CLEARABLE' });
    await tx
      .insertInto('woodlandTrees')
      .values([
        { worldId, featureId: id, treeIndex: 0, remainingAmount: 0, felledAt: t, stumpRemovedAt: t },
        { worldId, featureId: id, treeIndex: 1, remainingAmount: 0, felledAt: t },
      ])
      .execute();
    await expect(clearWoodland(tx, worldId, id, t)).rejects.toMatchObject({ code: 'WOODLAND_NOT_CLEARABLE' });
    expect(await occupied(tx, id)).toBe(1);
    await tx.updateTable('woodlandTrees').set({ stumpRemovedAt: t }).where('featureId', '=', id).execute();
    await clearWoodland(tx, worldId, id, t);
    expect((await readStoneDeposit(tx, worldId, id)).cleared).toBe(true);
    expect(await occupied(tx, id)).toBe(0);
  });
});

it('never fails a wake when a wood lot cannot leave: the next lot takes at most what the case holds', async () => {
  await fixture(async (tx, id, t) => {
    const economy = { worldId, villageId, through: t },
      path = [{ cellX: 1024, cellY: 512 }, { cellX: 1024, cellY: 513 }, cell];
    const siteId = await createWorksite(tx, economy, {
      commandId: randomUUID(),
      mode: 'cut',
      workerCap: 10,
      featureIds: [id],
    });
    await admitWorksites(tx, economy, village, async () => path);
    const first = await tx
      .selectFrom('depositExtractions')
      .selectAll()
      .where('worksiteId', '=', siteId)
      .executeTakeFirstOrThrow();
    // Development database, 28 October: the case still held the stock of the
    // former model (116 of 1000, 900 cut) while the new code felled its tree.
    await tx
      .updateTable('woodlandDeposits')
      .set({ remainingAmount: '116.2859705687830687883723810000', cutAmount: 900 })
      .where('featureId', '=', id)
      .execute();
    // The wake of a read, a command or the worker after the lot's deadline:
    // the same economy and admission, here at a chosen instant.
    const later = new Date(first.completesAt.getTime() + 1);
    await beginVillageEconomy(tx, worldId, villageId, undefined, [], [], false, [villageId], later);
    await admitVillageWorksites(tx, { worldId, villageId, through: later });
    const wood = await tx
      .selectFrom('woodlandDeposits')
      .select(['remainingAmount', 'reservedAmount'])
      .where('featureId', '=', id)
      .executeTakeFirstOrThrow();
    // Debited by its owner; the next lot stays within the case.
    expect(Number(wood.remainingAmount)).toBeCloseTo(16.29, 2);
    expect(Number(wood.reservedAmount)).toBeLessThanOrEqual(Number(wood.remainingAmount));
    const next = await tx
      .selectFrom('depositExtractions')
      .select('reservedAmount')
      .where('worksiteId', '=', siteId)
      .where('status', '=', 'in-progress')
      .executeTakeFirst();
    expect(Number(next?.reservedAmount ?? 0)).toBeLessThanOrEqual(16);
  });
}, 60_000);

it('lets a site wait when its departure is refused, instead of failing the wake that admits it', async () => {
  await fixture(async (tx, id, t) => {
    const economy = { worldId, villageId, through: t },
      far = { cellX: 1400, cellY: 700 };
    const siteId = await createWorksite(tx, economy, {
      commandId: randomUUID(),
      mode: 'cut',
      workerCap: 10,
      featureIds: [id],
    });
    // The case is now out of the village's range: the departure refuses it.
    await tx.updateTable('worldCellOccupancies').set(far).where('featureId', '=', id).execute();
    await tx.updateTable('woodlandDeposits').set(far).where('featureId', '=', id).execute();
    await admitWorksites(tx, economy, village, async () => [{ cellX: 1024, cellY: 512 }, far]);
    expect(await tx.selectFrom('depositExtractions').select('id').where('worksiteId', '=', siteId).execute()).toEqual(
      [],
    );
    expect(
      await tx
        .selectFrom('extractionWorksites')
        .select(['status', 'waitReason'])
        .where('id', '=', siteId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'running', waitReason: 'access' });
    expect(
      await tx
        .selectFrom('scheduledTasks')
        .select('taskType')
        .where('taskType', '=', 'deposit.worksite.wake')
        .where(sql<boolean>`payload->>'worksiteId'=${siteId}`)
        .execute(),
    ).toHaveLength(1);
    expect(await tree(tx, id, 0)).toBeUndefined();
  });
});

it('ignores an old notification: a lot already debited or a deadline that is not its own', async () => {
  await fixture(async (tx, id, t) => {
    const work = await lot(
      tx,
      await startStoneExtraction(tx, village, { worldId, villageId, through: t }, id, randomUUID(), 1),
    );
    await completeStoneExtractionAt(tx, worldId, villageId, work.id, work.completesAt);
    const after = {
      stock: await stock(tx),
      tree: await tree(tx, id, 0),
      deposit: await tx
        .selectFrom('woodlandDeposits')
        .selectAll()
        .where('featureId', '=', id)
        .executeTakeFirstOrThrow(),
    };
    await completeStoneExtractionAt(tx, worldId, villageId, work.id, work.completesAt);
    await completeStoneExtractionAt(tx, worldId, villageId, work.id, new Date(work.completesAt.getTime() + 1));
    expect({
      stock: await stock(tx),
      tree: await tree(tx, id, 0),
      deposit: await tx
        .selectFrom('woodlandDeposits')
        .selectAll()
        .where('featureId', '=', id)
        .executeTakeFirstOrThrow(),
    }).toEqual(after);
  });
});

it('serves woodland details and starts the existing API service on a tree, with a real path', async () => {
  await fixture(async (tx, id, t) => {
    const source = {
      transaction: () => ({ execute: <T>(run: (tx: Transaction<Database>) => Promise<T>) => run(tx) }),
    } as unknown as typeof db;
    const owned = await ownedVillage(tx, DEVELOPMENT_IDS.account, 'aube', villageId);
    const details = await readVillageDepositDetails(
      tx,
      DEVELOPMENT_IDS.account,
      owned,
      { worldId, villageId, through: t },
      id,
    );
    expect(details.deposit).toMatchObject({
      resourceCode: 'wood',
      initialAmount: 1000,
      remainingAmount: 1000,
    });
    // No regrowth any more, and no tree touched yet.
    expect(details.deposit).not.toHaveProperty('regrowthPerHour');
    expect(details.deposit).not.toHaveProperty('trees');
    expect(details.eligibility.workerOptions[0]?.canStart).toBe(true);
    const result = await startVillageStoneExtraction(
      source,
      DEVELOPMENT_IDS.account,
      'aube',
      villageId,
      id,
      randomUUID(),
      1,
    );
    expect(result.extraction.resourceCode).toBe('wood');
    expect(result.extraction.path.length).toBeGreaterThan(1);
    expect(Date.parse(result.extraction.completesAt) - Date.parse(result.extraction.startedAt)).toBe(
      600000 + result.extraction.transportMs * 2,
    );
    expect(result.deposit.availableAmount).toBe(900);
    expect((await tree(tx, id, 0))!.reservedAmount).toBe(100);
  });
});

/** Committed fixture for tests whose transactions must commit or roll back on their own. */
async function committedGrove() {
  return db.transaction().execute(async (tx) => {
    const t = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
    return { id: await grove(tx, t), t };
  });
}
async function dropGrove(id: string) {
  await db.deleteFrom('depositExtractions').where('featureId', '=', id).execute();
  await db.deleteFrom('worldCellOccupancies').where('featureId', '=', id).execute();
  await db.deleteFrom('woodlandDeposits').where('featureId', '=', id).execute();
  await db.deleteFrom('worldFeatures').where('id', '=', id).execute();
}

it('writes nothing on wood and publishes nothing on a read without any deadline', async () => {
  await resetE2eState(url);
  const { id, t } = await committedGrove();
  try {
    // A case partly cut beside the village: the former read rewrote it each time.
    await db.transaction().execute(async (tx) => {
      await tx
        .insertInto('woodlandTrees')
        .values({ worldId, featureId: id, treeIndex: 0, remainingAmount: 200, felledAt: t })
        .execute();
      await tx
        .updateTable('woodlandDeposits')
        .set({ remainingAmount: 700, cutAmount: 300 })
        .where('featureId', '=', id)
        .execute();
    });
    const fingerprint = async () =>
      (
        await sql<Record<string, string>>`select
          (select md5(string_agg(xmin::text||ctid::text,',' order by feature_id)) from woodland_deposits where world_id=${worldId}) as deposits,
          (select md5(coalesce(string_agg(xmin::text||ctid::text,',' order by feature_id,tree_index),'')) from woodland_trees where world_id=${worldId}) as trees,
          (select md5(string_agg(xmin::text||ctid::text,',' order by id)) from world_features where world_id=${worldId}) as features,
          (select md5(string_agg(xmin::text||ctid::text,',' order by cell_x,cell_y)) from world_cell_occupancies where world_id=${worldId}) as occupancies,
          (select coalesce(sum(revision),0)::text from game_sync_streams where world_id=${worldId} and stream_kind='spatial') as spatial`.execute(
          db,
        )
      ).rows[0]!;
    // The first wake after the reset activates the village economy once (village
    // coverage, not wood); every later read is the case under test.
    await reconcileVillageForRead(db, DEVELOPMENT_IDS.account, 'aube', villageId);
    const before = await fingerprint();
    await reconcileVillageForRead(db, DEVELOPMENT_IDS.account, 'aube', villageId);
    await reconcileVillageForRead(db, DEVELOPMENT_IDS.account, 'aube', villageId);
    expect(await fingerprint()).toEqual(before);
  } finally {
    await dropGrove(id);
  }
}, 60_000);

it('serializes two villages on the case of a shared tree and keeps both reservations on it', async () => {
  await resetE2eState(url);
  const { id: featureId } = await committedGrove();
  let other = { account: '', id: '' };
  await db.transaction().execute(async (tx) => {
    other = await neighbour(tx, new Date());
  });
  let release!: () => void, ready!: () => void, waiting!: (pid: number) => void;
  const held = new Promise<void>((resolve) => (ready = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const waiterPid = new Promise<number>((resolve) => (waiting = resolve));
  let first: Promise<string> | undefined, second: Promise<string> | undefined;
  let holderPid = 0;
  const within = <T>(promise: Promise<T>) => {
    let timer!: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('woodland concurrency timeout')), 10000);
      }),
    ]).finally(() => clearTimeout(timer));
  };
  try {
    first = db.transaction().execute(async (tx) => {
      holderPid = (await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;
      const economy = await beginVillageEconomy(tx, worldId, villageId, featureId);
      const id = await startStoneExtraction(tx, village, economy, featureId, randomUUID(), 1);
      ready();
      await gate;
      return id;
    });
    await within(held);
    second = db.transaction().execute(async (tx) => {
      waiting((await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid);
      const economy = await beginVillageEconomy(tx, worldId, other.id, featureId);
      return startStoneExtraction(tx, { ...village, villageId: other.id }, economy, featureId, randomUUID(), 1);
    });
    const pid = await within(waiterPid),
      deadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < deadline) {
      blocked = (
        await db
          .selectNoFrom(sql<boolean>`${holderPid}=any(pg_blocking_pids(${pid}))`.as('blocked'))
          .executeTakeFirstOrThrow()
      ).blocked;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    release();
    await within(Promise.all([first, second]));
    expect(
      await db
        .selectFrom('woodlandTrees')
        .select(['treeIndex', 'remainingAmount', 'reservedAmount'])
        .where('featureId', '=', featureId)
        .execute(),
    ).toEqual([{ treeIndex: 0, remainingAmount: 500, reservedAmount: 200 }]);
    expect(
      await db
        .selectFrom('depositExtractions')
        .select(['villageId', 'treeIndex', 'reservedAmount'])
        .where('featureId', '=', featureId)
        .orderBy('villageId')
        .execute(),
    ).toEqual([villageId, other.id].sort().map((v) => ({ villageId: v, treeIndex: 0, reservedAmount: '100' })));
    expect(
      await db
        .selectFrom('woodlandDeposits')
        .select(['remainingAmount', 'reservedAmount'])
        .where('featureId', '=', featureId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ remainingAmount: '1000', reservedAmount: '200' });
  } finally {
    release?.();
    await Promise.allSettled([first, second].filter((p): p is Promise<string> => Boolean(p)));
    await resetE2eState(url);
    await dropGrove(featureId);
    if (other.account) await db.deleteFrom('accounts').where('id', '=', other.account).execute();
  }
}, 60_000);

it('rolls back a felled tree, its debit, the delivery and the workers after an identified error', async () => {
  await resetE2eState(url);
  const { id } = await committedGrove();
  const snapshot = async () => ({
    deposit: await db.selectFrom('woodlandDeposits').selectAll().where('featureId', '=', id).executeTakeFirstOrThrow(),
    trees: await db.selectFrom('woodlandTrees').selectAll().where('featureId', '=', id).execute(),
    feature: await db.selectFrom('worldFeatures').selectAll().where('id', '=', id).executeTakeFirstOrThrow(),
    occupancies: await db.selectFrom('worldCellOccupancies').selectAll().where('featureId', '=', id).execute(),
    lots: await db.selectFrom('depositExtractions').selectAll().where('featureId', '=', id).execute(),
    resources: await db
      .selectFrom('villageResources')
      .selectAll()
      .where('villageId', '=', villageId)
      .orderBy('resourceCode')
      .execute(),
    cohorts: await db
      .selectFrom('populationCohorts')
      .selectAll()
      .where('villageId', '=', villageId)
      .orderBy('id')
      .execute(),
    tasks: await db
      .selectFrom('scheduledTasks')
      .select(['taskType', 'subjectId'])
      .where('worldId', '=', worldId)
      .where('taskType', '=', 'deposit.extraction.complete')
      .orderBy('subjectId')
      .execute(),
  });
  const injected = new Error('EXPECTED_WOODLAND_ROLLBACK');
  try {
    const before = await snapshot();
    await expect(
      db.transaction().execute(async (tx) => {
        const economy = await beginVillageEconomy(tx, worldId, villageId, id);
        const work = await lot(tx, await startStoneExtraction(tx, village, economy, id, randomUUID(), 1));
        await completeStoneExtractionAt(tx, worldId, villageId, work.id, work.completesAt);
        await startStoneExtraction(tx, village, { ...economy, through: work.completesAt }, id, randomUUID(), 1);
        // The writes took place before the error.
        expect(await tree(tx, id, 0)).toMatchObject({ remainingAmount: 400, reservedAmount: 100 });
        expect(await stock(tx)).toBe(BigInt(before.resources.find((r) => r.resourceCode === 'wood')!.amount) + 100n);
        expect(
          await tx
            .selectFrom('woodlandDeposits')
            .select(['remainingAmount', 'reservedAmount', 'cutAmount'])
            .where('featureId', '=', id)
            .executeTakeFirstOrThrow(),
        ).toEqual({ remainingAmount: '900', reservedAmount: '100', cutAmount: '100' });
        throw injected;
      }),
    ).rejects.toBe(injected);
    expect(await snapshot()).toEqual(before);
  } finally {
    await dropGrove(id);
  }
}, 60_000);

// Slices 2c and 2d (docs/PLAN-BOIS-ARBRE-TRANCHE-2.md): designated trees in
// commands, and the state of each tree exposed to the readers.
const trail: TravelCell[] = [{ cellX: 1024, cellY: 512 }, { cellX: 1024, cellY: 513 }, cell];
/** Runs a worksite lot by lot, each debited at its deadline, until it completes. */
async function runSite(tx: Transaction<Database>, siteId: string, t: Date, max = 20) {
  const lots: Array<Awaited<ReturnType<typeof lot>>> = [];
  let at = t;
  for (let step = 0; step < 160 && lots.length < max; step++) {
    await admitWorksites(tx, { worldId, villageId, through: at }, village, async () => trail);
    const running = await tx
      .selectFrom('depositExtractions')
      .selectAll()
      .where('worksiteId', '=', siteId)
      .where('status', '=', 'in-progress')
      .executeTakeFirst();
    if (!running) {
      const site = await tx
        .selectFrom('extractionWorksites')
        .select('status')
        .where('id', '=', siteId)
        .executeTakeFirstOrThrow();
      if (site.status === 'completed') break;
      at = new Date(at.getTime() + 3_600_000); // Workers rest, then the site resumes.
      continue;
    }
    lots.push(running);
    at = running.completesAt;
    await completeStoneExtractionAt(tx, worldId, villageId, running.id, at);
  }
  return lots;
}
const targetOf = (tx: Transaction<Database>, siteId: string) =>
  tx
    .selectFrom('extractionWorksiteTargets')
    .select(['status', 'reason', 'treeIndices'])
    .where('worksiteId', '=', siteId)
    .executeTakeFirstOrThrow();
/** Trees already cut on the fixture case: stumps (0) or trunks, the case kept as their sum. */
async function cut(tx: Transaction<Database>, id: string, t: Date, trees: number, rows: Record<number, number>) {
  await tx
    .insertInto('woodlandTrees')
    .values(
      Object.entries(rows).map(([i, remainingAmount]) => ({
        worldId,
        featureId: id,
        treeIndex: Number(i),
        remainingAmount,
        felledAt: t,
      })),
    )
    .execute();
  const left = Object.values(rows).reduce((sum, n) => sum + n, 0) + 500 * (trees - Object.keys(rows).length);
  await tx
    .updateTable('woodlandDeposits')
    .set({ remainingAmount: left, cutAmount: 500 * trees - left })
    .where('featureId', '=', id)
    .execute();
}
const lotsOf = (lots: Array<{ treeIndex: number | null; reservedAmount: string }>) =>
  lots.map((l) => [l.treeIndex, Number(l.reservedAmount)]);
const five = (tree: number) => Array.from({ length: 5 }, () => [tree, 100]);

it('fells only the designated trees, in the order designated, then completes the target', async () => {
  await fixture(async (tx, id, t) => {
    const siteId = await createWorksite(
      tx,
      { worldId, villageId, through: t },
      {
        commandId: randomUUID(),
        mode: 'cut',
        workerCap: 10,
        featureIds: [id],
        woodTrees: [{ featureId: id, treeIndices: [2, 0] }],
      },
    );
    expect((await targetOf(tx, siteId)).treeIndices).toEqual([2, 0]);
    const lots = await runSite(tx, siteId, t);
    // Tree 2 first, as designated, then tree 0; trees 1 and 3 stand untouched.
    expect(lotsOf(lots)).toEqual([...five(2), ...five(0)]);
    expect(await tree(tx, id, 1)).toBeUndefined();
    expect(await tree(tx, id, 3)).toBeUndefined();
    expect(await targetOf(tx, siteId)).toEqual({ status: 'completed', reason: 'goal-reached', treeIndices: [2, 0] });
    expect(await readStoneDeposit(tx, worldId, id)).toMatchObject({ remainingAmount: 1000, cleared: false });
  }, 4);
}, 120_000);

it('clears only the designated trees and stumps, and leaves the case occupied while a tree stands', async () => {
  await fixture(async (tx, id, t) => {
    // Tree 0 is already a stump; tree 1 stands, tree 2 stands and is not designated.
    await cut(tx, id, t, 3, { 0: 0 });
    const siteId = await createWorksite(
      tx,
      { worldId, villageId, through: t },
      {
        commandId: randomUUID(),
        mode: 'clear',
        workerCap: 10,
        featureIds: [id],
        woodTrees: [{ featureId: id, treeIndices: [0, 1] }],
      },
    );
    const lots = await runSite(tx, siteId, t);
    // The wood of tree 1, then the stumps one by one in the designated order.
    expect(lotsOf(lots)).toEqual([...five(1), [0, 0], [1, 0]]);
    expect((await tree(tx, id, 0))!.stumpRemovedAt).toEqual(lots[5]!.completesAt);
    expect((await tree(tx, id, 1))!.stumpRemovedAt).toEqual(lots[6]!.completesAt);
    expect(await tree(tx, id, 2)).toBeUndefined();
    expect((await targetOf(tx, siteId)).status).toBe('completed');
    // Not cleared: tree 2 still stands, so the case stays occupied and unbuildable.
    expect(await readStoneDeposit(tx, worldId, id)).toMatchObject({
      cleared: false,
      state: 'available',
      blocksCell: true,
      remainingAmount: 500,
      cutAmount: 1000,
    });
    expect(await occupied(tx, id)).toBe(1);
  }, 3);
}, 120_000);

it('clears a whole case designated tree by tree, in that order, and frees it at its last stump', async () => {
  await fixture(async (tx, id, t) => {
    const siteId = await createWorksite(
      tx,
      { worldId, villageId, through: t },
      {
        commandId: randomUUID(),
        mode: 'clear',
        workerCap: 10,
        featureIds: [id],
        woodTrees: [{ featureId: id, treeIndices: [1, 0] }],
      },
    );
    const lots = await runSite(tx, siteId, t);
    expect(lotsOf(lots)).toEqual([...five(1), ...five(0), [1, 0], [0, 0]]);
    expect(await readStoneDeposit(tx, worldId, id)).toMatchObject({
      cleared: true,
      state: 'depleted',
      blocksCell: false,
    });
    expect(await occupied(tx, id)).toBe(0);
    expect((await targetOf(tx, siteId)).status).toBe('completed');
  });
}, 120_000);

it('refuses a tree the case does not have, and a cut designation of stumps only', async () => {
  await fixture(async (tx, id, t) => {
    await cut(tx, id, t, 3, { 0: 0, 1: 200 });
    const owned = await ownedVillage(tx, DEVELOPMENT_IDS.account, 'aube', villageId);
    const economy = { worldId, villageId, through: t };
    const select = (mode: 'cut' | 'clear', treeIndices: number[]) =>
      prepareWorksiteSelection(
        tx,
        owned,
        economy,
        {
          commandId: randomUUID(),
          mode,
          workerCap: 10,
          featureIds: [id],
          woodTrees: [{ featureId: id, treeIndices }],
        },
        async () => trail,
      );
    const at = { featureId: id, cellX: cell.cellX, cellY: cell.cellY };
    // Tree 7 is not in the case; the stump (0) is left out of a cut, silently.
    expect(await select('cut', [1, 7, 0, 2])).toEqual({
      included: [{ ...at, treeIndices: [1, 2] }],
      excluded: [{ featureId: id, reason: 'tree-not-found', treeIndex: 7 }],
    });
    expect(await select('cut', [0])).toEqual({ included: [], excluded: [{ featureId: id, reason: 'depleted' }] });
    expect(await select('cut', [9])).toEqual({
      included: [],
      excluded: [{ featureId: id, reason: 'tree-not-found', treeIndex: 9 }],
    });
    // A clearing keeps the stump: it is work to do.
    expect(await select('clear', [0, 2])).toEqual({ included: [{ ...at, treeIndices: [0, 2] }], excluded: [] });
    // A designation must name a selected case.
    await expect(
      prepareWorksiteSelection(
        tx,
        owned,
        economy,
        {
          commandId: randomUUID(),
          mode: 'cut',
          workerCap: 10,
          featureIds: [id],
          woodTrees: [{ featureId: randomUUID(), treeIndices: [0] }],
        },
        async () => trail,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'WOOD_TREES_OUTSIDE_SELECTION' });
  }, 3);
}, 60_000);

it('queues designated trees, merges new ones into the queued case and refuses a replay with other trees', async () => {
  await fixture(async (tx, id) => {
    const source = {
      transaction: () => ({ execute: <T>(run: (tx: Transaction<Database>) => Promise<T>) => run(tx) }),
    } as unknown as typeof db;
    const intent = (commandId: string, treeIndices?: number[]) =>
      acceptHarvestIntent(source, DEVELOPMENT_IDS.account, 'aube', villageId, {
        commandId,
        gardens: [],
        wood: [id],
        ...(treeIndices ? { woodTrees: [{ featureId: id, treeIndices }] } : {}),
        stone: [],
      });
    const queued = async () =>
      (
        await tx
          .selectFrom('extractionWorksiteTargets as t')
          .innerJoin('extractionWorksites as s', 's.id', 't.worksiteId')
          .select('t.treeIndices')
          .where('t.featureId', '=', id)
          .where('t.status', '=', 'pending')
          .where('s.poolResource', '=', 'wood')
          .executeTakeFirstOrThrow()
      ).treeIndices;
    const first = randomUUID();
    expect(await intent(first, [2])).toMatchObject({
      accepted: [{ key: id, resource: 'wood', amount: 500, treeIndices: [2] }],
      refused: [],
    });
    expect(await queued()).toEqual([2]);
    // The same intent with other trees is another command.
    await expect(intent(first, [1])).rejects.toMatchObject({ statusCode: 409, code: 'COMMAND_ID_CONFLICT' });
    expect((await intent(first, [2])).accepted).toHaveLength(1);
    // New trees join the queued case after its own; a foreign tree is refused alone.
    expect(await intent(randomUUID(), [1, 2, 7])).toMatchObject({
      accepted: [{ key: id, treeIndices: [1] }],
      refused: [{ key: id, reason: 'tree-not-found', treeIndex: 7 }],
    });
    expect(await queued()).toEqual([2, 1]);
    // Nothing new: already planned.
    expect((await intent(randomUUID(), [2])).refused).toEqual([{ key: id, reason: 'already-assigned' }]);
    // The whole case takes all of its trees; nothing can be added after.
    expect((await intent(randomUUID())).accepted).toMatchObject([{ key: id, amount: 1500 }]);
    expect(await queued()).toBeNull();
    expect((await intent(randomUUID(), [0])).refused).toEqual([{ key: id, reason: 'already-assigned' }]);
  }, 3);
}, 120_000);

it('exposes a felled tree and a stump to the chunk, spatial, snapshot and details readers', async () => {
  await fixture(async (tx, id, t) => {
    const world = await tx.selectFrom('worlds').selectAll().where('id', '=', worldId).executeTakeFirstOrThrow();
    const size = world.chunkSize,
      chunk = { chunkX: Math.floor(cell.cellX / size), chunkY: Math.floor(cell.cellY / size) };
    const readers = async () => {
      const terrain = await readTerrainProjection(
        tx,
        DEVELOPMENT_IDS.account,
        'aube',
        `${chunk.chunkX},${chunk.chunkY}`,
        false,
      );
      const spatial = await readSpatialChanges(
        tx,
        {
          worldId,
          worldSlug: 'aube',
          accountId: DEVELOPMENT_IDS.account,
          widthCells: world.widthCells,
          heightCells: world.heightCells,
          chunkSize: size,
          generationVersion: world.generationVersion,
          ...chunk,
        },
        [{ component: 'spatialFeatures', key: id }],
      );
      for (const change of spatial)
        expect([...Value.Errors(SyncV2ChangeSchema, change)].map((error) => error.message)).toEqual([]);
      const located = spatial[0]!.component === 'spatialFeatures' ? spatial[0]!.upsert[0]!.locations[0]! : null;
      return {
        chunk: terrain.chunks[0]!.features.find((f) => f.id === id)!.deposit!,
        spatial: located!.deposit!,
      };
    };
    // A lot fells tree 0: its trunk holds 500, 100 of them reserved.
    const work = await lot(
      tx,
      await startStoneExtraction(tx, village, { worldId, villageId, through: t }, id, randomUUID(), 1),
    );
    const felled = {
      treeIndex: 0,
      remainingAmount: 500,
      reservedAmount: 100,
      felledAt: t.toISOString(),
      stumpRemoved: false,
    };
    const read = await readers();
    expect(read.chunk.trees).toEqual([felled]);
    expect(read.spatial.trees).toEqual([felled]);
    // A lot due and not yet debited shows as cut, on the tree as on the case.
    await sql`select set_config('arbestra.economy_through', ${work.completesAt.toISOString()}, true)`.execute(tx);
    const due = await readers();
    expect(due.chunk).toMatchObject({ remainingAmount: 900, reservedAmount: 0 });
    expect(due.chunk.trees).toEqual([{ ...felled, remainingAmount: 400, reservedAmount: 0 }]);
    await sql`select set_config('arbestra.economy_through', '', true)`.execute(tx);
    // Tree 1 down to a stump, then its stump removed (the case still stands: tree 0).
    await tx
      .insertInto('woodlandTrees')
      .values({ worldId, featureId: id, treeIndex: 1, remainingAmount: 0, felledAt: t })
      .execute();
    const stump = { treeIndex: 1, remainingAmount: 0, reservedAmount: 0, felledAt: t.toISOString() };
    expect((await readers()).chunk.trees).toEqual([felled, { ...stump, stumpRemoved: false }]);
    await tx
      .updateTable('woodlandTrees')
      .set({ stumpRemovedAt: t })
      .where('featureId', '=', id)
      .where('treeIndex', '=', 1)
      .execute();
    const removed = { ...stump, stumpRemoved: true };
    expect((await readers()).spatial.trees).toEqual([felled, removed]);
    // The village snapshot and the grove's sheet show the same trees.
    const snapshot = await state(tx, DEVELOPMENT_IDS.account, 'aube', { worldId, villageId, through: t }, false, true);
    expect(snapshot.region.features.find((f) => f.id === id)!.deposit!.trees).toEqual([felled, removed]);
    const owned = await ownedVillage(tx, DEVELOPMENT_IDS.account, 'aube', villageId);
    const details = await readVillageDepositDetails(
      tx,
      DEVELOPMENT_IDS.account,
      owned,
      { worldId, villageId, through: t },
      id,
    );
    expect(details.deposit.trees).toEqual([felled, removed]);
    // The village knows which tree its lot works on.
    expect(snapshot.village.extractions.find((e) => e.id === work.id)).toMatchObject({ treeIndex: 0 });
  });
}, 120_000);

it('shows the designated trees of a queued target to its village, with its mode', async () => {
  await fixture(async (tx, id, t) => {
    const siteId = await createWorksite(
      tx,
      { worldId, villageId, through: t },
      {
        commandId: randomUUID(),
        mode: 'clear',
        workerCap: 10,
        featureIds: [id],
        woodTrees: [{ featureId: id, treeIndices: [1] }],
      },
    );
    const snapshot = await state(tx, DEVELOPMENT_IDS.account, 'aube', { worldId, villageId, through: t }, false, true);
    expect(snapshot.village.worksites.find((site) => site.id === siteId)).toMatchObject({
      mode: 'clear',
      targets: [{ featureId: id, status: 'pending', treeIndices: [1] }],
    });
  });
}, 60_000);

it('publishes the chunk of a case to the journal when a tree falls and when a stump is removed', async () => {
  await resetE2eState(url);
  const { id } = await committedGrove();
  const world = await db.selectFrom('worlds').selectAll().where('id', '=', worldId).executeTakeFirstOrThrow();
  const size = world.chunkSize,
    chunk = { chunkX: Math.floor(cell.cellX / size), chunkY: Math.floor(cell.cellY / size) },
    scope = `${chunk.chunkX},${chunk.chunkY}`;
  const pending = async (tx: Transaction<Database>) =>
    (
      await sql<{ n: number }>`select count(*)::int as n from game_sync_pending where transaction_id=txid_current()
        and world_id=${worldId} and stream_kind='spatial' and scope_key=${scope}
        and component='spatialFeatures' and entity_key=${id}`.execute(tx)
    ).rows[0]!.n;
  /** Publishes this transaction, then reads back its journal entry and the reader's trees. */
  const published = async (tx: Transaction<Database>) => {
    await sql`select game_sync_publish()`.execute(tx);
    const entry = await sql<{ changes: Array<{ component: string; key: string }> }>`select changes
      from game_sync_changes where world_id=${worldId} and stream_kind='spatial' and scope_key=${scope}
      order by revision desc limit 1`.execute(tx);
    expect(entry.rows[0]!.changes).toContainEqual({ component: 'spatialFeatures', key: id });
    const [change] = await readSpatialChanges(
      tx,
      {
        worldId,
        worldSlug: 'aube',
        accountId: DEVELOPMENT_IDS.account,
        widthCells: world.widthCells,
        heightCells: world.heightCells,
        chunkSize: size,
        generationVersion: world.generationVersion,
        ...chunk,
      },
      [{ component: 'spatialFeatures', key: id }],
    );
    return change!.component === 'spatialFeatures' ? change!.upsert[0]!.locations[0]!.deposit!.trees : undefined;
  };
  try {
    await expect(
      db.transaction().execute(async (tx) => {
        const economy = await beginVillageEconomy(tx, worldId, villageId, id);
        expect(await pending(tx)).toBe(0);
        await startStoneExtraction(tx, village, economy, id, randomUUID(), 1);
        expect(await pending(tx)).toBe(1);
        expect(await published(tx)).toMatchObject([{ treeIndex: 0, remainingAmount: 500, reservedAmount: 100 }]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    // Both trees already stumps (committed), then a clearing removes stump 0.
    await db.transaction().execute(async (tx) => {
      const t = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
      await cut(tx, id, t, 2, { 0: 0, 1: 0 });
    });
    await expect(
      db.transaction().execute(async (tx) => {
        const economy = await beginVillageEconomy(tx, worldId, villageId, id);
        const siteId = await createWorksite(tx, economy, {
          commandId: randomUUID(),
          mode: 'clear',
          workerCap: 10,
          featureIds: [id],
          woodTrees: [{ featureId: id, treeIndices: [0] }],
        });
        await admitWorksites(tx, economy, village, async () => trail);
        const removal = await tx
          .selectFrom('depositExtractions')
          .selectAll()
          .where('worksiteId', '=', siteId)
          .executeTakeFirstOrThrow();
        expect(lotsOf([removal])).toEqual([[0, 0]]);
        // Starting a stump removal changes nothing a reader shows.
        expect(await pending(tx)).toBe(0);
        await completeStoneExtractionAt(tx, worldId, villageId, removal.id, removal.completesAt);
        expect(await pending(tx)).toBe(1);
        expect(await published(tx)).toMatchObject([
          { treeIndex: 0, stumpRemoved: true },
          { treeIndex: 1, stumpRemoved: false },
        ]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  } finally {
    await resetE2eState(url);
    await dropGrove(id);
  }
}, 120_000);

// Slice 2e (docs/PLAN-BOIS-ARBRE-TRANCHE-2.md): the wood queue in cut or clear
// mode, consumed by the pool (the Chantier panel), and « Annuler » a gesture.
const local = (tx: Transaction<Database>) =>
  ({
    transaction: () => ({ execute: <T>(run: (tx: Transaction<Database>) => Promise<T>) => run(tx) }),
  }) as unknown as typeof db;
/** A gesture on the trees of one case, in a mode. */
const gesture = (
  source: typeof db,
  featureId: string,
  commandId: string,
  treeIndices: number[] | null,
  woodMode?: 'cut' | 'clear',
) =>
  acceptHarvestIntent(source, DEVELOPMENT_IDS.account, 'aube', villageId, {
    commandId,
    gardens: [],
    wood: [featureId],
    ...(treeIndices ? { woodTrees: [{ featureId, treeIndices }] } : {}),
    ...(woodMode ? { woodMode } : {}),
    stone: [],
  });
/** The pending wood queue target of a case, for this village. */
const queuedCase = (tx: Transaction<Database> | typeof db, featureId: string) =>
  tx
    .selectFrom('extractionWorksiteTargets as t')
    .innerJoin('extractionWorksites as s', 's.id', 't.worksiteId')
    .select(['t.treeIndices', 't.clearTreeIndices', 't.designations', 't.worksiteId'])
    .where('t.worldId', '=', worldId)
    .where('t.villageId', '=', villageId)
    .where('t.featureId', '=', featureId)
    .where('t.status', '=', 'pending')
    .where('s.poolResource', '=', 'wood')
    .executeTakeFirst();
const poolSite = async (tx: Transaction<Database>) =>
  (
    await tx
      .selectFrom('extractionWorksites')
      .select('id')
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('poolResource', '=', 'wood')
      .orderBy('createdAt')
      .orderBy('id')
      .executeTakeFirstOrThrow()
  ).id;
const cancelIn = (tx: Transaction<Database>, commandId: string) =>
  cancelHarvestIntentIn(tx, DEVELOPMENT_IDS.account, 'aube', villageId, commandId);

it('queues trees for clearing through a gesture: the queue fells them, then removes their stumps only', async () => {
  await fixture(async (tx, id, t) => {
    const source = local(tx);
    // Tree 2 to clear, then tree 0 for its wood only; tree 1 is not designated.
    expect(await gesture(source, id, randomUUID(), [2], 'clear')).toMatchObject({
      accepted: [{ key: id, resource: 'wood', amount: 500, treeIndices: [2], woodMode: 'clear' }],
      refused: [],
    });
    expect((await gesture(source, id, randomUUID(), [0])).accepted[0]).not.toHaveProperty('woodMode');
    expect(await queuedCase(tx, id)).toMatchObject({ treeIndices: [2, 0], clearTreeIndices: [2] });
    // The village reads which trees are queued, and which for clearing.
    const snapshot = await state(tx, DEVELOPMENT_IDS.account, 'aube', { worldId, villageId, through: t }, false, true);
    expect(snapshot.village.worksites.find((site) => site.poolResource === 'wood')).toMatchObject({
      mode: 'cut',
      targets: [{ featureId: id, status: 'pending', treeIndices: [2, 0], clearTreeIndices: [2] }],
    });
    // The pool consumes the queue with its own team: wood first, in the designated order, then stump 2.
    const lots = await runSite(tx, await poolSite(tx), t, 11);
    expect(lotsOf(lots)).toEqual([...five(2), ...five(0), [2, 0]]);
    expect(lots[10]!.workerCount).toBe(1);
    expect((await tree(tx, id, 2))!.stumpRemovedAt).toEqual(lots[10]!.completesAt);
    expect(await tree(tx, id, 0)).toMatchObject({ remainingAmount: 0, stumpRemovedAt: null });
    expect(await tree(tx, id, 1)).toBeUndefined();
    expect(await queuedCase(tx, id)).toBeUndefined();
    expect(await readStoneDeposit(tx, worldId, id)).toMatchObject({ cleared: false, blocksCell: true });
    expect(await occupied(tx, id)).toBe(1);
  }, 3);
}, 120_000);

it('lets a clearing include a cut: a cut tree designated again is cleared, the reverse adds nothing', async () => {
  await fixture(async (tx, id) => {
    const source = local(tx),
      clear2 = randomUUID();
    await gesture(source, id, randomUUID(), [0, 1]);
    expect(await queuedCase(tx, id)).toMatchObject({ treeIndices: [0, 1], clearTreeIndices: null });
    // Tree 1 goes further (clearing), tree 2 joins for clearing.
    expect((await gesture(source, id, clear2, [1, 2], 'clear')).accepted).toMatchObject([
      { key: id, treeIndices: [1, 2], woodMode: 'clear' },
    ]);
    expect(await queuedCase(tx, id)).toMatchObject({ treeIndices: [0, 1, 2], clearTreeIndices: [1, 2] });
    // Cutting a tree queued for clearing, or clearing it again: already planned.
    expect((await gesture(source, id, randomUUID(), [2])).refused).toEqual([{ key: id, reason: 'already-assigned' }]);
    expect((await gesture(source, id, randomUUID(), [1], 'clear')).refused).toEqual([
      { key: id, reason: 'already-assigned' },
    ]);
    // Clearing the whole case takes only the trees not cleared yet.
    expect((await gesture(source, id, randomUUID(), null, 'clear')).accepted).toMatchObject([
      { key: id, treeIndices: [0], woodMode: 'clear' },
    ]);
    expect(await queuedCase(tx, id)).toMatchObject({ treeIndices: [0, 1, 2], clearTreeIndices: [1, 2, 0] });
    // A replay of the clearing is the same command; with another mode it is another one.
    expect((await gesture(source, id, clear2, [1, 2], 'clear')).accepted).toHaveLength(1);
    await expect(gesture(source, id, clear2, [1, 2])).rejects.toMatchObject({ code: 'COMMAND_ID_CONFLICT' });
  }, 3);
}, 120_000);

it('cancels a gesture: its trees not taken leave the queue, the tree of a lot under way stays; a replay changes nothing', async () => {
  await fixture(async (tx, id, t) => {
    const g = randomUUID();
    await gesture(local(tx), id, g, [2, 0, 1]);
    // The pool takes tree 2: its first lot is under way.
    await admitWorksites(tx, { worldId, villageId, through: t }, village, async () => trail);
    const running = await tx
      .selectFrom('depositExtractions')
      .selectAll()
      .where('featureId', '=', id)
      .where('status', '=', 'in-progress')
      .execute();
    expect(lotsOf(running)).toEqual([[2, 100]]);
    const receipt = await cancelIn(tx, g);
    expect(receipt).toEqual({
      commandId: g,
      trees: [
        { featureId: id, treeIndex: 2, outcome: 'in-progress', mode: 'cut' },
        { featureId: id, treeIndex: 0, outcome: 'removed' },
        { featureId: id, treeIndex: 1, outcome: 'removed' },
      ],
    });
    const queued = await queuedCase(tx, id);
    expect(queued).toMatchObject({
      treeIndices: [2],
      clearTreeIndices: null,
      designations: [{ commandId: g, mode: 'cut', treeIndices: [2] }],
    });
    // Replayed: the same receipt, and nothing written.
    const rows = async () => ({
      targets: await tx.selectFrom('extractionWorksiteTargets').selectAll().where('featureId', '=', id).execute(),
      lots: await tx.selectFrom('depositExtractions').selectAll().where('featureId', '=', id).execute(),
      cancellations: await tx.selectFrom('harvestIntentCancellations').selectAll().where('commandId', '=', g).execute(),
    });
    const before = await rows();
    expect(before.cancellations).toHaveLength(1);
    expect(await cancelIn(tx, g.toUpperCase())).toEqual(receipt);
    expect(await rows()).toEqual(before);
    // The lot under way is delivered, then tree 2 is finished; trees 0 and 1 stand.
    await completeStoneExtractionAt(tx, worldId, villageId, running[0]!.id, running[0]!.completesAt);
    const rest = await runSite(tx, queued!.worksiteId, running[0]!.completesAt, 4);
    expect(lotsOf(rest)).toEqual(five(2).slice(1));
    expect(await tree(tx, id, 2)).toMatchObject({ remainingAmount: 0 });
    expect(await tree(tx, id, 0)).toBeUndefined();
    expect(await tree(tx, id, 1)).toBeUndefined();
    expect(await queuedCase(tx, id)).toBeUndefined();
  }, 3);
}, 120_000);

it('withdraws only the trees of the gesture from a case another gesture queued first', async () => {
  await fixture(async (tx, id, t) => {
    const source = local(tx),
      first = randomUUID(),
      merged = randomUUID(),
      last = randomUUID();
    await gesture(source, id, first, [0]);
    // Merged into the queued case: tree 0 taken further (clearing), tree 1 added.
    await gesture(source, id, merged, [0, 1], 'clear');
    await gesture(source, id, last, [2]);
    expect(await queuedCase(tx, id)).toMatchObject({ treeIndices: [0, 1, 2], clearTreeIndices: [0, 1] });
    // Tree 0 stays, back to its first gesture's cut; tree 1 leaves.
    expect((await cancelIn(tx, merged)).trees).toEqual([
      { featureId: id, treeIndex: 0, outcome: 'queued', mode: 'cut' },
      { featureId: id, treeIndex: 1, outcome: 'removed' },
    ]);
    expect(await queuedCase(tx, id)).toMatchObject({
      treeIndices: [0, 2],
      clearTreeIndices: null,
      designations: [
        { commandId: first, mode: 'cut', treeIndices: [0] },
        { commandId: last, mode: 'cut', treeIndices: [2] },
      ],
    });
    expect((await cancelIn(tx, first)).trees).toEqual([{ featureId: id, treeIndex: 0, outcome: 'removed' }]);
    expect(await queuedCase(tx, id)).toMatchObject({ treeIndices: [2] });
    // The last gesture empties the case: it leaves the queue, no team is held or sent.
    expect((await cancelIn(tx, last)).trees).toEqual([{ featureId: id, treeIndex: 2, outcome: 'removed' }]);
    expect(await queuedCase(tx, id)).toBeUndefined();
    expect(
      await tx.selectFrom('extractionWorksiteTargets').select('status').where('featureId', '=', id).execute(),
    ).toEqual([]);
    await admitWorksites(tx, { worldId, villageId, through: t }, village, async () => trail);
    expect(await tx.selectFrom('depositExtractions').select('id').where('featureId', '=', id).execute()).toEqual([]);
    expect((await readExtractionPools(tx, worldId, villageId, ['wood']))[0]).toMatchObject({
      mobilized: 0,
      activeSites: 0,
      pendingTargets: 0,
    });
    expect(
      await tx
        .selectFrom('populationCohorts')
        .select('id')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('extractionId', 'is not', null)
        .execute(),
    ).toEqual([]);
  }, 3);
}, 120_000);

it('refuses to cancel the gesture of another village, and leaves its queue untouched', async () => {
  await fixture(async (tx, id, t) => {
    const other = await neighbour(tx, t),
      g = randomUUID();
    await gesture(local(tx), id, g, [1]);
    const before = await queuedCase(tx, id);
    // The other player names the gesture from its own village: not found there.
    await expect(cancelHarvestIntentIn(tx, other.account, 'aube', other.id, g)).rejects.toMatchObject({
      statusCode: 404,
      code: 'HARVEST_INTENT_NOT_FOUND',
    });
    // Nor can it reach the village that owns the gesture.
    await expect(cancelHarvestIntentIn(tx, other.account, 'aube', villageId, g)).rejects.toMatchObject({
      statusCode: 404,
      code: 'VILLAGE_NOT_FOUND',
    });
    expect(await queuedCase(tx, id)).toEqual(before);
    expect(
      await tx.selectFrom('harvestIntentCancellations').select('commandId').where('commandId', '=', g).execute(),
    ).toEqual([]);
  }, 3);
}, 60_000);

it('cancels a gesture before the worker processes it: its wood is never queued', async () => {
  await resetE2eState(url);
  const { id } = await committedGrove();
  const g = randomUUID();
  try {
    expect(
      await receiveHarvestIntent(db, DEVELOPMENT_IDS.account, 'aube', villageId, {
        commandId: g,
        gardens: [],
        wood: [id],
        woodTrees: [{ featureId: id, treeIndices: [1, 0] }],
        woodMode: 'clear',
        stone: [],
      }),
    ).toMatchObject({ pending: true });
    const receipt = await cancelHarvestIntent(db, DEVELOPMENT_IDS.account, 'aube', villageId, g);
    expect(receipt).toEqual({
      commandId: g,
      beforeQueue: true,
      trees: [
        { featureId: id, treeIndex: 1, outcome: 'removed' },
        { featureId: id, treeIndex: 0, outcome: 'removed' },
      ],
    });
    // The worker comes afterwards: the intent is refused, nothing joins the queue.
    await db.transaction().execute((tx) =>
      processHarvestSubmission(tx, {
        id: randomUUID(),
        worldId,
        taskType: HARVEST_SUBMISSION_TASK,
        subjectId: randomUUID(),
        payload: { villageId, commandId: g },
        dueAt: new Date(),
        availableAt: new Date(),
        attempts: 0,
        lastError: null,
        completedAt: null,
      } as unknown as ScheduledTask),
    );
    expect((await readHarvestReceipts(db, DEVELOPMENT_IDS.account, 'aube', villageId, [g]))[0]).toEqual({
      commandId: g,
      accepted: [],
      refused: [{ key: id, reason: 'cancelled' }],
    });
    expect(await queuedCase(db, id)).toBeUndefined();
    expect(await cancelHarvestIntent(db, DEVELOPMENT_IDS.account, 'aube', villageId, g)).toEqual(receipt);
  } finally {
    await resetE2eState(url);
    await dropGrove(id);
  }
}, 60_000);

/** A cancellation and the worker that takes the same tree: the first holds the
 * village (barrier), the second waits for it in PostgreSQL, then both finish. */
async function race(firstIs: 'worker' | 'cancel') {
  await resetE2eState(url);
  const { id } = await committedGrove();
  const g = randomUUID();
  await gesture(db, id, g, [1, 0]);
  let release!: () => void, ready!: () => void, waiting!: (pid: number) => void;
  const held = new Promise<void>((resolve) => (ready = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const waiterPid = new Promise<number>((resolve) => (waiting = resolve));
  const within = <T>(promise: Promise<T>) => {
    let timer!: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('cancellation concurrency timeout')), 10000);
      }),
    ]).finally(() => clearTimeout(timer));
  };
  const pid = async (tx: Transaction<Database>) =>
    (await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;
  let holder = 0;
  /** The worker's wake: the village, then its admission, held at its route search when first. */
  const worker = (hold: boolean) =>
    db.transaction().execute(async (tx) => {
      if (hold) holder = await pid(tx);
      else waiting(await pid(tx));
      const economy = await beginVillageEconomy(tx, worldId, villageId);
      await admitWorksites(tx, economy, village, async () => {
        if (hold) {
          ready();
          await gate;
        }
        return trail;
      });
      return undefined;
    });
  const cancel = (hold: boolean) =>
    db.transaction().execute(async (tx) => {
      if (hold) holder = await pid(tx);
      else waiting(await pid(tx));
      const receipt = await cancelIn(tx, g);
      if (hold) {
        ready();
        await gate;
      }
      return receipt;
    });
  let first: Promise<HarvestCancelReceipt | undefined> | undefined,
    second: Promise<HarvestCancelReceipt | undefined> | undefined;
  try {
    first = firstIs === 'worker' ? worker(true) : cancel(true);
    await within(held);
    second = firstIs === 'worker' ? cancel(false) : worker(false);
    const waiter = await within(waiterPid),
      deadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < deadline) {
      blocked = (
        await db
          .selectNoFrom(sql<boolean>`${holder}=any(pg_blocking_pids(${waiter}))`.as('blocked'))
          .executeTakeFirstOrThrow()
      ).blocked;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    release();
    const [a, b] = await within(Promise.all([first, second]));
    return {
      receipt: (firstIs === 'cancel' ? a : b)!,
      lots: await db
        .selectFrom('depositExtractions')
        .select(['treeIndex', 'reservedAmount', 'status'])
        .where('featureId', '=', id)
        .execute(),
      trees: await db
        .selectFrom('woodlandTrees')
        .select(['treeIndex', 'remainingAmount', 'reservedAmount'])
        .where('featureId', '=', id)
        .execute(),
      deposit: await db
        .selectFrom('woodlandDeposits')
        .select(['remainingAmount', 'reservedAmount'])
        .where('featureId', '=', id)
        .executeTakeFirstOrThrow(),
      queued: await queuedCase(db, id),
      id,
    };
  } finally {
    release?.();
    await Promise.allSettled([first, second].filter((p) => p !== undefined));
    await resetE2eState(url);
    await dropGrove(id);
  }
}

it('lets the worker win when it takes the tree first: the cancellation keeps that tree and withdraws the other', async () => {
  const { receipt, lots, trees, deposit, queued, id } = await race('worker');
  expect(lots).toEqual([{ treeIndex: 1, reservedAmount: '100', status: 'in-progress' }]);
  expect(trees).toEqual([{ treeIndex: 1, remainingAmount: 500, reservedAmount: 100 }]);
  expect(deposit).toEqual({ remainingAmount: '1000', reservedAmount: '100' });
  expect(receipt.trees).toEqual([
    { featureId: id, treeIndex: 1, outcome: 'in-progress', mode: 'cut' },
    { featureId: id, treeIndex: 0, outcome: 'removed' },
  ]);
  expect(queued).toMatchObject({ treeIndices: [1] });
}, 60_000);

it('lets the cancellation win when it holds the village first: the worker then takes nothing', async () => {
  const { receipt, lots, trees, deposit, queued, id } = await race('cancel');
  expect(receipt.trees).toEqual([
    { featureId: id, treeIndex: 1, outcome: 'removed' },
    { featureId: id, treeIndex: 0, outcome: 'removed' },
  ]);
  expect(lots).toEqual([]);
  expect(trees).toEqual([]);
  expect(deposit).toEqual({ remainingAmount: '1000', reservedAmount: '0' });
  expect(queued).toBeUndefined();
}, 60_000);
