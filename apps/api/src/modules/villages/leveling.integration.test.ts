import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  fixedBuildingFootprint,
  type GeneratedLandscape,
  type LevelingCommand,
  type LevelingRequest,
} from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { RC1_CANONICAL_CHECKSUM } from '../onboarding/spawn-map.js';
import { previewLeveling, commandLeveling, COMPLETE_LEVELING_TASK } from './leveling.js';
import { beginVillageEconomy, reconcileVillageEconomy } from './reconcile-economy.js';
import { navigationRevision, loadNavigationContext } from '../navigation/context.js';
import { constructBuildingArea, getVillageState } from './service.js';
import { spawnSpatialState } from '../onboarding/spawn-state.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test')
  throw Error('Unexpected leveling test database');
const db = createDatabase(url),
  accountId = randomUUID(),
  worldId = randomUUID(),
  villageId = randomUUID(),
  hallId = randomUUID(),
  slug = 'leveling-' + worldId;
const artifact = JSON.parse(
  readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url), 'utf8'),
) as GeneratedLandscape;
const request: LevelingRequest = {
  buildingType: 'university',
  anchor: { cellX: 59, cellY: 200 },
  quarterTurns: 1,
  workerCount: 2,
};
const cells = fixedBuildingFootprint('university', request.anchor, 1, { widthCells: 512, heightCells: 256 });
beforeAll(async () => {
  await migrateToLatest(url);
  await db
    .insertInto('accounts')
    .values({ id: accountId, email: accountId + '@leveling.test', passwordHash: 'fixture' })
    .execute();
  await db
    .insertInto('worlds')
    .values({
      id: worldId,
      slug,
      name: 'Nivellement test',
      topology: 'torus',
      widthCells: 512,
      heightCells: 256,
      chunkSize: 32,
      seed: 4109,
      generationVersion: 3,
      generationStatus: 'ready',
      isOpen: false,
      generatedAt: new Date(),
    })
    .execute();
  await db
    .insertInto('worldChunks')
    .values(
      Array.from({ length: 128 }, (_, i) => ({
        worldId,
        chunkX: i % 16,
        chunkY: Math.floor(i / 16),
        generationVersion: 3,
        terrainCodes: Array(1024).fill(1),
        elevations: Array(1024).fill(25),
      })),
    )
    .execute();
  await db
    .insertInto('worldGenerationCandidates')
    .values({
      worldId,
      commandId: randomUUID(),
      ownerAccountId: accountId,
      parameters: artifact.geography!.parameters,
      checksum: RC1_CANONICAL_CHECKSUM,
      status: 'ready',
      artifact,
    })
    .execute();
  await db.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Terrassier' }).execute();
  await db
    .insertInto('villages')
    .values({
      id: villageId,
      worldId,
      ownerAccountId: accountId,
      name: 'Terrasse',
      anchorCellX: 59,
      anchorCellY: 195,
      economyActivatedAt: new Date(),
    })
    .execute();
  await db
    .insertInto('buildings')
    .values({
      id: hallId,
      worldId,
      villageId,
      buildingType: 'town-hall',
      level: 2,
      status: 'completed',
      completedAt: new Date(),
      constructionStartedAt: null,
      constructionCompletesAt: null,
    })
    .execute();
  await db
    .insertInto('worldCellOccupancies')
    .values({
      worldId,
      cellX: 59,
      cellY: 195,
      buildingId: hallId,
      featureId: null,
      pendingExpansionId: null,
      role: 'anchor',
    })
    .execute();
  for (const cellX of [55, 64]) {
    const id = randomUUID();
    await db
      .insertInto('buildings')
      .values({
        id,
        worldId,
        villageId,
        buildingType: 'dwelling',
        level: 1,
        status: 'completed',
        completedAt: new Date(),
        constructionStartedAt: null,
        constructionCompletesAt: null,
      })
      .execute();
    await db
      .insertInto('worldCellOccupancies')
      .values({ worldId, cellX, cellY: 200, buildingId: id, featureId: null, pendingExpansionId: null, role: 'anchor' })
      .execute();
  }
  await db
    .insertInto('villageResources')
    .values(
      ['wood', 'stone', 'timber', 'cut-stone', 'carrot'].map((resourceCode) => ({
        worldId,
        villageId,
        resourceCode,
        amount: 10000,
      })),
    )
    .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ amount: 10000 }))
    .execute();
  await db
    .insertInto('villageResourceFlows')
    .values({
      worldId,
      villageId,
      resourceCode: 'wood',
      baseRatePerHour: 0,
      remainder: 0,
      productionUpdatedAt: new Date(),
    })
    .execute();
  await db
    .insertInto('populationCohorts')
    .values({
      worldId,
      villageId,
      originVillageId: villageId,
      memberCount: 15,
      activity: 'idle',
      energy: 10,
      energyProgress: 0,
      energyUpdatedAt: new Date(),
      restingSince: null,
      foodUsedSinceRest: 0,
      harvestId: null,
      extractionId: null,
    })
    .execute();
  // Controlled dry, gently sloping test pad over the genuine immutable RC1 source.
  await db
    .insertInto('worldSpawnTerraces')
    .values(
      Array.from({ length: 169 }, (_, i) => ({
        worldId,
        villageId,
        cellX: 53 + (i % 13),
        cellY: 190 + Math.floor(i / 13),
        height: 0.25,
      })),
    )
    .execute();
  for (const c of cells)
    await db
      .insertInto('worldSpawnTerraces')
      .values({ worldId, villageId, ...c, height: 0.25 + (c.cellX - 59) * 0.02 })
      .onConflict((x) => x.columns(['worldId', 'cellX', 'cellY']).doUpdateSet({ height: 0.25 + (c.cellX - 59) * 0.02 }))
      .execute();
}, 120000);
afterAll(async () => {
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db.deleteFrom('accounts').where('id', '=', accountId).execute();
  await db.destroy();
}, 60000);

