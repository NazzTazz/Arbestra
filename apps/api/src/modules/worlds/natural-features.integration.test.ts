import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';
import { naturalFeaturesQuery, type FeatureArea } from './natural-features.js';
// Historical unbounded join, retained only as the comparative read oracle.
function historicalNaturalFeaturesQuery(db: Kysely<Database>, worldId: string, areas: readonly FeatureArea[]) {
  if (!areas.length) throw Error('A natural-feature read needs an area');
  const inside = (x: string, y: string) =>
    sql<boolean>`(${sql.join(
      areas.map(
        (a) =>
          sql`(${sql.ref(x)} >= ${a.minX} and ${sql.ref(x)} < ${a.maxX} and ${sql.ref(y)} >= ${a.minY} and ${sql.ref(y)} < ${a.maxY})`,
      ),
      sql` or `,
    )})`;
  return db
    .with(
      (cte) => cte('projectedDeposits').materialized(),
      (eb) =>
        eb.selectFrom('resourceDeposits').selectAll().where('worldId', '=', worldId).where(inside('cellX', 'cellY')),
    )
    .with('featureLocations', (eb) =>
      eb
        .selectFrom('worldCellOccupancies')
        .select(['worldId', 'featureId', 'cellX', 'cellY'])
        .where('worldId', '=', worldId)
        .where('featureId', 'is not', null)
        .where(inside('cellX', 'cellY'))
        // Reading only identifiers lets PostgreSQL prune all economic projections.
        .where(
          sql<boolean>`not exists(select 1 from resource_deposits rd where rd.world_id=world_cell_occupancies.world_id and rd.feature_id=world_cell_occupancies.feature_id)`,
        )
        .union(eb.selectFrom('projectedDeposits').select(['worldId', 'featureId', 'cellX', 'cellY'])),
    )
    .selectFrom('featureLocations')
    .innerJoin('worldFeatures', (j) =>
      j
        .onRef('worldFeatures.worldId', '=', 'featureLocations.worldId')
        .onRef('worldFeatures.id', '=', 'featureLocations.featureId'),
    )
    .leftJoin('projectedDeposits as resourceDeposits', (j) =>
      j
        .onRef('resourceDeposits.worldId', '=', 'worldFeatures.worldId')
        .onRef('resourceDeposits.featureId', '=', 'worldFeatures.id'),
    )
    .select([
      'worldFeatures.id',
      'worldFeatures.featureTypeCode',
      'worldFeatures.variantSeed',
      'worldFeatures.state as featureState',
      'featureLocations.cellX',
      'featureLocations.cellY',
      'resourceDeposits.initialAmount',
      'resourceDeposits.remainingAmount',
      'resourceDeposits.reservedAmount',
      'resourceDeposits.revision',
      'resourceDeposits.updatedAt',
      'resourceDeposits.resourceCode',
      'resourceDeposits.cleared',
      'resourceDeposits.blocksCell',
      'resourceDeposits.cutAmount',
    ])
    .where('worldFeatures.worldId', '=', worldId);
}

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected spatial fixture DB');
const db = createDatabase(url),
  worlds = [randomUUID(), randomUUID()];
