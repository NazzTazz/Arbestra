import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { freezeStaticHierarchy, keepWorldMatrixDynamic, refreshStaticHierarchy } from './static-transforms';

it('keeps instance bounds and picking aligned after parent translation, rotation and a late LOD attachment', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const root = new TransformNode('building', scene);
    const source = MeshBuilder.CreateBox('template', {}, scene);
    source.isVisible = false;
    const wall = source.createInstance('wall');
    wall.parent = root;
    wall.position.x = 2;
    wall.metadata = { siteId: 'same-site' };
    freezeStaticHierarchy(root);
    let recalculated = 0;
    wall.onAfterWorldMatrixUpdateObservable.add(() => recalculated++);
    for (let i = 0; i < 30; i++) {
      scene.incrementRenderId();
      wall.computeWorldMatrix(true);
    }
    expect(recalculated).toBe(0);
    root.position.set(-80, 3, 40);
    root.rotation.y = Math.PI / 2;
    refreshStaticHierarchy(root);
    const centre = wall.getBoundingInfo().boundingSphere.centerWorld;
    expect(centre.x).toBeCloseTo(-80);
    expect(centre.y).toBeCloseTo(3);
    expect(centre.z).toBeCloseTo(38);
    expect(
      scene.pickWithRay(new Ray(new Vector3(-80, 10, 38), Vector3.Down()), (mesh) => mesh === wall)?.pickedMesh
        ?.metadata.siteId,
    ).toBe('same-site');
    const distant = source.createInstance('distant');
    distant.parent = root;
    distant.position.x = 2;
    refreshStaticHierarchy(root);
    wall.setEnabled(false);
    distant.setEnabled(true);
    expect(distant.isWorldMatrixFrozen).toBe(true);
    expect(distant.getBoundingInfo().boundingSphere.centerWorld.equalsWithEpsilon(centre)).toBe(true);
    expect(scene.pickWithRay(new Ray(new Vector3(-80, 10, 38), Vector3.Down()), (mesh) => mesh === distant)?.hit).toBe(
      true,
    );
    root.dispose();
    expect(wall.isDisposed()).toBe(true);
    expect(distant.isDisposed()).toBe(true);
    expect(source.isDisposed()).toBe(false);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it('preserves animated descendants and never freezes an unregistered preview', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const root = new TransformNode('clock', scene),
      pivot = new TransformNode('hand-pivot', scene);
    pivot.parent = root;
    keepWorldMatrixDynamic(pivot);
    const hand = MeshBuilder.CreateBox('hand', {}, scene);
    hand.parent = pivot;
    hand.position.y = 1;
    const preview = MeshBuilder.CreateBox('preview', {}, scene);
    refreshStaticHierarchy(preview);
    expect(preview.isWorldMatrixFrozen).toBe(false);
    freezeStaticHierarchy(root);
    expect(root.isWorldMatrixFrozen).toBe(true);
    expect(pivot.isWorldMatrixFrozen).toBe(false);
    expect(hand.isWorldMatrixFrozen).toBe(false);
    pivot.rotation.z = Math.PI / 2;
    root.position.x = 20;
    refreshStaticHierarchy(root);
    hand.computeWorldMatrix(true);
    expect(hand.getAbsolutePosition().x).toBeCloseTo(19);
    expect(hand.getAbsolutePosition().y).toBeCloseTo(0);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