it('previews a remote campus outside the original region using its actual terrain and building accesses', async () => {
  // The village anchor is a presentation origin; the physical hall keeps its own identity and access.
  await db
    .updateTable('villages')
    .set({ anchorCellX: 19 })
    .where('worldId', '=', worldId)
    .where('id', '=', villageId)
    .execute();
  try {
    const state = await getVillageState(db, accountId, slug, villageId);
    expect(state.region.width).toBeGreaterThan(64);
    expect(cells.every((c) => state.cells.some((s) => s.cellX === c.cellX && s.cellY === c.cellY && s.canBuild))).toBe(
      true,
    );
    const dueId = randomUUID(),
      now = Date.now();
    await db
      .insertInto('buildings')
      .values({
        id: dueId,
        worldId,
        villageId,
        buildingType: 'dwelling',
        level: 1,
        status: 'under-construction',
        constructionStartedAt: new Date(now - 2000),
        constructionCompletesAt: new Date(now - 1000),
      })
      .execute();
    const tables = [
      'buildings',
      'populationCohorts',
      'villageResources',
      'villageResourceFlows',
      'scheduledTasks',
      'villageSyncChanges',
      'worldSpawnTerraces',
      'levelingJobs',
    ] as const;
    const stored = () =>
      Promise.all(
        tables.map(async (table) =>
          (await db.selectFrom(table).selectAll().where('worldId', '=', worldId).execute())
            .map((row) => JSON.stringify(row))
            .sort(),
        ),
      );
    const persisted = await stored();
    const preview = await previewLeveling(db, accountId, slug, villageId, request);
    expect(preview.valid).toBe(true);
    expect(preview.quote.cells).toHaveLength(30);
    expect(await stored()).toEqual(persisted);
    await db.deleteFrom('buildings').where('worldId', '=', worldId).where('id', '=', dueId).execute();
  } finally {
    await db
      .updateTable('villages')
      .set({ anchorCellX: 59 })
      .where('worldId', '=', worldId)
      .where('id', '=', villageId)
      .execute();
  }
}, 120000);

