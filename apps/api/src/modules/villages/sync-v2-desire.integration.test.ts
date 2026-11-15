import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  applySyncV2Batch,
  desirePathsFromSyncV2,
  SYNC_V2_DESIRE_MAX_SCOPES,
  type SyncV2Batch,
  type SyncV2State,
} from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { captureSyncV2 } from './sync-v2-capture.js';
import { desireScopesOfVillage, readDesireScopeSnapshot } from './sync-v2-desire-readers.js';

/** The desire stream (docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §17, slice T3b):
 * the trigger of migration 086 publishes a chunk only when an edge's visibility
 * changes, the reader answers snapshots and deltas through the ordinary capture,
 * and no payload carries a count. The visibility threshold is read from the
 * database (`world_desire_visible_passages()`), never repeated here. */
const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected desire stream test database');
const db = createDatabase(url);
// The dev world is 2048 x 1024 cells: 64 x 32 chunks of 32.
const LAST_X = 2047,
  LAST_Y = 1023;
let N = 0;
let otherWorld = '';

beforeAll(async () => {
  await migrateToLatest(url);
  await resetE2eState(url);
  N = (await sql<{ n: number }>`select world_desire_visible_passages() as n`.execute(db)).rows[0]!.n;
  await sql`insert into game_sync_streams(world_id,stream_kind,scope_key) values(${ids.world},'village',${ids.village})
    on conflict do nothing`.execute(db);
}, 180_000);
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await db.deleteFrom('worldDesireEdges').where('worldId', '=', ids.world).execute();
  await sql`delete from game_sync_changes where world_id=${ids.world} and stream_kind='desire'`.execute(db);
  otherWorld = '';
});
afterEach(async () => {
  await db.deleteFrom('worldDesireEdges').where('worldId', '=', ids.world).execute();
  if (otherWorld) {
    await sql`delete from game_sync_streams where world_id=${otherWorld}::uuid`.execute(db);
    await db.deleteFrom('worlds').where('id', '=', otherWorld).execute();
  }
});

type Edge = { x: number; y: number; direction: 0 | 1 };
/** What the desire task does: add passages to edges, in one statement. */
async function pass(worldId: string, edges: Edge[], by = 1) {
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('worldDesireEdges')
      .values(
        edges.map((edge) => ({
          worldId,
          cellX: edge.x,
          cellY: edge.y,
          direction: edge.direction,
          passages: by,
          lastPassageAt: new Date(),
        })),
      )
      .onConflict((conflict) =>
        conflict.columns(['worldId', 'cellX', 'cellY', 'direction']).doUpdateSet({
          passages: sql`world_desire_edges.passages + excluded.passages`,
          lastPassageAt: sql`greatest(world_desire_edges.last_passage_at, excluded.last_passage_at)`,
        }),
      )
      .execute();
  });
}
const east = (x: number, y: number): Edge => ({ x, y, direction: 0 });
const south = (x: number, y: number): Edge => ({ x, y, direction: 1 });
const chunkOf = (x: number, y: number) => `${Math.floor(x / 32)},${Math.floor(y / 32)}`;
async function counter(worldId: string, key: string) {
  const row = (
    await sql<{ epoch: string; revision: string }>`select epoch::text,revision::text from game_sync_streams
    where world_id=${worldId}::uuid and stream_kind='desire' and scope_key=${key}`.execute(db)
  ).rows[0];
  if (!row) throw Error('No desire stream ' + key);
  return row;
}
const revision = async (worldId: string, key: string) => BigInt((await counter(worldId, key)).revision);
async function journal(worldId: string, key: string) {
  return (
    await sql<{ revision: string; changes: Array<{ component: string; key: string }> }>`select revision::text,changes
    from game_sync_changes where world_id=${worldId}::uuid and stream_kind='desire' and scope_key=${key} order by revision`.execute(
      db,
    )
  ).rows;
}
const scope = (key: string) => ({ kind: 'desire' as const, key });
const request = (generation: number, scopes: Array<{ kind: 'desire'; key: string }>, cursors: unknown[] = []) =>
  ({ protocol: 2 as const, generation, scopes, cursors }) as Parameters<typeof captureSyncV2>[4];
const capture = (req: ReturnType<typeof request>, include?: Array<'desire'>) =>
  captureSyncV2(db, ids.account, 'aube', ids.village, req, include ? { include } : undefined);
const cursorsOf = (batch: SyncV2Batch) =>
  batch.groups.map((group) => ({ ...group.stream, revision: group.toRevision }));
