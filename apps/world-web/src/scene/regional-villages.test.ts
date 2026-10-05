import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { RegionalVillages } from './regional-villages';
import { WorldSpace } from './world-space';

it('keeps foreign village meshes without replacing the loaded village and releases old geometry', () => {
  const engine = new NullEngine(), scene = new Scene(engine), view = new RegionalVillages(scene);
  const world = { id: 'test', widthCells: 2048, heightCells: 1024, chunkSize: 32, generationVersion: 1 };
  const space = new WorldSpace(2048, 1024, { cellX: 2047, cellY: 1023 });
  try {
    for (let iteration = 0; iteration < 8; iteration++) {
      const previous = [...view.meshes.values()];
      view.set({ world, sampledAt: new Date().toISOString(), truncated: false, villages: [
        { id: 'own', anchorCellX: 0, anchorCellY: 0, blocks: Array.from({ length: 64 }, (_, x) => ({ x, y: 0, width: 1, depth: 1, garden: x % 2 === 0 })) },
        { id: 'neighbor', anchorCellX: 2047, anchorCellY: 1023, blocks: [{ x: 0, y: 0, width: 2, depth: 2, garden: false }] },
      ] });
      view.update(space, 'own');
      expect(scene.meshes).toHaveLength(1); expect(scene.materials).toHaveLength(1);
      expect(previous.every(mesh => mesh.isDisposed())).toBe(true);
      expect(view.meshes.has('own')).toBe(false);
      expect(view.meshes.get('neighbor')!.getTotalVertices()).toBe(24);
      expect(view.meshes.get('neighbor')!.visibility).toBe(1);
      space.rebase({ cellX: iteration * 32, cellY: 0 }, 32);
    }
    view.clear(); expect(scene.meshes).toHaveLength(0);
    view.dispose(); expect(scene.materials).toHaveLength(0);
  } finally { scene.dispose(); engine.dispose(); }
});

it('renders distinct anonymous volumes without picking or hiding them with the own village', () => {
  const engine = new NullEngine(), scene = new Scene(engine), view = new RegionalVillages(scene);
  try {
    const block = { x: 0, y: 0, width: 2, depth: 1 };
    view.set({ world: { id: '10000000-0000-4000-8000-000000000001', generationVersion: 1, widthCells: 2048, heightCells: 1024, chunkSize: 32 },
      sampledAt: new Date().toISOString(), truncated: false, villages: [
        { id: 'own', anchorCellX: 0, anchorCellY: 0, blocks: [block] },
        { anchorCellX: 1, anchorCellY: 0, blocks: [block] },
        { anchorCellX: 2047, anchorCellY: 0, blocks: [block] },
      ] });
    view.update(new WorldSpace(2048, 1024, { cellX: 0, cellY: 0 }), 'own');
    expect(view.meshes.size).toBe(2);
    expect(view.meshes.has('own')).toBe(false);
    const anonymous = [...view.meshes].filter(([key]) => key !== 'own').map(([, mesh]) => mesh);
    expect(anonymous.every(mesh => mesh.isEnabled() && !mesh.isPickable && mesh.getTotalVertices() > 0)).toBe(true);
    expect(anonymous[0]!.getBoundingInfo().boundingBox.center.x).toBeGreaterThan(0);
    expect(anonymous[1]!.getBoundingInfo().boundingBox.center.x).toBeLessThan(0);
  } finally { view.dispose(); scene.dispose(); engine.dispose(); }
});
