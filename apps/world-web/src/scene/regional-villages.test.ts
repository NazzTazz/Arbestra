import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { RegionalVillages } from './regional-villages';
import { WorldSpace } from './world-space';

it('keeps one mesh per village and releases replaced geometry across updates and torus rebases', () => {
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
      view.update(space, 'own', .5);
      expect(scene.meshes).toHaveLength(2); expect(scene.materials).toHaveLength(1);
      expect(previous.every(mesh => mesh.isDisposed())).toBe(true);
      expect(view.meshes.get('own')!.getTotalVertices()).toBe(64 * 24);
      expect(view.meshes.get('own')!.visibility).toBe(.5);
      expect(view.meshes.get('neighbor')!.visibility).toBe(1);
      space.rebase({ cellX: iteration * 32, cellY: 0 }, 32);
    }
    view.clear(); expect(scene.meshes).toHaveLength(0);
    view.dispose(); expect(scene.materials).toHaveLength(0);
  } finally { scene.dispose(); engine.dispose(); }
});