const desireGroup = (batch: SyncV2Batch, key: string) =>
  batch.groups.find((group) => group.stream.kind === 'desire' && group.stream.key === key)!;
/** No count, no timestamp of an edge leaves the server, in any payload or journal row. */
function expectNoCounts(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(/"passages"|passageCount|lastPassage|last_passage|"count"/i);
}
async function pending() {
  return (
    await sql<{ n: string }>`select count(*)::text as n from game_sync_pending where stream_kind='desire'`.execute(db)
  ).rows[0]!.n;
}

it('publishes nothing for an edge below the threshold, whatever it counts', async () => {
  const key = chunkOf(100, 200),
    before = await revision(ids.world, key);
  for (let i = 1; i < N; i++) await pass(ids.world, [east(100, 200)]);
  expect(await revision(ids.world, key)).toBe(before);
  expect(await journal(ids.world, key)).toEqual([]);
  expect(await pending()).toBe('0');
  // A snapshot of that chunk lists no cell: a hidden edge is no entity.
  const snapshot = await capture(request(1, [scope(key)]));
  expect(snapshot.coverage).toBe('scope-snapshot');
  expect(desireGroup(snapshot, key).changes).toEqual([{ component: 'desirePaths', upsert: [], remove: [] }]);
  expectNoCounts(snapshot);
});

it('publishes the cell when an edge crosses the threshold, then only a change of mask', async () => {
  const key = chunkOf(100, 200);
  for (let i = 1; i < N; i++) await pass(ids.world, [east(100, 200)]);
  const before = await counter(ids.world, key);
  const first = await capture(request(2, [scope(key)]));
  const applied = applySyncV2Batch(
    {
      worldId: ids.world,
      villageId: ids.village,
      generation: 2,
      scopes: new Map(),
      subscribedScopes: new Set(first.groups.map((group) => `${group.stream.kind}:${group.stream.key}`)),
    },
    first,
  );
  expect(applied.kind).toBe('applied');
  let state: SyncV2State = applied.state;

  // The N-th passage: one revision, one reference to the origin cell.
  await pass(ids.world, [east(100, 200)]);
  expect(await revision(ids.world, key)).toBe(BigInt(before.revision) + 1n);
  expect(await journal(ids.world, key)).toEqual([
    { revision: String(BigInt(before.revision) + 1n), changes: [{ component: 'desirePaths', key: '100,200' }] },
  ]);
  const crossing = await capture(request(2, [scope(key)], cursorsOf(first)));
  expect(crossing.coverage).toBe('delta');
  expect(desireGroup(crossing, key).changes).toEqual([
    {
      component: 'desirePaths',
      upsert: [{ id: '100,200', cellX: 100, cellY: 200, east: true, south: false }],
      remove: [],
    },
  ]);
  state = (applySyncV2Batch(state, crossing) as { state: SyncV2State }).state;
  expect(desirePathsFromSyncV2(state).get('100,200')).toEqual({ cellX: 100, cellY: 200, east: true, south: false });

  // More passages on a visible edge change nothing a client can see.
  await pass(ids.world, [east(100, 200)], 5);
  expect(await revision(ids.world, key)).toBe(BigInt(before.revision) + 1n);

  // A second edge of the same cell: nothing until it is visible, then the mask is updated.
  for (let i = 1; i < N; i++) await pass(ids.world, [south(100, 200)]);
  expect(await revision(ids.world, key)).toBe(BigInt(before.revision) + 1n);
  await pass(ids.world, [south(100, 200)]);
  expect(await revision(ids.world, key)).toBe(BigInt(before.revision) + 2n);
  const mask = await capture(request(2, [scope(key)], cursorsOf(crossing)));
  expect(desireGroup(mask, key).changes).toEqual([
    {
      component: 'desirePaths',
      upsert: [{ id: '100,200', cellX: 100, cellY: 200, east: true, south: true }],
      remove: [],
    },
  ]);
  state = (applySyncV2Batch(state, mask) as { state: SyncV2State }).state;
  expect(desirePathsFromSyncV2(state).get('100,200')).toEqual({ cellX: 100, cellY: 200, east: true, south: true });
  expectNoCounts([first, crossing, mask, await journal(ids.world, key)]);
  // Resuming from a current cursor says nothing.
  const idle = await capture(request(2, [scope(key)], cursorsOf(mask)));
  expect(desireGroup(idle, key).changes).toEqual([]);
  expect(applySyncV2Batch(state, idle).kind).toBe('ignored');
});

