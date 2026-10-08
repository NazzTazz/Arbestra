import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { expect,it } from 'vitest';
it('keeps the static instance lot bounds correct when the torus rotates',()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{const mesh=MeshBuilder.CreateBox('trees',{size:1},scene);
  mesh.thinInstanceSetBuffer('matrix',new Float32Array([...Matrix.Translation(3,0,0).asArray(),...Matrix.Translation(-3,0,0).asArray()]),16,true);
  mesh.rotation.y=Math.PI/2;mesh.computeWorldMatrix(true);
  const bounds=mesh.getBoundingInfo().boundingBox;
  expect(bounds.minimumWorld.z).toBeCloseTo(-3.5);expect(bounds.maximumWorld.z).toBeCloseTo(3.5);
  expect(bounds.minimumWorld.x).toBeCloseTo(-.5);expect(bounds.maximumWorld.x).toBeCloseTo(.5);
 }finally{scene.dispose();engine.dispose();}
});
