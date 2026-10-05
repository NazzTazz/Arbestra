import { expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import { bindBrazierLights, brazierBlocks, roadCorners } from './village-braziers';
import type { TravelRoute } from '@arbestra/contracts';

it('registers clustered light shaders before the first night frame', () => {
  expect(ShaderStore.ShadersStore.lightProxyVertexShader).toContain('gl_Position');
  expect(ShaderStore.ShadersStore.lightProxyPixelShader).toContain('void main');
});

it('preserves unchanged light bindings and material readiness, but follows moving objects', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const mesh = MeshBuilder.CreateBox('house', {}, scene);
    const material = new StandardMaterial('stone', scene);
    mesh.material = material; material.freeze(); mesh.computeWorldMatrix(true);
    const light = new PointLight('fire', Vector3.Zero(), scene);
    const unfreeze = vi.spyOn(material, 'unfreeze');
    bindBrazierLights([light], [mesh]);
    const bindings = light.includedOnlyMeshes;
    const enabled = vi.spyOn(light, 'setEnabled');
    for (let i = 0; i < 10; i++) bindBrazierLights([light], [mesh]);
    expect(light.includedOnlyMeshes).toBe(bindings);
    expect(unfreeze).toHaveBeenCalledTimes(1);
    expect(enabled).not.toHaveBeenCalled();
    mesh.position.x = 20; mesh.computeWorldMatrix(true);
    bindBrazierLights([light], [mesh]);
    expect(light.isEnabled()).toBe(false);
    mesh.position.x = 0; mesh.computeWorldMatrix(true);
    bindBrazierLights([light], [mesh]);
    expect(light.isEnabled()).toBe(true);
    expect(light.includedOnlyMeshes).toHaveLength(1);
    expect(light.includedOnlyMeshes[0]).toBe(mesh);
  } finally { scene.dispose(); engine.dispose(); }
});

it('finds bends and intersections once, but not straight sections or endpoints across a toric seam',()=>{
  const cells=[{cellX:63,cellY:2},{cellX:0,cellY:2},{cellX:1,cellY:2},{cellX:1,cellY:3}];
  const route: TravelRoute={id:'a',kind:'building',cells,destination:cells[3]!};
  expect(roadCorners([route],64,64)).toEqual([cells[2]]);
  const branch: TravelRoute={id:'b',kind:'stone',cells:[cells[1]!,{cellX:0,cellY:1}],destination:{cellX:0,cellY:1}};
  expect(roadCorners([route,route,branch],64,64)).toEqual([cells[1],cells[2]]);
});
it('builds two courses of four blocks with reversed joints and an open centre',()=>{
  const blocks=brazierBlocks(); expect(blocks).toHaveLength(8);
  for(let i=0;i<4;i++) {
    expect(blocks[i]!.y).toBe(.5); expect(blocks[i+4]!.y).toBe(1.5);
    expect(blocks[i+4]!.x).toBeCloseTo(-blocks[i]!.x);
    expect(blocks[i+4]!.z).toBeCloseTo(blocks[i]!.z);
    expect(Math.max(Math.abs(blocks[i]!.x),Math.abs(blocks[i]!.z))).toBeCloseTo(1.5);
  }
});
