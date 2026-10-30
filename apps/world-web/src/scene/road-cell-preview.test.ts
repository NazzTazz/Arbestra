import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { RoadCellPreview } from './road-cell-preview';

describe('RoadCellPreview', () => {
  it('moves a refused cell to the red mesh once, the rest keeping the gesture tone', () => {
    const engine = new NullEngine();
    // NullEngine reports no instanced arrays, which disables thin instances.
    (engine.getCaps() as { instancedArrays: boolean }).instancedArrays = true;
    const scene = new Scene(engine),
      preview = new RoadCellPreview(scene);
    try {
      for (let i = 0; i < 5; i++) preview.add(`${i}:0`, i, 0, 0, 2);
      preview.add('2:0', 2, 0, 0, 2, true);
      preview.add('2:0', 2, 0, 0, 2, true);
      // A cell refused before being designated is laid red directly.
      preview.add('9:0', 9, 0, 0, 2, true);
      const toned = scene.getMeshByName('road-cell-preview') as Mesh,
        red = scene.getMeshByName('road-cell-preview-refused') as Mesh;
      expect(preview.count).toBe(6);
      expect(preview.refusedCount).toBe(2);
      expect(red.thinInstanceCount).toBe(2);
      expect(toned.thinInstanceCount).toBe(6);
      // The refused cells are hidden (zero scale) in the toned mesh.
      const matrices = toned.thinInstanceGetWorldMatrices();
      expect(matrices[2]!.m[0]).toBe(0);
      expect(matrices[5]!.m[0]).toBe(0);
      expect(matrices[1]!.m[0]).toBe(2);
      expect(red.isEnabled()).toBe(true);
      preview.clear();
      expect(preview.refusedCount).toBe(0);
      expect(red.thinInstanceCount).toBe(0);
      expect(red.isEnabled()).toBe(false);
    } finally {
      preview.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});
