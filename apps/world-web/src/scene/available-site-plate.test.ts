import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Culling/ray';
import { createAvailableSitePlate } from './available-site-plate';

it('keeps 300 construction plates pickable without a single draw call (§7.14)', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    new ArcRotateCamera('camera', 0, 0.8, 60, Vector3.Zero(), scene);
    const material = new StandardMaterial('available-site', scene);
    material.alpha = 0;
    const plates = [];
    for (let i = 0; i < 300; i++) {
      const plate = createAvailableSitePlate(scene, `site-${i}`, i % 50 === 0, material, true);
      plate.position.set((i % 20) * 2.5 - 25, 0.075, Math.floor(i / 20) * 2.5 - 20);
      plate.metadata = { ...plate.metadata, siteId: `site-${i}` };
      plates.push(plate);
    }
    // As the LOD fade of the village meshes: base visibility × mode factor.
    for (const plate of plates) plate.visibility = plate.metadata.baseVisibility * 1;
    scene.render();
    expect(scene.getActiveMeshes().length).toBe(0);
    // Construction picking (isEnabled, isVisible, isPickable, siteId) still finds a plate.
    const target = plates[42]!;
    const hit = scene.pickWithRay(
      new Ray(target.position.add(new Vector3(0, 5, 0)), new Vector3(0, -1, 0), 10),
      (mesh) => mesh.isEnabled() && mesh.isVisible && mesh.isPickable && typeof mesh.metadata?.siteId === 'string',
    );
    expect(hit?.pickedMesh).toBe(target);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
