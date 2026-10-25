import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { selectEnabledCandidates } from './enabled-candidates';

it('offers only enabled meshes, including through a disabled parent, and still renders what is enabled', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    new FreeCamera('camera', new Vector3(0, 0, -10), scene).setTarget(Vector3.Zero());
    selectEnabledCandidates(scene);
    const shown = MeshBuilder.CreateBox('shown', {}, scene),
      lod = MeshBuilder.CreateBox('inactive-lod', {}, scene),
      chunk = new TransformNode('hidden-chunk', scene),
      tile = MeshBuilder.CreateBox('tile', {}, scene);
    tile.parent = chunk;
    lod.setEnabled(false);
    chunk.setEnabled(false);
    const names = () => {
      const c = scene.getActiveMeshCandidates();
      return Array.from({ length: c.length }, (_, i) => c.data[i]!.name);
    };
    expect(names()).toEqual(['shown']);
    scene.render();
    expect(scene.getActiveMeshes().data.slice(0, scene.getActiveMeshes().length)).toEqual([shown]);
    // A LOD switch or a revealed chunk is a candidate again on the next evaluation.
    lod.setEnabled(true);
    chunk.setEnabled(true);
    expect(names()).toEqual(['shown', 'inactive-lod', 'tile']);
    scene.render();
    expect(scene.getActiveMeshes().length).toBe(3);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
