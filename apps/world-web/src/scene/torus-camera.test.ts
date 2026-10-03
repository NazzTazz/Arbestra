import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { attachSurfaceCamera, surfaceFrame, surfaceRadius, keepSurfaceCameraClear, blendDirection } from './torus-camera';
import { torusBlocksSegment } from './cosmology';

it('aligns to a surface normal without collapsing when starting opposite to it',()=>{
  const from=Vector3.Up(), to=from.negate();
  let last=-1;
  for(let i=0;i<=20;i++) {
    const direction=blendDirection(from,to,i/20), alignment=Vector3.Dot(direction,to);
    expect(direction.length()).toBeCloseTo(1); expect(alignment).toBeGreaterThanOrEqual(last-1e-8); last=alignment;
  }
  expect(last).toBeCloseTo(1);
});

it('enters along the normal and preserves the surface projection during torus rotation and manual orbit', () => {
  const engine = new NullEngine(), scene = new Scene(engine), root = new TransformNode('torus', scene);
  const camera = new ArcRotateCamera('camera', .5, .8, 8, Vector3.Zero(), scene);
  const world = { id: 'test', widthCells: 2048, heightCells: 1024, generationVersion: 1, chunkSize: 32 };
  try {
    for (const cell of [{ cellX: 1024, cellY: 512 }, { cellX: 2047, cellY: 0 }, { cellX: 300, cellY: 250 }]) {
      root.rotation.y = 0; root.computeWorldMatrix(true);
      const point = attachSurfaceCamera(camera, root, cell, world, .7, 1.15);
      camera.getViewMatrix(true);
      const direction = camera.position.subtract(point).normalize();
      expect(Vector3.Dot(direction, Vector3.FromArray([...surfaceFrame(cell, world).normal]))).toBeCloseTo(1, 6);
      camera.alpha += .3; camera.beta += .1; camera.getViewMatrix(true);
      const nearby = point.add(Vector3.FromArray([...surfaceFrame(cell, world).east]).scale(.1));
      const projected = () => Vector3.TransformCoordinates(Vector3.TransformCoordinates(nearby, root.computeWorldMatrix(true)), camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true)));
      const before = projected(), alpha = camera.alpha, beta = camera.beta, radius = camera.radius;
      root.rotation.y = 1.2;
      const after = projected();
      expect(Vector3.Distance(before, after)).toBeLessThan(1e-5);
      expect([camera.alpha, camera.beta, camera.radius]).toEqual([alpha, beta, radius]);
    }
  } finally { scene.dispose(); engine.dispose(); }
});

it('transfers scale and clears the opposite tube without moving the observed place', () => {
  const engine = new NullEngine(), scene = new Scene(engine), root = new TransformNode('torus', scene);
  const camera = new ArcRotateCamera('camera', .5, .8, 8, Vector3.Zero(), scene);
  const world = { id: 'test', widthCells: 2048, heightCells: 1024, generationVersion: 1, chunkSize: 32 };
  try {
    for (const cell of [{ cellX: 0, cellY: 0 }, { cellX: 1024, cellY: 512 }]) {
      expect(surfaceRadius(cell, world, 520, 1.3)).toBeCloseTo(surfaceRadius(cell, world, 260, 1.3) * 2);
      const normal = Vector3.FromArray([...surfaceFrame(cell, world).normal]);
      const anchor = attachSurfaceCamera(camera, root, cell, world, .7, .48);
      for (const radius of [.5, 1, 2, 3, 4, 6, 10, 15]) {
        camera.radius = radius; keepSurfaceCameraClear(camera, anchor, normal);
        expect(Vector3.Distance(camera.target, anchor)).toBeLessThan(1e-6);
        const origin = anchor.add(normal.scale(.02)), p = camera.position;
        expect(torusBlocksSegment([origin.x, origin.y, origin.z], [p.x, p.y, p.z])).toBe(false);
      }
    }
  } finally { scene.dispose(); engine.dispose(); }
});
