import { expect, it } from 'vitest';
import { applySyncV2Batch, visibleSyncV2Scope, type SyncV2Batch, type SyncV2State } from './sync-v2.js';
import { SYNC_V2_DESIRE_COMPONENTS, SYNC_V2_DESIRE_MAX_SCOPES, desireScopeKeys } from './sync-v2-desire.js';
import { desirePathsFromSyncV2, NO_DESIRE_PATHS } from './sync-v2-village-state.js';

const worldId = '11111111-1111-4111-8111-111111111111',
  villageId = '22222222-2222-4222-8222-222222222222',
  epoch = '33333333-3333-4333-8333-333333333333';
const subscribed = (...keys: string[]) => new Set(keys.map((key) => `desire:${key}`));
const empty = (...keys: string[]): SyncV2State => ({
  worldId,
  villageId,
  generation: 1,
  scopes: new Map(),
  subscribedScopes: subscribed(...keys),
});
type Group = SyncV2Batch['groups'][number];
const cell = (cellX: number, cellY: number, east: boolean, south: boolean) => ({
  id: `${cellX},${cellY}`,
  cellX,
  cellY,
  east,
  south,
});
const group = (key: string, from: string, to: string, changes: Group['changes']): Group => ({
  stream: { kind: 'desire', key, epoch },
  fromRevision: from,
  toRevision: to,
  changes,
});
const batch = (coverage: SyncV2Batch['coverage'], ...groups: Group[]): SyncV2Batch => ({
  protocol: 2,
  worldId,
  villageId,
  generation: 1,
  observedAt: '2026-11-15T12:00:00.000Z',
  coverage,
  groups,
});
const paths = (upsert: unknown[], remove: string[] = []) =>
  ({ component: 'desirePaths', upsert, remove }) as unknown as Group['changes'][number];

it('registers the desire stream with its single component', () => {
  expect(SYNC_V2_DESIRE_COMPONENTS).toEqual(['desirePaths']);
});

it('applies a desire snapshot then a delta, and derives the visible cells of every subscribed chunk', () => {
  let state = empty('0,0', '1,0');
  const snapshot = applySyncV2Batch(
    state,
    batch(
      'scope-snapshot',
      group('0,0', '0', '4', [paths([cell(3, 5, true, false), cell(4, 5, false, true)])]),
      group('1,0', '0', '2', [paths([cell(33, 7, true, true)])]),
    ),
  );
  expect(snapshot.kind).toBe('applied');
  state = snapshot.state;
  expect([...desirePathsFromSyncV2(state)]).toEqual([
    ['3,5', { cellX: 3, cellY: 5, east: true, south: false }],
    ['4,5', { cellX: 4, cellY: 5, east: false, south: true }],
    ['33,7', { cellX: 33, cellY: 7, east: true, south: true }],
  ]);
  // A second edge on a cell updates its mask; another cell leaves.
  const delta = applySyncV2Batch(
    state,
    batch('delta', group('0,0', '4', '5', [paths([cell(3, 5, true, true)], ['4,5'])])),
  );
  expect(delta.kind).toBe('applied');
  state = delta.state;
  expect(state.scopes.get('desire:0,0')!.revision).toBe('5');
  expect(state.scopes.get('desire:1,0')!.revision).toBe('2');
  expect(desirePathsFromSyncV2(state).get('3,5')).toEqual({ cellX: 3, cellY: 5, east: true, south: true });
  expect(desirePathsFromSyncV2(state).has('4,5')).toBe(false);
  expect(visibleSyncV2Scope(state.scopes.get('desire:0,0')!).size).toBe(1);
  // No desire scope subscribed: nothing derived.
  expect(desirePathsFromSyncV2({ ...state, scopes: new Map() })).toBe(NO_DESIRE_PATHS);
  expect(NO_DESIRE_PATHS.size).toBe(0);
});