it('reserves a dry university pad, spends labour once, persists the level ground and then permits manual construction', async () => {
  const before = await getVillageState(db, accountId, slug, villageId);
  const preview = await previewLeveling(db, accountId, slug, villageId, request);
  expect(preview.valid).toBe(true);
  expect(preview.quote.cells).toHaveLength(30);
  expect(preview.quote.stoneDebit).toBe(0);
  expect(preview.quote.stoneCredit).toBe(0);
  const command: LevelingCommand = { ...request, commandId: randomUUID(), expected: preview.quote };
  const revision = await navigationRevision(db, worldId);
  let unlock!: () => void, locked!: (pid: number) => void;
  const gate = new Promise<void>((r) => {
      unlock = r;
    }),
    ready = new Promise<number>((r) => {
      locked = r;
    });
  const holder = db.transaction().execute(async (tx) => {
    await tx
      .selectFrom('villages')
      .select('id')
      .where('worldId', '=', worldId)
      .where('id', '=', villageId)
      .forUpdate()
      .execute();
    locked((await sql<{ pid: number }>`select pg_backend_pid() pid`.execute(tx)).rows[0]!.pid);
    await gate;
  });
  const pid = await ready;
  const attempts = Promise.allSettled([
    commandLeveling(db, accountId, slug, villageId, command),
    commandLeveling(db, accountId, slug, villageId, command),
  ]);
  let results: Awaited<typeof attempts>;
  try {
    const until = Date.now() + 15000;
    let waiting = 0;
    while (Date.now() < until && waiting < 2) {
      waiting = Number(
        (
          await sql<{ n: string }>`with recursive waiting(pid) as (
        select pid from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid))
        union select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid))
      ) select count(*)::text n from waiting`.execute(db)
        ).rows[0]!.n,
      );
      if (waiting < 2) await new Promise((r) => setTimeout(r, 20));
    }
    expect(waiting).toBe(2);
  } finally {
    unlock();
    await holder;
    results = await attempts;
  }
  expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  const launched = (results[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof commandLeveling>>>).value;
  expect(launched.village.levelingJobs).toHaveLength(1);
  expect(launched.village.population.working).toBe(2);
  expect(launched.village.resources.map((r) => [r.code, r.amount])).toEqual(
    before.village.resources.map((r) => [r.code, r.amount]),
  );
  const job = await db.selectFrom('levelingJobs').selectAll().where('worldId', '=', worldId).executeTakeFirstOrThrow();
  expect(await navigationRevision(db, worldId)).not.toBe(revision);
  const navigation = await loadNavigationContext(db, worldId, new Set(), new Set());
  expect(navigation.data!.occupancies.filter((c) => c.buildingId === job.featureId)).toHaveLength(30);
  expect((await spawnSpatialState(db, worldId)).walkBlockedSurfaces).toContainEqual({
    x: 59,
    y: 200,
    halfWidth: 0.5,
    halfHeight: 0.5,
  });
  await commandLeveling(db, accountId, slug, villageId, command);
  expect(await db.selectFrom('levelingJobs').select('id').where('worldId', '=', worldId).execute()).toHaveLength(1);
  await expect(commandLeveling(db, accountId, slug, villageId, { ...command, workerCount: 1 })).rejects.toMatchObject({
    code: 'COMMAND_REUSED',
  });
  await expect(previewLeveling(db, randomUUID(), slug, villageId, request)).rejects.toMatchObject({
    code: 'VILLAGE_NOT_FOUND',
  });
  await expect(previewLeveling(db, accountId, slug, villageId, request)).rejects.toMatchObject({
    code: 'LEVELING_NEARBY',
  });
  const terraceBefore = await db
    .selectFrom('worldSpawnTerraces')
    .selectAll()
    .where('worldId', '=', worldId)
    .orderBy('cellX')
    .orderBy('cellY')
    .execute();
  await db.transaction().execute(async (tx) => {
    const ctx = await beginVillageEconomy(tx, worldId, villageId);
    await reconcileVillageEconomy(tx, { ...ctx, through: new Date(job.completesAt.getTime() - 1) });
  });
  expect(
    await db
      .selectFrom('worldSpawnTerraces')
      .selectAll()
      .where('worldId', '=', worldId)
      .orderBy('cellX')
      .orderBy('cellY')
      .execute(),
  ).toEqual(terraceBefore);
  async function rollbackState() {
    const rows = [];
    for (const table of [
      'leveling_jobs',
      'world_cell_occupancies',
      'world_features',
      'world_spawn_terraces',
      'population_cohorts',
      'village_resources',
      'village_resource_flows',
      'scheduled_tasks',
    ])
      rows.push(
        (
          await sql`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) data from ${sql.table(table)} t where world_id=${worldId}`.execute(
            db,
          )
        ).rows,
      );
    return { rows, revision: await navigationRevision(db, worldId) };
  }
  const rollbackBefore = await rollbackState();
  const rollback = new Error('LEVELING_COMPLETION_ROLLBACK');
  await expect(
    db.transaction().execute(async (tx) => {
      const ctx = await beginVillageEconomy(tx, worldId, villageId);
      await reconcileVillageEconomy(tx, { ...ctx, through: job.completesAt });
      expect(
        (
          await tx
            .selectFrom('worldSpawnTerraces')
            .select('height')
            .where('worldId', '=', worldId)
            .where('cellX', '=', 57)
            .where('cellY', '=', 198)
            .executeTakeFirstOrThrow()
        ).height,
      ).toBe(preview.quote.height);
      expect(
        (
          await tx
            .selectFrom('levelingJobs')
            .select('completedAt')
            .where('worldId', '=', worldId)
            .where('id', '=', job.id)
            .executeTakeFirstOrThrow()
        ).completedAt,
      ).not.toBeNull();
      expect(
        await tx
          .selectFrom('worldCellOccupancies')
          .select('cellX')
          .where('worldId', '=', worldId)
          .where('featureId', '=', job.featureId)
          .execute(),
      ).toHaveLength(0);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(await rollbackState()).toEqual(rollbackBefore);
  expect(
    await db
      .selectFrom('worldSpawnTerraces')
      .selectAll()
      .where('worldId', '=', worldId)
      .orderBy('cellX')
      .orderBy('cellY')
      .execute(),
  ).toEqual(terraceBefore);
  await db.transaction().execute(async (tx) => {
    const ctx = await beginVillageEconomy(tx, worldId, villageId);
    await reconcileVillageEconomy(tx, { ...ctx, through: job.completesAt });
    await reconcileVillageEconomy(tx, { ...ctx, through: job.completesAt });
  });
  const done = await getVillageState(db, accountId, slug, villageId);
  expect(done.village.levelingJobs).toHaveLength(0);
  expect(done.village.population.working).toBe(0);
  expect(done.village.resources.map((r) => [r.code, r.amount])).toEqual(
    before.village.resources.map((r) => [r.code, r.amount]),
  );
  const released = await db
    .selectFrom('populationCohorts')
    .selectAll()
    .where('worldId', '=', worldId)
    .where('memberCount', '=', 2)
    .executeTakeFirstOrThrow();
  expect(released.levelingJobId).toBeNull();
  expect(released.energy * 79200000 + released.energyProgress).toBeLessThan(10 * 79200000);
  expect(
    (
      await db
        .selectFrom('scheduledTasks')
        .select('completedAt')
        .where('worldId', '=', worldId)
        .where('taskType', '=', COMPLETE_LEVELING_TASK)
        .executeTakeFirstOrThrow()
    ).completedAt,
  ).toBeNull();
  const definition = done.buildingTypes.find((b) => b.code === 'university')!.levels.find((l) => l.level === 1)!;
  const built = await constructBuildingArea(
    db,
    accountId,
    slug,
    villageId,
    'university',
    request.anchor,
    cells,
    null,
    randomUUID(),
    definition.costs,
    1,
  );
  expect(built.cells.some((c) => c.building?.type === 'university' && c.building.status === 'under-construction')).toBe(
    true,
  );
}, 120000);
