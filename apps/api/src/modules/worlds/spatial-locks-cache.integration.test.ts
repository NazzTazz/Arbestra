/**
 * Counter-review of 4 November (docs/VERROUS-2026-11-04.md §10): the world key
 * alone covers no zone, the zone cache stays true after a rollback to a
 * savepoint, and a trip outside the zones held is replayed once with them,
 * then refused, never locked late (HTTP transaction and scheduler task).
 */
import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import type { Database } from '../../database/schema.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { processNextScheduledTask } from '../../jobs/scheduled-tasks.js';
import {
  assertSpatialCoverage,
  boxZones,
  cellZones,
  lockSpatial,
  lockWholeWorld,
  spatialGrid,
  spatialSavepoint,
  spatialTransaction,
  type SpatialCell,
} from './spatial-locks.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\w+)?_test$/.test(target.pathname))
  throw Error('Unexpected spatial lock test database');
const root = createDatabase(url),
  worldId = randomUUID(),
  schema = 'spatial_cache_' + randomUUID().replaceAll('-', '');
/** The scheduler of this file works on its own task table (the world is public). */
let tasks: Kysely<Database>;
const home: SpatialCell = { cellX: 10, cellY: 10 },
  far: SpatialCell = { cellX: 300, cellY: 60 },
  elsewhere: SpatialCell = { cellX: 200, cellY: 200 };

beforeAll(async () => {
  await migrateToLatest(url);
  await root
    .insertInto('worlds')
    .values({
      id: worldId,
      slug: 'spatial-cache-' + worldId,
      name: 'Cache spatial',
      topology: 'torus',
      widthCells: 512,
      heightCells: 256,
      chunkSize: 32,
      seed: 4111,
      generationVersion: 1,
      generationStatus: 'ready',
      isOpen: false,
      generatedAt: new Date(),
    })
    .execute();
  await sql`create schema ${sql.id(schema)}`.execute(root);
  await sql`create table ${sql.id(schema, 'scheduled_tasks')} (like public.scheduled_tasks including all)`.execute(
    root,
  );
  await sql`create view ${sql.id(schema, 'worlds')} as select * from public.worlds`.execute(root);
  tasks = root.withSchema(schema);
}, 120000);
beforeEach(async () => {
  await tasks.deleteFrom('scheduledTasks').execute();
});
afterAll(async () => {
  await sql`drop schema ${sql.id(schema)} cascade`.execute(root);
  await root.deleteFrom('worlds').where('id', '=', worldId).execute();
  await root.destroy();
});

/** Whether this transaction's session really holds the zone of a cell. */
async function holds(tx: Transaction<Database>, cell: SpatialCell) {
  const key = `infrastructure:${worldId}:${Math.floor(cell.cellX / 32)}:${Math.floor(cell.cellY / 32)}`;
  const row = await sql<{ held: boolean }>`select exists(select 1 from pg_locks l where l.pid=pg_backend_pid()
      and l.locktype='advisory' and l.granted and l.objsubid=1
      and l.objid::bigint=(hashtextextended(${key},0) & 4294967295)
      and l.classid::bigint=((hashtextextended(${key},0) >> 32) & 4294967295)) as held`.execute(tx);
  return row.rows[0]!.held;
}
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'covered',
    (error: { code?: string; constructor: { name: string } }) => error.code ?? error.constructor.name,
  );

it('the world key and the zones of an installation do not cover a far trip; the whole world does', async () => {
  await root.transaction().execute(async (tx) => {
    const grid = await spatialGrid(tx, worldId);
    // As the installation: the world key, then the zones at ±64 cells.
    await lockSpatial(tx, grid, { world: 'exclusive' });
    await lockSpatial(tx, grid, {
      exclusive: boxZones(grid, { originCellX: home.cellX, originCellY: home.cellY, width: 1, height: 1 }, 64),
    });
    // Before 5 November the exclusive world key returned early: "covered".
    expect(await outcome(assertSpatialCoverage(tx, worldId, [far], 'shared', 1, 'far trip'))).toBe(
      'SPATIAL_ACCESS_CHANGED',
    );
    expect(await holds(tx, far), 'nothing locked late').toBe(false);
  });
  await root.transaction().execute(async (tx) => {
    await lockWholeWorld(tx, worldId);
    expect(await outcome(assertSpatialCoverage(tx, worldId, [far], 'exclusive', 1, 'far write'))).toBe('covered');
  });
});