it('publishes an edge inserted at or above the threshold, and an edge that is deleted', async () => {
  const key = chunkOf(40, 40),
    before = await revision(ids.world, key);
  // Inserted visible at once: exactly N, and well above it.
  await pass(ids.world, [east(40, 40)], N);
  expect(await revision(ids.world, key)).toBe(before + 1n);
  await pass(ids.world, [south(41, 40)], N + 4);
  expect(await revision(ids.world, key)).toBe(before + 2n);
  // Inserted hidden: nothing.
  await pass(ids.world, [east(42, 40)], N - 1);
  expect(await revision(ids.world, key)).toBe(before + 2n);
  // Deleting a hidden edge publishes nothing, a visible one does.
  await db.deleteFrom('worldDesireEdges').where('worldId', '=', ids.world).where('cellX', '=', 42).execute();
  expect(await revision(ids.world, key)).toBe(before + 2n);
  const base = await capture(request(3, [scope(key)]));
  await db.deleteFrom('worldDesireEdges').where('worldId', '=', ids.world).where('cellX', '=', 40).execute();
  expect(await revision(ids.world, key)).toBe(before + 3n);
  const removal = await capture(request(3, [scope(key)], cursorsOf(base)));
  expect(removal.coverage).toBe('delta');
  expect(desireGroup(removal, key).changes).toEqual([{ component: 'desirePaths', upsert: [], remove: ['40,40'] }]);
  // The cell with a remaining visible edge keeps being served.
  const snapshot = await capture(request(3, [scope(key)]));
  expect(desireGroup(snapshot, key).changes).toEqual([
    {
      component: 'desirePaths',
      upsert: [{ id: '41,40', cellX: 41, cellY: 40, east: false, south: true }],
      remove: [],
    },
  ]);
});

it('touches each chunk of one statement once, in a single commit, and no other', async () => {
  const keys = [chunkOf(5, 5), chunkOf(70, 5), chunkOf(5, 40), chunkOf(LAST_X, LAST_Y)];
  const before = await Promise.all(keys.map((key) => revision(ids.world, key)));
  const bystander = await revision(ids.world, chunkOf(300, 300));
  // Two cells of the first chunk, one in each of the others, the last cell of the world among them.
  await pass(
    ids.world,
    [east(5, 5), south(6, 5), east(70, 5), south(5, 40), east(LAST_X, LAST_Y), south(LAST_X, LAST_Y)],
    N,
  );
  const after = await Promise.all(keys.map((key) => revision(ids.world, key)));
  expect(after.map((value, i) => value - before[i]!)).toEqual([1n, 1n, 1n, 1n]);
  expect(await revision(ids.world, chunkOf(300, 300))).toBe(bystander);
  expect((await journal(ids.world, keys[0]!)).at(-1)!.changes).toEqual([
    { component: 'desirePaths', key: '5,5' },
    { component: 'desirePaths', key: '6,5' },
  ]);
  expect(await pending()).toBe('0');
  // The batch of one commit records the same vector for the four chunks.
  const vectors = (
    await sql<{
      batchId: string | null;
      dependencies: unknown[];
    }>`select dependencies_batch_id::text as "batchId",dependencies
    from game_sync_changes where world_id=${ids.world}::uuid and stream_kind='desire' and scope_key=any(${keys}::text[])
      and revision>0 order by scope_key`.execute(db)
  ).rows;
  expect(vectors).toHaveLength(4);
  expect(new Set(vectors.map((row) => row.batchId)).size).toBe(1);
  expect(vectors[0]!.batchId).not.toBeNull();
});

it('publishes the thousand edges of one task statement, once per chunk, in one commit', async () => {
  // The desire task upserts up to 1 000 edge rows per statement; x is coprime with the world's width, so every cell differs.
  const edges = Array.from({ length: 1000 }, (_, i) => ({
    x: (i * 37 + 11) % 2048,
    y: (i * 53 + 7) % 1024,
    direction: (i % 2) as 0 | 1,
  }));
  expect(new Set(edges.map((edge) => `${edge.x},${edge.y}`)).size).toBe(1000);
  const keys = [...new Set(edges.map((edge) => chunkOf(edge.x, edge.y)))].sort();
  const before = await Promise.all(keys.map((key) => revision(ids.world, key)));
  await pass(ids.world, edges, N);
  const after = await Promise.all(keys.map((key) => revision(ids.world, key)));
  expect(after.map((value, i) => value - before[i]!).every((step) => step === 1n)).toBe(true);
  expect(await pending()).toBe('0');
  // Every cell is a reference of exactly one chunk's journal row.
  const referenced = (
    await sql<{ n: string }>`select coalesce(sum(jsonb_array_length(changes)),0)::text as n from game_sync_changes
    where world_id=${ids.world}::uuid and stream_kind='desire' and scope_key=any(${keys}::text[]) and revision>0`.execute(
      db,
    )
  ).rows[0]!.n;
  expect(referenced).toBe('1000');
});

