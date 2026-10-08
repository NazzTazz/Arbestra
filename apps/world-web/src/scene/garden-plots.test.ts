import {expect, it} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {InstancedMesh} from '@babylonjs/core/Meshes/instancedMesh';
import {Ray} from '@babylonjs/core/Culling/ray';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {GardenPlots} from './garden-plots';

function setup() {
  const engine = new NullEngine(), scene = new Scene(engine);
  const materials = {soil: new StandardMaterial('soil', scene),
    tiles: Array.from({length: 8}, (_, i) => new StandardMaterial(`stage-${i}`, scene)),
    marker: new StandardMaterial('marker', scene), stem: new StandardMaterial('stem', scene)};
  const renderer = new GardenPlots(scene, materials);
  const create = (id: string, x: number, stage: number, full = false) => {
    const plot = renderer.create(id, x, 0, .4, stage, full);
    for (const mesh of [plot, ...plot.getChildMeshes()]) mesh.metadata = {siteId: id};
    return plot;
  };
  const pick = (x: number) => {
    for (const mesh of scene.meshes) mesh.computeWorldMatrix(true);
    return scene.pickWithRay(new Ray(new Vector3(x, 4, 0), Vector3.Down()),
      mesh => mesh.isPickable && mesh.isVisible && !!mesh.metadata?.siteId);
  };
  return {engine, scene, materials, create, pick};
}

it('shares each crop stage while preserving plot picking, harvest replacement and rebasing', () => {
  const {engine, scene, materials, create, pick} = setup();
  try {
    const a = create('a', -3, 7, true), b = create('b', 3, 7, true);
    const surface = (id: string) => scene.getMeshByName(`garden-surface-${id}`) as InstancedMesh;
    const shared = surface('a').sourceMesh;
    expect(surface('b').sourceMesh).toBe(shared);
    expect(shared.material).toBe(materials.tiles[7]);
    expect(shared.isVisible).toBe(false); expect(shared.isPickable).toBe(false);
    expect(pick(-3)?.pickedMesh?.metadata.siteId).toBe('a');
    expect(pick(3)?.pickedMesh?.metadata.siteId).toBe('b');
    // Markers must never intercept the crop surface.
    expect(pick(-3)?.pickedMesh?.name).toBe('garden-surface-a');
    expect(pick(-3)?.pickedPoint?.y).toBeCloseTo(.56);
    a.dispose(false, false);
    create('a', -3, 1);
    expect(surface('a').material).toBe(materials.tiles[1]);
    expect(surface('b').material).toBe(materials.tiles[7]);
    expect(scene.getMeshByName('garden-full-a')).toBeNull();
    expect(scene.getMeshByName('garden-full-b')).not.toBeNull();
    expect(shared.isDisposed()).toBe(false);
    b.position.x += 20;
    expect(pick(3)?.hit).toBe(false);
    expect(pick(23)?.pickedMesh?.metadata.siteId).toBe('b');
    b.dispose(false, false);
    expect(pick(23)?.hit).toBe(false);
    expect(pick(-3)?.pickedMesh?.metadata.siteId).toBe('a');
  } finally { scene.dispose(); engine.dispose(); }
});

it('preserves the open soil cap and uses bounded reusable templates across all growth stages', () => {
  const {engine, scene, create} = setup();
  try {
    for (let i = 0; i < 8; i++) create(`stage-${i}`, i * 3, i, i === 7);
    const sources = scene.meshes.filter(m => m.name.startsWith('garden-source-'));
    expect(sources).toHaveLength(11); // soil, eight crop surfaces, ripe marker and stem
    const soil = scene.getMeshByName('garden-source-soil')!;
    const indices = soil.getIndices()!, normals = soil.getVerticesData('normal')!;
    for (let i = 0; i < indices.length; i += 3) expect(normals[indices[i]! * 3 + 1]).toBeLessThan(.5);
    expect(scene.getMeshByName('garden-full-stage-0')).toBeNull();
    for (let i = 0; i < 8; i++) scene.getMeshByName(`garden-stage-${i}`)!.dispose(false, false);
    create('new', 0, 7, true);
    expect(scene.meshes.filter(m => m.name.startsWith('garden-source-'))).toHaveLength(11);
    expect(scene.getMeshByName('garden-surface-new')!.receiveShadows).toBe(true);
    scene.dispose();
    expect(sources.every(m => m.isDisposed())).toBe(true);
  } finally { scene.dispose(); engine.dispose(); }
});
