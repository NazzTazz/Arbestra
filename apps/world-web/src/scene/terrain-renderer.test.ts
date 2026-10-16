import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { expect, it } from 'vitest';
import { emptyInfrastructure, type TerrainChunk } from '@arbestra/contracts';
import { TerrainRenderer } from './terrain-renderer';
import type { TerrainStore } from './terrain-store';
import { WorldSpace, type ChunkDemand } from './world-space';
import { TERRAIN_STREAMING } from './terrain-settings';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';

it('counts prepared visible ground only after mesh admission, including replacement terraces', () => {
  const engine = new NullEngine(), scene = new Scene(engine), material = new StandardMaterial('ground', scene);
  const chunk: TerrainChunk = {chunkX: 0, chunkY: 0, originCellX: 0, originCellY: 0, terrainCodes: Array(36).fill(1),
    elevations: Array(36).fill(0), features: [], occupiedCells: [], rc1: {stride: 9, heights: Array(81).fill(1), water: Array(81).fill(0), terraces: []}};
  let received = false;
  const demand = [{key: '0:0', chunkX: 0, chunkY: 0, visible: true, distance: 0}];
  const store = {world: {widthCells: 128, heightCells: 128, chunkSize: 4}, changed: new Set<string>(), demand, chunk: () => received ? chunk : undefined};
  const renderer = new TerrainRenderer(scene, store as unknown as TerrainStore, new WorldSpace(128, 128, {cellX: 0, cellY: 0}), material, material, () => [], () => [], () => []);
  try {
    expect(renderer.groundProgress).toEqual({completed: 0, total: 0});
    renderer.demand(demand); expect(renderer.groundProgress).toEqual({completed: 0, total: 1});
    received = true; store.changed.add('0:0'); renderer.demand(demand);
    expect(renderer.groundProgress.completed).toBe(0); // Downloaded is not rendered.
    for (let i = 0; renderer.queued && i < 100; i++) renderer.tick();
    expect(renderer.groundProgress).toEqual({completed: 1, total: 1});
    chunk.rc1!.terraces = [{cellX: 1, cellY: 1, height: 2}]; store.changed.add('0:0');
    expect(renderer.groundProgress.completed).toBe(0); // Receipt precedes requeue.
    renderer.demand(demand); expect(renderer.groundProgress.completed).toBe(0);
    for (let i = 0; renderer.queued && i < 100; i++) renderer.tick();
    expect(renderer.groundProgress.completed).toBe(1);
  } finally {renderer.dispose(); scene.dispose(); engine.dispose();}
});

it('refreezes published ground and its picking bounds after origin shifts and toric reprojection', () => {
  const engine = new NullEngine(), scene = new Scene(engine), material = new StandardMaterial('ground', scene);
  const space = new WorldSpace(128, 128, { cellX: 0, cellY: 0 });
  const chunk: TerrainChunk = { chunkX: 0, chunkY: 0, originCellX: 0, originCellY: 0,
    terrainCodes: Array(36).fill(1), elevations: Array(36).fill(0), features: [], occupiedCells: [] };
  const demand = [{ key: '0:0', chunkX: 0, chunkY: 0, visible: true, distance: 0 }];
  const store = { world: { widthCells: 128, heightCells: 128, chunkSize: 4 }, changed: new Set<string>(), demand, chunk: () => chunk };
  const renderer = new TerrainRenderer(scene, store as unknown as TerrainStore, space, material, material, () => [], () => [], () => []);
  try {
    renderer.demand(demand); for (let i = 0; renderer.queued && i < 50; i++) renderer.tick();
    const ground = renderer.meshes()[0]!; ground.isPickable = true;
    expect(ground.isWorldMatrixFrozen).toBe(true);
    const initial = ground.getBoundingInfo().boundingSphere.centerWorld.clone();
    renderer.shift(80, -40);
    expect(ground.getBoundingInfo().boundingSphere.centerWorld.x).toBeCloseTo(initial.x - 80);
    expect(ground.getBoundingInfo().boundingSphere.centerWorld.z).toBeCloseTo(initial.z + 40);
    // demand reprojects a retained resident from its canonical origin.
    renderer.demand(demand);
    const centre = ground.getBoundingInfo().boundingSphere.centerWorld;
    expect(centre.equalsWithEpsilon(initial)).toBe(true);
    expect(renderer.meshes()[0]).toBe(ground);
    expect(scene.pickWithRay(new Ray(new Vector3(centre.x, 100, centre.z), Vector3.Down()), m => m === ground)?.hit).toBe(true);
  } finally { renderer.dispose(); scene.dispose(); engine.dispose(); }
});

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