it('serves the last chunk of the torus: the origin cell of a seam edge stays in its own chunk', async () => {
  const key = chunkOf(LAST_X, LAST_Y);
  expect(key).toBe('63,31');
  await pass(ids.world, [east(LAST_X, LAST_Y), south(LAST_X, LAST_Y)], N);
  // East of the last column is column 0 and south of the last row is row 0: the
  // edge still belongs to its origin cell, in the last chunk.
  expect(chunkOf(0, LAST_Y)).toBe('0,31');
  expect(await journal(ids.world, '0,31')).toEqual([]);
  const snapshot = await capture(request(4, [scope(key), scope('0,0')]));
  expect(desireGroup(snapshot, key).changes).toEqual([
    {
      component: 'desirePaths',
      upsert: [{ id: `${LAST_X},${LAST_Y}`, cellX: LAST_X, cellY: LAST_Y, east: true, south: true }],
      remove: [],
    },
  ]);
  expect(desireGroup(snapshot, '0,0').changes).toEqual([{ component: 'desirePaths', upsert: [], remove: [] }]);
  // Chunks are canonical: past the world, or not a chunk, is refused.
  await expect(capture(request(4, [scope('64,0')]))).rejects.toMatchObject({ code: 'INVALID_SYNC_SCOPE' });
  await expect(capture(request(4, [scope('0,32')]))).rejects.toMatchObject({ code: 'INVALID_SYNC_SCOPE' });
  await expect(capture(request(4, [scope('-1,0')]))).rejects.toMatchObject({ code: 'INVALID_SYNC_SCOPE' });
  await expect(capture(request(4, [scope('01,0')]))).rejects.toMatchObject({ code: 'INVALID_SYNC_SCOPE' });
});

it('keeps every world to itself, and gives a new world its chunks', async () => {
  otherWorld = randomUUID();
  await db
    .insertInto('worlds')
    .values({
      id: otherWorld,
      slug: 'desire-stream-' + otherWorld,
      name: 'Desire stream test',
      topology: 'torus',
      widthCells: 64,
      heightCells: 32,
      chunkSize: 32,
      seed: 4116,
      generationVersion: 1,
      generationStatus: 'ready',
      isOpen: false,
      generatedAt: new Date(),
    })
    .execute();
  // A candidate that is not open has no desire stream (it may be deleted): none to orphan.
  expect(
    (
      await sql<{ key: string; revision: string }>`select scope_key as key,revision::text from game_sync_streams
      where world_id=${otherWorld}::uuid and stream_kind='desire' order by 1`.execute(db)
    ).rows,
  ).toEqual([]);
  // Opening it, the trigger on `worlds` creates one stream per chunk (2 x 1), at revision 0.
  await db.updateTable('worlds').set({ isOpen: true }).where('id', '=', otherWorld).execute();
  expect(
    (
      await sql<{ key: string; revision: string }>`select scope_key as key,revision::text from game_sync_streams
      where world_id=${otherWorld}::uuid and stream_kind='desire' order by 1`.execute(db)
    ).rows,
  ).toEqual([
    { key: '0,0', revision: '0' },
    { key: '1,0', revision: '0' },
  ]);
  const key = chunkOf(5, 5),
    mine = await revision(ids.world, key);
  await pass(otherWorld, [east(5, 5)], N);
  expect(await revision(otherWorld, '0,0')).toBe(1n);
  expect(await revision(ids.world, key)).toBe(mine);
  // The same cell in the other world: this village sees none of it, and then only its own.
  const alone = await capture(request(5, [scope(key)]));
  expect(desireGroup(alone, key).changes).toEqual([{ component: 'desirePaths', upsert: [], remove: [] }]);
  await pass(ids.world, [south(5, 5)], N);
  const both = await capture(request(5, [scope(key)]));
  expect(desireGroup(both, key).changes).toEqual([
    { component: 'desirePaths', upsert: [{ id: '5,5', cellX: 5, cellY: 5, east: false, south: true }], remove: [] },
  ]);
  // The reader of the other world, with its own size: the seam of a 64-cell world.
  await pass(otherWorld, [east(63, 31)], N);
  await db.transaction().execute(async (tx) => {
    const chunk = { worldId: otherWorld, widthCells: 64, heightCells: 32, chunkSize: 32, chunkY: 0 };
    expect(await readDesireScopeSnapshot(tx, { ...chunk, chunkX: 1 })).toEqual([
      {
        component: 'desirePaths',
        upsert: [{ id: '63,31', cellX: 63, cellY: 31, east: true, south: false }],
        remove: [],
      },
    ]);
    expect(await readDesireScopeSnapshot(tx, { ...chunk, chunkX: 0 })).toEqual([
      {
        component: 'desirePaths',
        upsert: [{ id: '5,5', cellX: 5, cellY: 5, east: true, south: false }],
        remove: [],
      },
    ]);
    // A chunk outside this world's grid is not a chunk of it.
    await expect(readDesireScopeSnapshot(tx, { ...chunk, chunkX: 2 })).rejects.toThrow('Non-canonical');
  });
  expectNoCounts([alone, both]);
  // Deleting a world with visible edges (the cascade) touches no desire stream of a world that is gone.
  await sql`delete from game_sync_streams where world_id=${otherWorld}::uuid`.execute(db);
  await db.deleteFrom('worlds').where('id', '=', otherWorld).execute();
  expect(
    (
      await sql<{
        n: string;
      }>`select count(*)::text as n from game_sync_streams where world_id=${otherWorld}::uuid and stream_kind='desire'`.execute(
        db,
      )
    ).rows[0]!.n,
  ).toBe('0');
  expect(await pending()).toBe('0');
  otherWorld = '';
});

