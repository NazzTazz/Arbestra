import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { BrazierMeshIndex } from './brazier-mesh-index';
import { bindBrazierLights } from './village-braziers';
import { freezeStaticHierarchy, refreshStaticHierarchy } from './static-transforms';

it('matches a full scan while skipping distant static meshes, including movement, LOD, rebasing and replacement', () => {
  const engine = new NullEngine(), scene = new Scene(engine), index = new BrazierMeshIndex(scene);
  try {
    const meshes = Array.from({ length: 200 }, (_, i) => {
      const mesh = MeshBuilder.CreateBox(`receiver-${i}`, {}, scene);
      mesh.position.set(i * 2 - 100, i % 3, i % 7 - 3); freezeStaticHierarchy(mesh); return mesh;
    });
    const actor = MeshBuilder.CreateBox('moving', {}, scene);
    const lights = [0, 2, -3].map(x => new PointLight(`light-${x}`, new Vector3(x, 1, 0), scene));
    const check = () => {
      actor.computeWorldMatrix(true);
      bindBrazierLights(lights, scene.meshes);
      const expected = lights.map(l => l.isEnabled() ? l.includedOnlyMeshes.map(m => m.uniqueId) : []);
      const candidates = index.nearby(lights); expect(candidates.length).toBeLessThan(25);
      bindBrazierLights(lights, candidates);
      expect(lights.map(l => l.isEnabled() ? l.includedOnlyMeshes.map(m => m.uniqueId) : [])).toEqual(expected);
    };
    check(); actor.position.x = 100; check();
    meshes[50]!.setEnabled(false); check(); meshes[50]!.setEnabled(true); check();
    meshes[0]!.position.x = 1; refreshStaticHierarchy(meshes[0]!); check();
    meshes[51]!.dispose();
    const replacement = MeshBuilder.CreateBox('replacement', {}, scene); freezeStaticHierarchy(replacement); check();
    for (const light of lights) light.position.x += 100; check();
  } finally { index.dispose(); scene.dispose(); engine.dispose(); }
});
