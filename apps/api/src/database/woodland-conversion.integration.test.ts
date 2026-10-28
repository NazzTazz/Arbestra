import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from './connection.js';
import { migrateToLatest } from './migrate.js';
import { resetE2eState } from './reset-e2e.js';
import { DEVELOPMENT_IDS } from './seed.js';
import { testDatabaseUrl } from './test-environment.js';
import type { Database } from './schema.js';
import { debitWoodLot } from '../modules/deposits/woodland.js';

/** Conversion of the former cell-wide wood stock into trees of 500 (migration
 * 065, docs/SPEC-BOIS-ARBRE-UNITE.md §4 and §7), on cases written in their
 * former shape inside a transaction that is always rolled back. */
const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected woodland conversion test database');
const db = createDatabase(url),
  worldId = DEVELOPMENT_IDS.world,
  villageId = DEVELOPMENT_IDS.village;
beforeAll(async () => {
  await migrateToLatest(url);
  await resetE2eState(url);
});
afterAll(() => db.destroy());
class Rollback extends Error {}

/** A free cell of the test world, at most `radius` cells from (x, y). */
async function freeCell(tx: Transaction<Database>, x: number, y: number, radius: number, taken: Set<string>) {
  const rows = await sql<{ cellX: number; cellY: number }>`
    select x as cell_x,y as cell_y from generate_series(${x - radius}::int,${x + radius}::int) x,
      generate_series(${y - radius}::int,${y + radius}::int) y
    where not exists(select 1 from world_cell_occupancies o where o.world_id=${worldId} and o.cell_x=x and o.cell_y=y)
      and not exists(select 1 from woodland_deposits d where d.world_id=${worldId} and d.cell_x=x and d.cell_y=y)
      and not exists(select 1 from stone_deposits d where d.world_id=${worldId} and d.cell_x=x and d.cell_y=y)
    order by greatest(abs(x-${x}),abs(y-${y})) desc,x,y`.execute(tx);
  const cell = rows.rows.find((c) => !taken.has(c.cellX + ':' + c.cellY));
  if (!cell) throw Error('No free cell for the conversion fixture');
  taken.add(cell.cellX + ':' + cell.cellY);
  return cell;
}