it('keeps RC1 ground after road and revision edits but rebuilds a changed terrace', () => {
  const engine = new NullEngine(), scene = new Scene(engine), material = new StandardMaterial('shared', scene);
  const chunk: TerrainChunk = { chunkX: 0, chunkY: 0, originCellX: 0, originCellY: 0,
    terrainCodes: Array(34 ** 2).fill(1), elevations: Array(34 ** 2).fill(0), occupiedCells: [], features: [],
    rc1: { stride: 65, heights: Array(65 ** 2).fill(1), water: Array(65 ** 2).fill(0), terraces: [] } };
  const demand = [{ key: '0:0', chunkX: 0, chunkY: 0, visible: true, distance: 0 }];
  const store = { world: { widthCells: 512, heightCells: 256, chunkSize: 32 }, changed: new Set<string>(), demand,
    chunk: () => chunk, key: (x: number, y: number) => `${Math.floor(x / 32)}:${Math.floor(y / 32)}` };
  const renderer = new TerrainRenderer(scene, store as unknown as TerrainStore, new WorldSpace(512, 256, { cellX: 0, cellY: 0 }),
    material, material, () => [], () => [], () => []);
  const drain = () => { for (let frame = 0; renderer.queued && frame < 2000; frame++) renderer.tick(); expect(renderer.queued).toBe(0); };
  try {
    const plan = emptyInfrastructure();
    renderer.setInfrastructure(plan); renderer.setRoads([]); renderer.demand(demand); drain();
    const initial = [...renderer.meshes()], version = renderer.version;
    plan.roads.push({ id: 'road', operation: 'paint', material: 'stone-1', width: 4, border: true,
      points: [{ x: 16, y: 16 }, { x: 32, y: 16 }] }); plan.revision++;
    const routes = [{ id: 'automatic', kind: 'building' as const, destination: { cellX: 3, cellY: 2 },
      cells: [{ cellX: 1, cellY: 2 }, { cellX: 3, cellY: 2 }] }];
    renderer.setInfrastructure(plan); renderer.setRoads(routes);
    expect(renderer.queued).toBe(0); expect(renderer.version).toBe(version); expect(renderer.meshes()).toEqual(initial);
    expect(initial.every(mesh => !mesh.isDisposed())).toBe(true);
    plan.revision++; renderer.setInfrastructure(plan); renderer.setRoads(routes);
    expect(renderer.queued).toBe(0); expect(renderer.version).toBe(version); expect(renderer.meshes()).toEqual(initial);
    // A complete chunk refresh must retain this rule, rather than smuggling the road revision into its signature.
    store.changed.add('0:0'); renderer.demand(demand);
    expect(renderer.queued).toBe(0); expect(renderer.meshes()).toEqual(initial);
    chunk.rc1!.terraces = [{ cellX: 2, cellY: 2, height: 1.25 }]; store.changed.add('0:0'); renderer.demand(demand);
    expect(renderer.queued).toBeGreaterThan(0); drain();
    expect(renderer.version).toBeGreaterThan(version); expect(initial.some(mesh => mesh.isDisposed())).toBe(true);
    const ground = renderer.residents.get('0:0')!.units.get('ground:0:0')!.meshes[0]!;
    expect(Math.max(...ground.getVerticesData('position')!.filter((_, i) => i % 3 === 1))).toBeCloseTo(3.125);
  } finally { renderer.dispose(); scene.dispose(); engine.dispose(); }
});