it('after a rollback to a savepoint, the cache forgets the zones PostgreSQL released', async () => {
  await root.transaction().execute(async (tx) => {
    const grid = await spatialGrid(tx, worldId);
    await lockSpatial(tx, grid, { shared: cellZones(grid, [home], 1) });
    const restore = spatialSavepoint(tx);
    await sql`savepoint fixture`.execute(tx);
    await lockSpatial(tx, grid, { shared: cellZones(grid, [far], 1) });
    expect(await holds(tx, far)).toBe(true);
    await sql`rollback to savepoint fixture`.execute(tx);
    restore();
    expect(await holds(tx, far), 'released by PostgreSQL').toBe(false);
    expect(await holds(tx, home), 'taken before the savepoint').toBe(true);
    // Before 5 November the cache still claimed the zone: "covered".
    expect(await outcome(assertSpatialCoverage(tx, worldId, [far], 'shared', 1, 'far trip'))).toBe(
      'SPATIAL_ACCESS_CHANGED',
    );
  });
  await root.transaction().execute(async (tx) => {
    const grid = await spatialGrid(tx, worldId);
    await lockSpatial(tx, grid, { shared: cellZones(grid, [home], 1) });
    const restore = spatialSavepoint(tx);
    await sql`savepoint fixture`.execute(tx);
    await lockSpatial(tx, grid, { shared: cellZones(grid, [far], 1) });
    await sql`rollback to savepoint fixture`.execute(tx);
    restore();
    // A new acquisition is really issued, not skipped from the cache.
    await lockSpatial(tx, grid, { shared: cellZones(grid, [far], 1) });
    expect(await holds(tx, far)).toBe(true);
  });
});

/** An admission: the village region, then a trip to `trip` (its zones checked). */
async function admission(tx: Transaction<Database>, trip: SpatialCell, seen: boolean[]) {
  const grid = await spatialGrid(tx, worldId);
  await lockSpatial(tx, grid, { shared: cellZones(grid, [home], 32) });
  // What the attempt holds once its first acquisition is done, before any path.
  seen.push(await holds(tx, far));
  await assertSpatialCoverage(tx, worldId, [trip], 'shared', 1, 'fixture trip');
}

it('a transaction whose trip leaves its zones is replayed once, with them taken first', async () => {
  const seen: boolean[] = [];
  expect(await spatialTransaction(root, (tx) => admission(tx, far, seen).then(() => 'admitted'))).toBe('admitted');
  expect(seen, 'first attempt without the far zone, replay with it before the trip').toEqual([false, true]);
});

it('a replay whose trip leaves its zones again is refused, never locked late', async () => {
  const seen: boolean[] = [];
  let attempt = 0;
  const result = await outcome(
    spatialTransaction(root, async (tx) => {
      // The second attempt finds another trip (the place changed meanwhile).
      await admission(tx, attempt++ === 0 ? far : elsewhere, seen);
      throw Error('unreachable: the replay must be refused');
    }),
  );
  expect(result).toBe('SPATIAL_ACCESS_CHANGED');
  expect(attempt, 'one replay only').toBe(2);
  expect(seen).toEqual([false, true]);
});

it('a scheduled task is replayed once under its own row, after its savepoint and the cache are restored', async () => {
  const task = await tasks
    .insertInto('scheduledTasks')
    .values({
      worldId,
      taskType: 'fixture',
      subjectId: randomUUID(),
      payload: {},
      dueAt: new Date(0),
      availableAt: new Date(0),
      lastError: null,
      completedAt: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const seen: boolean[] = [],
    region: boolean[] = [];
  const result = await processNextScheduledTask(tasks, {
    fixture: async (tx) => {
      await admission(tx, far, seen);
      // The region was really taken again in the replay (not skipped by a stale cache).
      region.push(await holds(tx, home));
    },
  });
  expect(result).toEqual({ taskId: task.id, outcome: 'completed' });
  expect(seen).toEqual([false, true]);
  expect(region).toEqual([true]);
  const row = await tasks.selectFrom('scheduledTasks').selectAll().where('id', '=', task.id).executeTakeFirstOrThrow();
  expect(row).toMatchObject({ attempts: 0, lastError: null });
  expect(row.completedAt).not.toBeNull();
});
