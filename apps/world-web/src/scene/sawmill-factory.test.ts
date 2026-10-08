import {expect, it} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Ray} from '@babylonjs/core/Culling/ray';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {buildSawmill, type SawmillMaterials} from './sawmill-factory';

it.each([1, 2, 3])('keeps level %i geometry in local material batches with independent building picking', level => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const materials = Object.fromEntries(['stone', 'lightTimber', 'packedEarth', 'sawdust',
      'darkTimber', 'timber', 'roof', 'trunk'].map(name => [name, new StandardMaterial(name, scene)])) as unknown as SawmillMaterials;
    const a = buildSawmill(scene, materials, 'a', level, 12, -7);
    const b = buildSawmill(scene, materials, 'b', level, -12, 7);
    a.rotation.y = Math.PI / 2;
    const parts = [a, ...a.getChildMeshes()];
    expect(parts.length).toBeLessThanOrEqual(9);
    expect(parts.reduce((n, m) => n + m.getTotalIndices() / 3, 0)).toBe([780, 728, 776][level - 1]);
    for (const root of [a, b]) for (const mesh of [root, ...root.getChildMeshes()]) {
      mesh.metadata = {siteId: root.name}; mesh.isPickable = true; mesh.computeWorldMatrix(true);
    }
    expect(a.getHierarchyBoundingVectors().min.y).toBeCloseTo(.01);
    const pick = (x: number, z: number) => scene.pickWithRay(new Ray(new Vector3(x, 6, z), Vector3.Down()))?.pickedMesh?.metadata.siteId;
    expect(pick(12, -7)).toBe('sawmill-a');
    expect(pick(-12, 7)).toBe('sawmill-b');
    a.dispose(false, false);
    expect(pick(12, -7)).toBeUndefined();
    expect(pick(-12, 7)).toBe('sawmill-b');
    expect(scene.materials).toContain(materials.roof);
  } finally { scene.dispose(); engine.dispose(); }
});