/** A case in its former shape: cell-wide stock, optional RC1 metadata. */
async function former(
  tx: Transaction<Database>,
  cell: { cellX: number; cellY: number },
  values: {
    variantSeed: number;
    initial: number;
    remaining: number | string;
    cut: number;
    reserved?: number;
    occupied?: boolean;
  },
  rc1?: { sourceKey: string; treeIndices: number[]; removedIndices: number[] },
) {
  const id = randomUUID();
  await tx
    .insertInto('worldFeatures')
    .values({ id, worldId, featureTypeCode: 'woodland', state: 'available', variantSeed: values.variantSeed })
    .execute();
  if (rc1)
    await tx
      .insertInto('worldRc1Resources')
      .values({
        worldId,
        featureId: id,
        sourceKey: rc1.sourceKey,
        treeIndices: JSON.stringify(rc1.treeIndices),
        removedIndices: JSON.stringify(rc1.removedIndices),
      })
      .execute();
  await tx
    .insertInto('woodlandDeposits')
    .values({
      worldId,
      featureId: id,
      ...cell,
      initialAmount: values.initial,
      remainingAmount: values.remaining,
      reservedAmount: values.reserved ?? 0,
      cutAmount: values.cut,
      revision: 1,
      updatedAt: new Date(),
      regrowthUpdatedAt: new Date(),
    })
    .execute();
  if (values.occupied !== false)
    await tx
      .insertInto('worldCellOccupancies')
      .values({ worldId, ...cell, featureId: id, buildingId: null, role: 'body' })
      .execute();
  return id;
}
const lotUnderWay = (tx: Transaction<Database>, featureId: string, amount: number, startedAt: Date) =>
  tx
    .insertInto('depositExtractions')
    .values({
      worldId,
      villageId,
      featureId,
      resourceCode: 'wood',
      commandId: randomUUID(),
      worksiteId: null,
      status: 'in-progress',
      startedAt,
      completesAt: new Date(startedAt.getTime() + 600_000),
      completedAt: null,
      workerCount: 1,
      reservedAmount: amount,
      transportMs: 0,
      pathCells: sql`'[]'::jsonb`,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
const caseOf = (tx: Transaction<Database>, id: string) =>
  tx
    .selectFrom('woodlandDeposits')
    .select(['initialAmount', 'remainingAmount', 'reservedAmount', 'cutAmount', 'cleared'])
    .where('worldId', '=', worldId)
    .where('featureId', '=', id)
    .executeTakeFirstOrThrow();
const treesOf = (tx: Transaction<Database>, id: string) =>
  tx
    .selectFrom('woodlandTrees')
    .select(['treeIndex', 'remainingAmount', 'reservedAmount'])
    .where('worldId', '=', worldId)
    .where('featureId', '=', id)
    .orderBy('treeIndex')
    .execute();
const occupancy = async (tx: Transaction<Database>, id: string) =>
  (await tx.selectFrom('worldCellOccupancies').select('featureId').where('featureId', '=', id).execute()).length;
const convert = async (tx: Transaction<Database>) =>
  Number((await sql<{ n: number }>`select woodland_convert_to_trees(${worldId}::uuid) as n`.execute(tx)).rows[0]!.n);

it('converts cut, starter, treeless and procedural cases into trees of 500, once', async () => {
  try {
    await db.transaction().execute(async (tx) => {
      const t = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
      const taken = new Set<string>();
      const far = () => freeCell(tx, 1500, 300, 4, taken);
      // Half cut, with regrowth since and a lot under way: 4 trees (seed 2).
      const halfCut = await former(tx, await far(), {
        variantSeed: 2,
        initial: 300,
        remaining: 280,
        cut: 150,
        reserved: 100,
      });
      const running = await lotUnderWay(tx, halfCut, 100, t);
      // Seed 3: 5 trees now, 2 drawn before. Far from everything, it gets its 5 trees;
      // beside the town hall it keeps its former 2 (no tree added there).
      const grown = await former(tx, await far(), { variantSeed: 3, initial: 300, remaining: 300, cut: 0 });
      const beside = await former(tx, await freeCell(tx, 1023, 512, 2, taken), {
        variantSeed: 3,
        initial: 300,
        remaining: 300,
        cut: 0,
      });
      // Freed under the former 10 % threshold: its cell is taken back.
      const freed = await former(tx, await far(), {
        variantSeed: 4,
        initial: 300,
        remaining: 20,
        cut: 280,
        occupied: false,
      });
      // A starter supplement: three real trees, 600 of its 1 500 cut.
      const starter = await former(
        tx,
        await far(),
        { variantSeed: 3, initial: 1500, remaining: 1100, cut: 600 },
        { sourceKey: `starter:${villageId}:0`, treeIndices: [], removedIndices: [] },
      );
      // An RC1 case left without any tree loses its wood; with a lot under way, after it.
      const treeless = await former(
        tx,
        await far(),
        { variantSeed: 3, initial: 500, remaining: 500, cut: 0 },
        { sourceKey: 'forest:fixture-a', treeIndices: [7], removedIndices: [7] },
      );
      const busyTreeless = await former(
        tx,
        await far(),
        { variantSeed: 3, initial: 500, remaining: 500, cut: 0, reserved: 100 },
        { sourceKey: 'forest:fixture-b', treeIndices: [8], removedIndices: [8] },
      );
      const busyLot = await lotUnderWay(tx, busyTreeless, 100, t);

      expect(await convert(tx)).toBeGreaterThanOrEqual(6);

      // A case half cut keeps half its trees standing; the lot keeps its wood on the next tree.
      expect(await caseOf(tx, halfCut)).toEqual({
        initialAmount: '2000',
        remainingAmount: '1000',
        reservedAmount: '100',
        cutAmount: '1000',
        cleared: false,
      });
      expect(await treesOf(tx, halfCut)).toEqual([
        { treeIndex: 0, remainingAmount: 0, reservedAmount: 0 },
        { treeIndex: 1, remainingAmount: 0, reservedAmount: 0 },
        { treeIndex: 2, remainingAmount: 500, reservedAmount: 100 },
      ]);
      expect(
        (
          await tx
            .selectFrom('depositExtractions')
            .select('treeIndex')
            .where('id', '=', running.id)
            .executeTakeFirstOrThrow()
        ).treeIndex,
      ).toBe(2);
      expect((await caseOf(tx, grown)).initialAmount).toBe('2500');
      expect((await caseOf(tx, beside)).initialAmount).toBe('1000');
      expect(await treesOf(tx, grown)).toEqual([]);
      expect(await caseOf(tx, freed)).toMatchObject({ initialAmount: '1000', cleared: false });
      expect(await occupancy(tx, freed)).toBe(1);
      // A starter: 1.2 tree of 3 cut, the cut counter in trees of 500.
      expect(await caseOf(tx, starter)).toEqual({
        initialAmount: '1500',
        remainingAmount: '900',
        reservedAmount: '0',
        cutAmount: '600',
        cleared: false,
      });
      expect(await treesOf(tx, starter)).toEqual([
        { treeIndex: 0, remainingAmount: 0, reservedAmount: 0 },
        { treeIndex: 1, remainingAmount: 400, reservedAmount: 0 },
      ]);
      expect(await caseOf(tx, treeless)).toMatchObject({ cleared: true, remainingAmount: '0' });
      expect(await occupancy(tx, treeless)).toBe(0);
      expect(
        (await tx.selectFrom('worldFeatures').select('state').where('id', '=', treeless).executeTakeFirstOrThrow())
          .state,
      ).toBe('depleted');
      expect(await caseOf(tx, busyTreeless)).toMatchObject({ cleared: false, reservedAmount: '100' });

      // Idempotent: a second run changes nothing.
      const all = [halfCut, grown, beside, freed, starter, treeless, busyTreeless];
      const state = async () =>
        Promise.all(all.map(async (id) => [await caseOf(tx, id), await treesOf(tx, id), await occupancy(tx, id)]));
      const once = await state();
      expect(await convert(tx)).toBe(0);
      expect(await state()).toEqual(once);

      // The treeless case loses its wood once its last lot is debited by its village.
      await debitWoodLot(tx, busyLot, busyLot.completesAt);
      expect(await caseOf(tx, busyTreeless)).toMatchObject({
        cleared: true,
        remainingAmount: '400',
        reservedAmount: '0',
      });
      expect(await occupancy(tx, busyTreeless)).toBe(0);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}, 120_000);

it('converts again a case whose trees were written on the former stock, from its own stock', async () => {
  try {
    await db.transaction().execute(async (tx) => {
      const t = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
      // Development database, 28 October: the new code ran before migration 065
      // and felled a tree of a case 90 % cut under the former model.
      const id = await former(
        tx,
        await freeCell(tx, 1500, 300, 4, new Set()),
        { variantSeed: 3, initial: 1000, remaining: '116.2859705687830687883723810000', cut: 900, reserved: 100 },
        { sourceKey: 'forest:fixture-c', treeIndices: [5, 6], removedIndices: [] },
      );
      await tx
        .insertInto('woodlandTrees')
        .values({ worldId, featureId: id, treeIndex: 5, remainingAmount: 500, reservedAmount: 100, felledAt: t })
        .execute();
      const lot = await lotUnderWay(tx, id, 100, t);
      await tx.updateTable('depositExtractions').set({ treeIndex: 5 }).where('id', '=', lot.id).execute();

      expect(await convert(tx)).toBeGreaterThanOrEqual(1);
      // 900 of 1000 cut: the first tree a stump, the second a trunk of 100 that keeps the lot.
      expect(await caseOf(tx, id)).toEqual({
        initialAmount: '1000',
        remainingAmount: '100',
        reservedAmount: '100',
        cutAmount: '900',
        cleared: false,
      });
      expect(await treesOf(tx, id)).toEqual([
        { treeIndex: 5, remainingAmount: 0, reservedAmount: 0 },
        { treeIndex: 6, remainingAmount: 100, reservedAmount: 100 },
      ]);
      expect(
        (
          await tx
            .selectFrom('depositExtractions')
            .select('treeIndex')
            .where('id', '=', lot.id)
            .executeTakeFirstOrThrow()
        ).treeIndex,
      ).toBe(6);
      // Consistent now: a second run leaves it alone.
      const once = [await caseOf(tx, id), await treesOf(tx, id)];
      expect(await convert(tx)).toBe(0);
      expect([await caseOf(tx, id), await treesOf(tx, id)]).toEqual(once);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}, 120_000);
