import { expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TimberThatch } from './timber-thatch';
import { buildUniversity } from './university-factory';

it('builds and disposes a bounded material batch for works and finished levels', () => {
  // NullEngine has no raster canvas. Geometry/lifecycle remain real Babylon;
  // drawing texture pixels is deliberately outside this test's contract.
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, bezierCurveTo() {}, ellipse() {} }; }
  });
  const engine = new NullEngine(), scene = new Scene(engine), kit = new TimberThatch(scene);
  try {
    for (const phase of ['works', 'finished'] as const) for (const level of [1, 2, 3]) {
      const root = new Mesh('university', scene);
      buildUniversity(root, kit, level, phase, level - 1, { mathematics: true, astronomy: true });
      const meshes = root.getChildMeshes().filter(m => m.getTotalVertices() > 0);
      expect(meshes.length).toBeLessThanOrEqual(60);
      expect(meshes.every(m => !m.isPickable)).toBe(true);
      for (const mesh of meshes) {
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        expect(box.minimumWorld.x).toBeGreaterThanOrEqual(-6.25 - 1e-6);
        expect(box.maximumWorld.x).toBeLessThanOrEqual(6.25 + 1e-6);
        expect(box.minimumWorld.z).toBeGreaterThanOrEqual(-7.5 - 1e-6);
        expect(box.maximumWorld.z).toBeLessThanOrEqual(7.5 + 1e-6);
      }
      root.dispose(false, false);
      expect(scene.meshes.every(m => m.isDisposed())).toBe(true);
    }
  } finally { scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); }
});