beforeAll(async () => {
  await migrateToLatest(url);
  for (const id of worlds)
    await db
      .insertInto('worlds')
      .values({
        id,
        slug: 'features-' + id,
        name: 'Feature read fixture',
        topology: 'torus',
        widthCells: 512,
        heightCells: 256,
        chunkSize: 32,
        seed: 4109,
        generationStatus: 'ready',
        generationVersion: 3,
        isOpen: true,
        generatedAt: new Date(),
      })
      .execute();
}, 120000);
afterAll(async () => {
  await db.deleteFrom('woodlandDeposits').where('worldId', 'in', worlds).execute();
  await db.deleteFrom('stoneDeposits').where('worldId', 'in', worlds).execute();
  await db.deleteFrom('worlds').where('id', 'in', worlds).execute();
  await db.destroy();
});
it('projects only deposits inside the requested areas and preserves canonical locations across seams and worlds', async () => {
  const ids = Array.from({ length: 6 }, () => randomUUID()),
    points = [
      [511, 255],
      [0, 0],
      [20, 20],
      [0, 1],
      [0, 0],
      [1, 1],
    ];
  for (let i = 0; i < ids.length; i++) {
    const worldId = worlds[i === 4 ? 1 : 0]!,
      p = points[i]!;
    await db
      .insertInto('worldFeatures')
      .values({
        id: ids[i]!,
        worldId,
        featureTypeCode: i === 5 ? 'woodland' : 'stone_outcrop',
        state: 'available',
        variantSeed: 1,
      })
      .execute();
    if (i === 5)
      await db
        .insertInto('woodlandDeposits')
        .values({
          worldId,
          featureId: ids[i]!,
          cellX: p[0]!,
          cellY: p[1]!,
          initialAmount: 1000,
          remainingAmount: 600,
          reservedAmount: 0,
          revision: 1,
          updatedAt: new Date(),
          regrowthUpdatedAt: new Date(),
          regrowthPeriodMs: 1_000_000_000_000,
          cleared: false,
        })
        .execute();
    else if (i !== 3)
      await db
        .insertInto('stoneDeposits')
        .values({
          worldId,
          featureId: ids[i]!,
          cellX: p[0]!,
          cellY: p[1]!,
          initialAmount: 2000,
          remainingAmount: 2000,
          reservedAmount: 0,
          revision: 1,
          updatedAt: new Date(),
        })
        .execute();
    await db
      .insertInto('worldCellOccupancies')
      .values({
        worldId,
        featureId: ids[i]!,
        buildingId: null,
        pendingExpansionId: null,
        cellX: i === 2 ? 1 : p[0]!,
        cellY: i === 2 ? 0 : p[1]!,
        role: 'body',
      })
      .execute();
  }
  const areas = [
    { minX: 510, maxX: 512, minY: 254, maxY: 256 },
    { minX: 0, maxX: 2, minY: 0, maxY: 2 },
  ];
  const query = naturalFeaturesQuery(db, worlds[0]!, areas),
    rows = await db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (tx) => {
        await sql`set transaction read only`.execute(tx);
        const horizon = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('at')).executeTakeFirstOrThrow()).at;
        await sql`select set_config('arbestra.economy_through',${horizon.toISOString()},true)`.execute(tx);
        const actual = await naturalFeaturesQuery(tx, worlds[0]!, areas).execute(),
          historical = await historicalNaturalFeaturesQuery(tx, worlds[0]!, areas).execute();
        expect([...actual].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
          [...historical].sort((a, b) => a.id.localeCompare(b.id)),
        );
        return actual;
      });
  expect(rows.map((r) => r.id).sort()).toEqual([ids[0], ids[1], ids[3], ids[5]].sort());
  expect(rows.find((r) => r.id === ids[0])).toMatchObject({ cellX: 511, cellY: 255, remainingAmount: '2000' });
  expect(rows.find((r) => r.id === ids[3])).toMatchObject({ remainingAmount: null });
  expect(rows.find((r) => r.id === ids[5])).toMatchObject({
    cellX: 1,
    cellY: 1,
    resourceCode: 'wood',
    remainingAmount: '600',
  });
  const compiled = query.compile(),
    result = await db.executeQuery({ ...compiled, sql: 'explain (analyze,format json) ' + compiled.sql });
  const plan = (Object.values(result.rows[0]!)[0] as unknown as Array<{ Plan: Record<string, unknown> }>)[0]!.Plan;
  const find = (p: Record<string, unknown>): Record<string, unknown> | undefined =>
    p['Subplan Name'] === 'CTE projected_deposits'
      ? p
      : (p.Plans as Array<Record<string, unknown>> | undefined)?.map(find).find(Boolean);
  // Decisive cost boundary: the economic view evaluates three visible deposits,
  // excluding the off-window resource and the second world's deposit.
  expect(find(plan)?.['Actual Rows']).toBe(3);
});