it('carries the diagonal edges of a cell as flags present only when true (R2a)', () => {
  let state = empty('0,0', '1,0');
  const snapshot = applySyncV2Batch(
    state,
    batch(
      'scope-snapshot',
      group('0,0', '0', '4', [
        paths([
          { ...cell(3, 5, false, false), southEast: true },
          { ...cell(4, 5, true, false), southWest: true },
          // The entity of T3b, without the new flags, is still a cell.
          cell(5, 5, false, true),
        ]),
      ]),
      group('1,0', '0', '2', [paths([{ ...cell(33, 7, true, true), southEast: true, southWest: true }])]),
    ),
  );
  expect(snapshot.kind).toBe('applied');
  state = snapshot.state;
  expect([...desirePathsFromSyncV2(state)]).toEqual([
    ['3,5', { cellX: 3, cellY: 5, east: false, south: false, southEast: true }],
    ['4,5', { cellX: 4, cellY: 5, east: true, south: false, southWest: true }],
    ['5,5', { cellX: 5, cellY: 5, east: false, south: true }],
    ['33,7', { cellX: 33, cellY: 7, east: true, south: true, southEast: true, southWest: true }],
  ]);
  expect('southEast' in desirePathsFromSyncV2(state).get('5,5')!).toBe(false);
  // A delta that loses the diagonal drops the flag.
  const delta = applySyncV2Batch(state, batch('delta', group('0,0', '4', '5', [paths([cell(4, 5, true, false)])])));
  expect(delta.kind).toBe('applied');
  expect(desirePathsFromSyncV2(delta.state).get('4,5')).toEqual({ cellX: 4, cellY: 5, east: true, south: false });
  // One representation only: a flag is never false, nor anything but a boolean true.
  const base = (entity: unknown) => batch('scope-snapshot', group('0,0', '0', '1', [paths([entity])]));
  const fresh = empty('0,0');
  for (const entity of [
    { ...cell(3, 5, true, false), southEast: false },
    { ...cell(3, 5, true, false), southWest: false },
    { ...cell(3, 5, true, false), southEast: 1 },
    { ...cell(3, 5, true, false), northEast: true },
  ])
    expect(applySyncV2Batch(fresh, base(entity))).toEqual({ kind: 'resync', state: fresh });
});

it('rejects a malformed or unknown desire entity as a resync, and never carries a count', () => {
  const state = empty('0,0');
  const valid = cell(3, 5, true, false);
  const base = (entity: unknown) => batch('scope-snapshot', group('0,0', '0', '1', [paths([entity])]));
  expect(applySyncV2Batch(state, base(valid)).kind).toBe('applied');
  for (const entity of [
    { ...valid, passages: 3 },
    { ...valid, lastPassageAt: '2026-11-15T12:00:00.000Z' },
    { ...valid, east: 1 },
    { ...valid, cellX: -1 },
    { ...valid, cellY: 1.5 },
    { ...valid, id: 'x,y' },
    { id: '3,5', cellX: 3, cellY: 5, east: true },
  ])
    expect(applySyncV2Batch(state, base(entity))).toEqual({ kind: 'resync', state });
  // A removal must be a cell key too, and a change holds at most 1024 cells.
  expect(applySyncV2Batch(state, batch('scope-snapshot', group('0,0', '0', '1', [paths([], ['not-a-cell'])])))).toEqual(
    { kind: 'resync', state },
  );
  const many = Array.from({ length: 1025 }, (_, i) => cell(i % 32, Math.floor(i / 32), true, false));
  expect(applySyncV2Batch(state, base(many[0])).kind).toBe('applied');
  expect(applySyncV2Batch(state, batch('scope-snapshot', group('0,0', '0', '1', [paths(many)])))).toEqual({
    kind: 'resync',
    state,
  });
  expect(
    applySyncV2Batch(state, batch('scope-snapshot', group('0,0', '0', '1', [paths(many.slice(0, 1024))]))).kind,
  ).toBe('applied');
});

it('refuses a desire group outside the subscription, a foreign component, a duplicated cell and a hole', () => {
  const snapshot = (key: string) => batch('scope-snapshot', group(key, '0', '3', [paths([cell(3, 5, true, false)])]));
  expect(applySyncV2Batch(empty('0,0'), snapshot('1,0')).kind).toBe('resync');
  // A spatial component does not belong to a desire stream.
  const foreign = batch(
    'scope-snapshot',
    group('0,0', '0', '3', [{ component: 'spatialCells', upsert: [], remove: [] }]),
  );
  expect(applySyncV2Batch(empty('0,0'), foreign).kind).toBe('resync');
  // The same cell twice in one group (upserted and removed).
  const state = applySyncV2Batch(empty('0,0'), snapshot('0,0')).state;
  expect(
    applySyncV2Batch(state, batch('delta', group('0,0', '3', '4', [paths([cell(3, 5, true, true)], ['3,5'])]))).kind,
  ).toBe('resync');
  // A delta must start at the applied revision, and a new epoch needs a snapshot.
  expect(applySyncV2Batch(state, batch('delta', group('0,0', '4', '5', [paths([])]))).kind).toBe('resync');
  const replaced = batch('delta', {
    ...group('0,0', '3', '4', [paths([])]),
    stream: { kind: 'desire', key: '0,0', epoch: villageId },
  });
  expect(applySyncV2Batch(state, replaced).kind).toBe('resync');
});

