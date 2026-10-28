import { travelDuration } from '@arbestra/contracts';
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
import { readVillageDepositDetails, ownedVillage, reconcileVillageForRead } from '../villages/service.js';
import { startVillageStoneExtraction } from '../villages/legacy-commands.fixture.js';
import { admitVillageWorksites } from '../villages/worksite-admission.js';

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
      regrowthPerHour: 0,
    });
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
