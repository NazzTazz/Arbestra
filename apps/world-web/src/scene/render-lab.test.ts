import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { RenderLab, meshFamily } from './render-lab';

it('groups meshes by name without their identifiers or indexes', () => {
  expect(meshFamily('brazier-light-12')).toBe('brazier-light');
  expect(meshFamily('garden-plot-4f1c2a9e-0b7d-4c3e-9a1b-2c3d4e5f6a7b')).toBe('garden-plot');
  expect(meshFamily('terrain:3:4')).toBe('terrain');
  expect(meshFamily('7')).toBe('(sans nom)');
});

it('hides a mesh family from the camera, including meshes created later, and restores it', async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const first = MeshBuilder.CreateBox('brazier-block-1', {}, scene),
      other = MeshBuilder.CreateBox('house-2', {}, scene);
    const lab = new RenderLab(scene);
    expect(lab.families().map((f) => f.family)).toEqual(expect.arrayContaining(['brazier-block', 'house']));
    lab.setFamilyHidden('brazier-block', true);
    const later = MeshBuilder.CreateBox('brazier-block-2', {}, scene);
    // Babylon announces a new mesh after its creation returns; the next frame hides it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect([first.layerMask, later.layerMask, other.layerMask]).toEqual([0, 0, 0x0fffffff]);
    expect(lab.families().find((f) => f.family === 'brazier-block')?.hidden).toBe(true);
    lab.setFamilyHidden('brazier-block', false);
    expect([first.layerMask, later.layerMask]).toEqual([0x0fffffff, 0x0fffffff]);
    lab.setSwitch('lightsEnabled', false);
    expect(lab.switches().lightsEnabled).toBe(false);
    expect(scene.lightsEnabled).toBe(false);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