it('bootstraps the chunks a village window covers, in one capture with its private stream', async () => {
  await pass(ids.world, [east(1024, 512), south(1030, 520)], N);
  const bootstrap = await capture(request(6, []), ['desire']);
  expect(bootstrap.coverage).toBe('scope-snapshot');
  const desire = bootstrap.groups.filter((group) => group.stream.kind === 'desire').map((group) => group.stream.key);
  // The dev village's window is 64 x 64 cells at (992, 480): chunks 31..32 by 15..16.
  expect(desire.sort()).toEqual(['31,15', '31,16', '32,15', '32,16']);
  expect(desire.length).toBeLessThanOrEqual(SYNC_V2_DESIRE_MAX_SCOPES);
  expect(bootstrap.groups.map((group) => group.stream.kind).filter((kind) => kind !== 'desire')).toEqual(['village']);
  const applied = applySyncV2Batch(
    {
      worldId: ids.world,
      villageId: ids.village,
      generation: 6,
      scopes: new Map(),
      subscribedScopes: new Set(bootstrap.groups.map((group) => `${group.stream.kind}:${group.stream.key}`)),
    },
    bootstrap,
  );
  expect(applied.kind).toBe('applied');
  expect([...desirePathsFromSyncV2(applied.state).keys()].sort()).toEqual(['1024,512', '1030,520']);
  expectNoCounts(bootstrap);
  // An explicit subscription is added to the resolved ones, once each.
  const plus = await capture(request(6, [scope('0,0'), scope('32,16')]), ['desire']);
  expect(plus.groups.filter((group) => group.stream.kind === 'desire')).toHaveLength(5);
  // A chunk with no stream row is left out of the resolution, not a failure of the capture.
  const removed = await counter(ids.world, '32,15');
  await sql`delete from game_sync_streams where world_id=${ids.world}::uuid and stream_kind='desire' and scope_key='32,15'`.execute(
    db,
  );
  try {
    const partial = await capture(request(6, []), ['desire']);
    expect(
      partial.groups
        .filter((group) => group.stream.kind === 'desire')
        .map((group) => group.stream.key)
        .sort(),
    ).toEqual(['31,15', '31,16', '32,16']);
  } finally {
    await sql`insert into game_sync_streams(world_id,stream_kind,scope_key,epoch,revision)
      values(${ids.world}::uuid,'desire','32,15',${removed.epoch}::uuid,${removed.revision}::bigint)`.execute(db);
  }
});

it('resolves a window across the seams of the torus, wrapped', async () => {
  // A village anchored at (4, 4): its window starts west of 0 and north of 0.
  await db.transaction().execute(async (tx) => {
    const keys = await desireScopesOfVillage(tx, {
      worldId: ids.world,
      villageId: randomUUID(),
      anchorCellX: 4,
      anchorCellY: 4,
      widthCells: 2048,
      heightCells: 1024,
      chunkSize: 32,
    });
    const rows = [0, 1, 31].flatMap((y) => [0, 1, 63].map((x) => `${x},${y}`));
    expect(keys).toEqual(rows.map((key) => scope(key)));
  });
});
