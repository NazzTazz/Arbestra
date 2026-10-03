import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { expect, it } from 'vitest';
import type { TerrainChunk } from '@arbestra/contracts';
import { TerrainRenderer } from './terrain-renderer';
import type { TerrainStore } from './terrain-store';
import { WorldSpace, type ChunkDemand } from './world-space';
import { TERRAIN_STREAMING } from './terrain-settings';

it('publishes nearby trees after their ground without waiting for all ground and pebbles', () => {
  const engine = new NullEngine(), scene = new Scene(engine), material = new StandardMaterial('shared', scene);
  const chunk: TerrainChunk = { chunkX: 0, chunkY: 0, originCellX: 0, originCellY: 0,
    terrainCodes: Array(34 ** 2).fill(1), elevations: Array(34 ** 2).fill(0), occupiedCells: [],
    features: [{ id: 'nearby-tree', type: 'woodland', cellX: 2, cellY: 2, variantSeed: 0, deposit: null }] };
  const demand = [{ key: '0:0', chunkX: 0, chunkY: 0, visible: true, distance: 0 }];
  const store = { world: { widthCells: 1024, heightCells: 1024, chunkSize: 32 }, changed: new Set<string>(), demand, chunk: () => chunk,
    key: (x: number, y: number) => `${Math.floor(x / 32)}:${Math.floor(y / 32)}` };
  let clock = 0, trees = 0;
  const renderer = new TerrainRenderer(scene, store as unknown as TerrainStore, new WorldSpace(1024, 1024, { cellX: 0, cellY: 0 }),
    material, material, () => [], () => [], () => {
      expect(renderer.rendered(2, 2)).toBe(true); trees++; return [];
    }, () => ({ cellX: 2, cellY: 2 }), () => clock += 0.6);
  try {
    renderer.demand(demand);
    for (let frame = 0; frame < 8; frame++) renderer.tick();
    expect(trees).toBe(1);
    expect(renderer.queued).toBeGreaterThan(0);
  } finally { renderer.dispose(); scene.dispose(); engine.dispose(); }
});

it('reuses resident geometry when rotation hides a tile and then reveals it again', () => {
  const engine = new NullEngine(), scene = new Scene(engine), material = new StandardMaterial('shared', scene);
  const chunk: TerrainChunk = { chunkX: 0, chunkY: 0, originCellX: 0, originCellY: 0,
    terrainCodes: Array(34 ** 2).fill(1), elevations: Array(34 ** 2).fill(0), occupiedCells: [],
    features: [{ id: 'retained-tree', type: 'woodland', cellX: 1, cellY: 1, variantSeed: 0, deposit: null }] };
  const demand = [{ key: '0:0', chunkX: 0, chunkY: 0, visible: true, distance: 0 }];
  const store = { world: { widthCells: 1024, heightCells: 1024, chunkSize: 32 }, changed: new Set<string>(), demand, chunk: () => chunk,
    key: (x: number, y: number) => `${Math.floor(x / 32)}:${Math.floor(y / 32)}` };
  const renderer = new TerrainRenderer(scene, store as unknown as TerrainStore, new WorldSpace(1024, 1024, { cellX: 0, cellY: 0 }),
    material, material, () => [], () => [], () => [MeshBuilder.CreateBox('retained-tree', {}, scene)]);
  try {
    renderer.demand(demand, (x, y) => x === 0 && y === 0);
    for (let frame = 0; renderer.queued && frame < 50; frame++) renderer.tick();
    const first = renderer.meshes()[0]!;
    const tree = renderer.meshes().find(m => m.name === 'retained-tree')!;
    renderer.setVisible(false);
    renderer.demand(demand, (x, y) => x === 0 && y === 0);
    expect(first.isEnabled()).toBe(false);
    expect(first.isDisposed()).toBe(false);
    renderer.setVisible(true);
    expect(first.isEnabled()).toBe(true);
    renderer.demand(demand, (x, y) => x === 4 && y === 0);
    for (let frame = 0; renderer.queued && frame < 50; frame++) renderer.tick();
    expect(first.isDisposed()).toBe(false);
    expect(tree.isDisposed()).toBe(false);
    expect(renderer.rendered(0, 0)).toBe(false);
    renderer.demand(demand, (x, y) => x === 0 && y === 0);
    expect(renderer.queued).toBe(0);
    expect(renderer.meshes()).toContain(first);
    expect(renderer.rendered(0, 0)).toBe(true);
    // Retention must not make a feature immortal after a complete server scope removes it.
    chunk.features = []; store.changed.add('0:0');
    renderer.demand(demand, (x, y) => x === 0 && y === 0);
    expect(tree.isDisposed()).toBe(true);
    expect(first.isDisposed()).toBe(false);
  } finally { renderer.dispose(); scene.dispose(); engine.dispose(); }
});

it('evicts graphics even when old chunks remain in the data prefetch ring, and releases Babylon resources', () => {
  const engine = new NullEngine(), scene = new Scene(engine), material = new StandardMaterial('shared', scene);
  const chunks = new Map<string, TerrainChunk>();
  const store = { world: { widthCells: 1024, heightCells: 1024, chunkSize: 4 }, changed: new Set<string>(), demand: [] as ChunkDemand[],
    chunk: (key: string) => chunks.get(key) };
  const renderer = new TerrainRenderer(scene, store as unknown as TerrainStore, new WorldSpace(1024, 1024, { cellX: 0, cellY: 0 }),
    material, material, () => [], () => { const mesh = MeshBuilder.CreateBox('decor', {}, scene); mesh.material = material; return [mesh]; }, () => []);
  let previous: ChunkDemand[] = [];
  try {
    for (let step = 0; step < 30; step++) {
      const visible = Array.from({ length: TERRAIN_STREAMING.graphicChunks - 1 }, (_, i) => {
        const x = step * 4 + i % 4, y = Math.floor(i / 4), key = `${x}:${y}`;
        chunks.set(key, { chunkX: x, chunkY: y, originCellX: x * 4, originCellY: y * 4,
          terrainCodes: Array(36).fill(1), elevations: Array(36).fill(0), features: [], occupiedCells: [] });
        return { key, chunkX: x, chunkY: y, visible: true, distance: i };
      });
      store.demand = [...visible, ...previous.map(d => ({ ...d, visible: false }))];
      renderer.demand(store.demand);
      expect(renderer.residents.size).toBeLessThanOrEqual(TERRAIN_STREAMING.graphicChunks - 1);
      for (let frame = 0; renderer.queued && frame < 500; frame++) renderer.tick();
      expect(renderer.queued).toBe(0);
      expect(scene.meshes.length).toBe(visible.length * 2);
      expect(scene.geometries.length).toBe(visible.length * 2);
      expect(scene.transformNodes.length).toBe(visible.length);
      previous = visible;
    }
    expect(renderer.peakGraphicChunks).toBeLessThanOrEqual(TERRAIN_STREAMING.graphicChunks);
    renderer.dispose();
    expect(scene.meshes).toHaveLength(0); expect(scene.geometries).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0);
    expect(scene.materials).toContain(material);
  } finally { renderer.dispose(); scene.dispose(); engine.dispose(); }
});
