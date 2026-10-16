import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { buildInfrastructurePresentation } from './infrastructure-factory';

it.each([false, true])('keeps an infrastructure presentation mobile after attaching, rotating and moving its root (ghost: %s)', preview => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const root = buildInfrastructurePresentation(scene, { fixture: 'elbow', material: 'stone-1', width: 4,
      border: true, quarterTurns: 0, length: 2, preview });
    const children = root.getChildMeshes(); expect(children.length).toBeGreaterThan(0);
    const before = children.map(mesh => { mesh.computeWorldMatrix(true); return mesh.getBoundingInfo().boundingSphere.centerWorld.clone(); });
    root.position.set(12, 3, -8); root.rotation.y = Math.PI / 2;
    children.forEach((mesh, i) => {
      mesh.computeWorldMatrix(true);
      const centre = mesh.getBoundingInfo().boundingSphere.centerWorld;
      expect(centre.x).toBeCloseTo(before[i]!.z + 12);
      expect(centre.y).toBeCloseTo(before[i]!.y + 3);
      expect(centre.z).toBeCloseTo(-before[i]!.x - 8);
    });
  } finally { scene.dispose(); engine.dispose(); }
});
