import { describe, expect, it } from 'vitest';
import { ChunkNavigationCache, MESH_DIRECTIONS, MeshEdge } from './chunk-navigation-mesh.js';
import type { RouteField } from './route-planner.js';
import type { SpawnAccessField } from './spawn-access.js';

function fixture() {
  let reads = 0;
  const field: RouteField = {
    worldId: 'w',
    contextId: 'c',
    width: 70,
    height: 35,
    traversalConstraintsId: 'none',
    accesses: [],
    connector: () => false,
    sample(x, y) {
      reads++;
      return { elevation: 1, dry: true, blocked: x > 8.4 && x < 8.6 && y < 10 };
    },
  };
  return { field, reads: () => reads };
}
it('restores certified and blocked edges without sampling, including a seam and partial chunk', () => {
  const f = fixture(),
    cache = new ChunkNavigationCache(f.field, 16);
  const edges = [
    { a: { cellX: 69, cellY: 5 }, b: { cellX: 0, cellY: 5 }, valid: true },
    { a: { cellX: 8, cellY: 5 }, b: { cellX: 9, cellY: 5 }, valid: false },
  ];
  for (const e of edges) expect(cache.walk(e.a, e.b)).toBe(e.valid);
  const before = f.reads(),
    restored = new ChunkNavigationCache(f.field, 16, cache.changed());
  for (const e of edges) {
    expect(restored.walk(e.a, e.b)).toBe(e.valid);
    expect(restored.walk(e.b, e.a)).toBe(e.valid);
  }
  expect(f.reads()).toBe(before);
  expect(restored.hits).toBe(4);
  expect(restored.changed()).toEqual([]);
});
it('keeps subcell certification and unknown edges physical', () => {
  const f = fixture(),
    cache = new ChunkNavigationCache(f.field, 16);
  expect(cache.walk({ cellX: 8, cellY: 5 }, { cellX: 8.5, cellY: 5 })).toBe(false);
  expect(cache.changed()).toEqual([]);
  expect(cache.walk({ cellX: 1, cellY: 1 }, { cellX: 2, cellY: 1 })).toBe(true);
  expect(cache.checks).toBe(1);
  expect(f.reads()).toBeGreaterThan(0);
});
describe('eight-direction mesh (spec trajets 8 directions §3.2)', () => {
  const open = (blocked: (x: number, y: number) => boolean = () => false) => {
    let reads = 0;
    const field: SpawnAccessField = {
      width: 40,
      height: 20,
      sample(x, y) {
        reads++;
        return { elevation: 1, dry: true, blocked: blocked(x, y) };
      },
    };
    return { field, reads: () => reads };
  };
  it('stores four undirected edges per cell and answers the four others from the neighbour', () => {
    const f = open(),
      cache = new ChunkNavigationCache(f.field, 16);
    for (let d = 0; d < 8; d++) expect(cache.edge(5, 5, d)).toBe(MeshEdge.straight);
    expect(cache.checks).toBe(8);
    // Each edge seen from its other end: no new test.
    for (let d = 0; d < 8; d++) {
      const [dx, dy] = MESH_DIRECTIONS[d]!;
      expect(cache.edge(5 + dx, 5 + dy, (d + 4) % 8)).toBe(MeshEdge.straight);
    }
    expect(cache.checks).toBe(8);
    expect(cache.hits).toBe(8);
  });
  it('restores diagonals, bends and blocks across both seams without sampling', () => {
    const f = open((x, y) => Math.hypot(x - 10.5, y - 5) < 0.05),
      detour = (a: { cellX: number; cellY: number }, b: { cellX: number; cellY: number }) => [
        a,
        { cellX: a.cellX, cellY: a.cellY + 0.25 },
        { cellX: b.cellX, cellY: b.cellY + 0.25 },
        b,
      ];
    const cache = new ChunkNavigationCache(f.field, 16, [], { detour });
    expect(cache.edge(39, 19, 1)).toBe(MeshEdge.straight); // (39,19) -> (0,0), both seams
    expect(cache.edge(10, 5, 0)).toBe(MeshEdge.bent);
    expect(cache.geometry(11, 5, 4)).toEqual([
      { cellX: 11, cellY: 5 },
      { cellX: 11, cellY: 5.25 },
      { cellX: 10, cellY: 5.25 },
      { cellX: 10, cellY: 5 },
    ]);
    const reads = f.reads(),
      restored = new ChunkNavigationCache(f.field, 16, cache.changed(), { detour });
    expect(restored.edge(0, 0, 5)).toBe(MeshEdge.straight);
    expect(restored.edge(11, 5, 4)).toBe(MeshEdge.bent);
    expect(f.reads()).toBe(reads);
    expect(restored.checks).toBe(0);
  });
  it('blocks an edge whose cell has no node, and keeps the trade interface straight-only', () => {
    const f = open(),
      cache = new ChunkNavigationCache(f.field, 16, [], {
        anchor: (x, y) => (x === 3 && y === 3 ? null : { cellX: x, cellY: y }),
      });
    expect(cache.edge(2, 3, 0)).toBe(MeshEdge.blocked);
    expect(cache.edge(4, 4, 5)).toBe(MeshEdge.blocked);
    expect(cache.edge(2, 2, 1)).toBe(MeshEdge.blocked);
    const trade = new ChunkNavigationCache(open((x) => x > 8.4 && x < 8.6).field, 16);
    expect(trade.walk({ cellX: 8, cellY: 5 }, { cellX: 9, cellY: 5 })).toBe(false);
    expect(trade.edge(8, 5, 0)).toBe(MeshEdge.blocked);
  });
});
