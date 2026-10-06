import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {AssetContainer} from '@babylonjs/core/assetContainer';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {InstancedMesh} from '@babylonjs/core/Meshes/instancedMesh';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Ray} from '@babylonjs/core/Culling/ray';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {instantiateBakedBuilding} from './building-assets';

it('shares building draws while picking the correct site after another instance is removed',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),container=new AssetContainer(scene);
  try{
    const template=new Mesh('asset',scene),wall=MeshBuilder.CreateBox('wall',{},scene),pane=MeshBuilder.CreatePlane('pane',{},scene);
    wall.parent=template;wall.material=new StandardMaterial('stone',scene);
    pane.parent=template;pane.position.z=.6;pane.metadata={buildingAttachment:'glass'};
    container.meshes.push(template,wall,pane);container.materials.push(wall.material);container.removeAllFromScene();
    const a=new Mesh('building-a',scene),b=new Mesh('building-b',scene);
    a.position.x=-3;b.position.x=3;a.metadata={siteId:'site-a'};b.metadata={siteId:'site-b'};
    instantiateBakedBuilding(container,a);instantiateBakedBuilding(container,b);
    const aw=a.getChildMeshes().find(m=>m.name.endsWith('-wall'))!,bw=b.getChildMeshes().find(m=>m.name.endsWith('-wall'))!;
    expect(aw).toBeInstanceOf(InstancedMesh);expect(bw).toBeInstanceOf(InstancedMesh);
    expect((aw as InstancedMesh).sourceMesh).toBe((bw as InstancedMesh).sourceMesh);
    expect(a.getChildMeshes().find(m=>m.name.endsWith('-pane'))!.isPickable).toBe(false);
    const pick=(x:number)=>{for(const mesh of scene.meshes)mesh.computeWorldMatrix(true);return scene.pickWithRay(new Ray(new Vector3(x,0,-5),Vector3.Forward()),m=>m.isPickable&&!!m.metadata?.siteId)?.pickedMesh?.metadata.siteId;};
    expect(pick(-3)).toBe('site-a');expect(pick(3)).toBe('site-b');
    a.dispose(false,false);
    expect(pick(-3)).toBeUndefined();expect(pick(3)).toBe('site-b');
    expect(bw.material).toBe(wall.material);expect(scene.customRenderTargets).toHaveLength(0);
  }finally{scene.dispose();container.dispose();engine.dispose();}
});