it('requires the complete registry in a desire scope snapshot, an empty chunk included', () => {
  const state = empty('2,1');
  // No component at all is not a snapshot.
  expect(applySyncV2Batch(state, batch('scope-snapshot', group('2,1', '0', '0', []))).kind).toBe('resync');
  // The same component twice neither.
  expect(applySyncV2Batch(state, batch('scope-snapshot', group('2,1', '0', '0', [paths([]), paths([])]))).kind).toBe(
    'resync',
  );
  // An empty chunk is the registry with no cell.
  const emptyChunk = applySyncV2Batch(state, batch('scope-snapshot', group('2,1', '0', '0', [paths([])])));
  expect(emptyChunk.kind).toBe('applied');
  expect(desirePathsFromSyncV2(emptyChunk.state).size).toBe(0);
  expect(emptyChunk.state.scopes.get('desire:2,1')).toMatchObject({ epoch, revision: '0' });
});

const world = { widthCells: 512, heightCells: 256, chunkSize: 32 };
const region = (originCellX: number, originCellY: number, width: number, height: number) => ({
  originCellX,
  originCellY,
  width,
  height,
});
/** Keys in the reader's order: by chunk row, then column. */
const rows = (ys: number[], xs: number[]) => ys.flatMap((y) => xs.map((x) => `${x},${y}`));

it('subscribes to the chunks a window covers, wrapping on the torus', () => {
  // 64 x 64 cells starting on a chunk boundary cover 2 x 2 chunks.
  expect(desireScopeKeys(region(64, 32, 64, 64), world)).toEqual(rows([1, 2], [2, 3]));
  // Starting mid-chunk, the same size reaches a third chunk on each axis.
  expect(desireScopeKeys(region(80, 48, 64, 64), world)).toEqual(rows([1, 2, 3], [2, 3, 4]));
  // East seam (x 480..543 wraps to 0..31) and south seam (y 224..287 wraps to 0..31).
  expect(desireScopeKeys(region(480, 224, 64, 64), world)).toEqual(rows([0, 7], [0, 15]));
  // The last cell of the world and the first chunks past it.
  expect(desireScopeKeys(region(511, 255, 70, 70), world)).toEqual(rows([0, 1, 2, 7], [0, 1, 2, 15]));
  // A window as wide as the world holds every chunk of that axis.
  expect(desireScopeKeys(region(100, 0, 512, 32), world)).toEqual(
    rows(
      [0],
      Array.from({ length: 16 }, (_, x) => x),
    ),
  );
  // Canonical chunk units, never past the world and never negative.
  for (const key of desireScopeKeys(region(511, 255, 70, 70), world)) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(16);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(8);
  }
});

it('stays within the scope cap, keeping the chunks nearest the window centre', () => {
  // The whole world is 16 x 8 = 128 chunks: more than one capture subscribes to.
  const all = desireScopeKeys(region(0, 0, 512, 256), world);
  expect(all).toHaveLength(SYNC_V2_DESIRE_MAX_SCOPES);
  expect(new Set(all).size).toBe(SYNC_V2_DESIRE_MAX_SCOPES);
  // A capture holds 64 scopes at most: the private stream and four shared ones come first.
  expect(SYNC_V2_DESIRE_MAX_SCOPES + 5).toBeLessThanOrEqual(64);
  // The centre of this window is cell (0, 0) after wrapping: chunk 0,0 and its torus
  // neighbours (1,0), (15,0), (0,1) and (0,7) are the five nearest.
  expect(desireScopeKeys(region(256, 128, 512, 256), world, 5)).toEqual(['0,0', '1,0', '15,0', '0,1', '0,7']);
  expect(desireScopeKeys(region(448, 192, 128, 128), world, 1)).toEqual(['0,0']);
  // Deterministic, and an empty cap asks for nothing.
  expect(desireScopeKeys(region(256, 128, 512, 256), world, 5)).toEqual(
    desireScopeKeys(region(256, 128, 512, 256), world, 5),
  );
  expect(desireScopeKeys(region(0, 0, 512, 256), world, 0)).toEqual([]);
});
