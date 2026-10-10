import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {clonePreviewMaterial} from './building-assets';
import {buildingPlan,recipeFor} from './building-plan';
import {it,expect,vi} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {AssetContainer} from '@babylonjs/core/assetContainer';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {InstancedMesh} from '@babylonjs/core/Meshes/instancedMesh';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Ray} from '@babylonjs/core/Culling/ray';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {bakedPlanKey,instantiateBakedBuilding,loadBakedBuilding} from './building-assets';
import {SceneLoader} from '@babylonjs/core/Loading/sceneLoader';
import {encodeBuildingAsset} from './building-asset-format';

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

it('caches three variants across replacements and never attaches a delayed variant to a removed building',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine),containers:AssetContainer[]=[];
  let release!:()=>void;
  const delayed=new Promise<void>(resolve=>{release=resolve;});
  const bytes=encodeBuildingAsset({meshes:[]});
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('-lod1-'))await delayed;
    return new Response(bytes.slice().buffer,{headers:{'content-encoding':'gzip'}});
  });
  vi.stubGlobal('fetch',fetcher);
  const loader=vi.spyOn(SceneLoader,'LoadAssetContainerAsync').mockImplementation(async()=>{
    const container=new AssetContainer(scene),root=new Mesh('template',scene),wall=MeshBuilder.CreateBox('wall',{},scene);
    wall.parent=root;container.meshes.push(root,wall);container.removeAllFromScene();containers.push(container);return container;
  });
  try{
    const first=new Mesh('removed',scene);first.metadata={siteId:'removed'};
    await loadBakedBuilding(first,'university-3-finished',true);
    expect(first.getChildMeshes().filter(m=>m.getTotalVertices())).toHaveLength(1);
    expect(first.metadata.lodAssetState).toBe('loading');
    first.dispose(false,false);release();
    await vi.waitFor(()=>expect(loader).toHaveBeenCalledTimes(3));
    expect(scene.meshes.some(m=>m.name.startsWith('removed-'))).toBe(false);
    for(let i=0;i<3;i++){
      const replacement=new Mesh('replacement',scene);replacement.metadata={siteId:'replacement'};
      await loadBakedBuilding(replacement,'university-3-finished',true);
      await vi.waitFor(()=>expect(replacement.metadata.lodAssetState).toBe('ready'));
      expect(replacement.getChildMeshes().filter(m=>m.getTotalVertices())).toHaveLength(3);
      expect(replacement.getChildMeshes().filter(m=>m.getTotalVertices()&&m.isEnabled())).toHaveLength(1);
      replacement.dispose(false,false);
    }
    expect(fetcher).toHaveBeenCalledTimes(3);expect(loader).toHaveBeenCalledTimes(3);
    const sources=containers.flatMap(c=>c.meshes);scene.dispose();
    await vi.waitFor(()=>expect(sources.every(m=>m.isDisposed())).toBe(true));
  }finally{release();scene.dispose();engine.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();}
});

it('keeps the detailed building usable when its optional distant asset fails',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine),container=new AssetContainer(scene);
  const root=new Mesh('template',scene),wall=MeshBuilder.CreateBox('wall',{},scene);wall.parent=root;
  container.meshes.push(root,wall);container.removeAllFromScene();
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('-lod1-')?new Response(null,{status:503}):
    new Response(encodeBuildingAsset({meshes:[]}).slice().buffer,{headers:{'content-encoding':'gzip'}})));
  vi.spyOn(SceneLoader,'LoadAssetContainerAsync').mockResolvedValue(container);
  const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
  try{
    const building=new Mesh('building',scene);building.metadata={siteId:'campus'};
    await loadBakedBuilding(building,'university-1-finished',true);
    await vi.waitFor(()=>expect(building.metadata.lodAssetState).toBe('error'));
    expect(warning).toHaveBeenCalledOnce();
    const instances=building.getChildMeshes().filter(m=>m.getTotalVertices());
    expect(instances).toHaveLength(1);expect(instances[0]!.isEnabled()).toBe(true);
    expect(instances[0]!.metadata.siteId).toBe('campus');
  }finally{scene.dispose();engine.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();}
});

it('allows a translucent construction clone without changing existing building instances',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),container=new AssetContainer(scene);
 try{const source=new Mesh('asset',scene),wall=MeshBuilder.CreateBox('wall',{},scene);wall.parent=source;wall.material=new StandardMaterial('wood',scene);container.meshes.push(source,wall);container.removeAllFromScene();
 const built=new Mesh('built',scene),preview=new Mesh('preview',scene);instantiateBakedBuilding(container,built);instantiateBakedBuilding(container,preview,true);
 const solid=built.getChildMeshes().find(m=>m.getTotalVertices())!,ghost=preview.getChildMeshes().find(m=>m.getTotalVertices())!;
 expect(solid).toBeInstanceOf(InstancedMesh);expect(ghost).not.toBeInstanceOf(InstancedMesh);
 const ghostMaterial=clonePreviewMaterial(wall.material as StandardMaterial);ghostMaterial.alpha=.58;ghost.material=ghostMaterial;
 expect(solid.material?.alpha).toBe(1);expect((ghost as Mesh).geometry).toBe(wall.geometry);
 preview.dispose(false,false);expect(solid.isDisposed()).toBe(false);
 }finally{scene.dispose();container.dispose();engine.dispose();}
});

it('uses the same recipe compatibility for the starter ghost and the confirmed hall',()=>{
 for(const face of ['+x','-x'] as const){const resolved=recipeFor({visualLayout:{recipe:'town-hall',version:1,quarterTurns:0,entranceFace:face,offset:[0,0]},level:1,targetLevel:null,status:'completed'})!;
 const plan=buildingPlan({id:'hall',anchor:{cellX:0,cellY:0},cells:[{cellX:0,cellY:0},{cellX:0,cellY:1}],world:{widthCells:512,heightCells:256},...resolved});
 expect(bakedPlanKey(plan)).toBe(face==='+x'?null:'town-hall-1-finished');expect(plan.entry.normal.x).toBe(face==='+x'?1:-1);}
});

it('shares ready source textures while keeping preview material changes private',()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{const source=new StandardMaterial('dynamic-recipe',scene),texture=new Texture(null,scene),copy=new Texture(null,scene);source.diffuseTexture=texture;
 const cloned=vi.spyOn(texture,'clone').mockReturnValue(copy),disposed=vi.spyOn(texture,'dispose'),copyDisposed=vi.spyOn(copy,'dispose');
 const preview=clonePreviewMaterial(source);
 expect(cloned).toHaveBeenCalled();expect(preview.diffuseTexture).toBe(texture);expect(copyDisposed).toHaveBeenCalledOnce();expect(disposed).not.toHaveBeenCalled();
 expect(source.alpha).toBe(1);expect(preview.alpha).toBe(.58);preview.dispose(false,false);expect(disposed).not.toHaveBeenCalled();
 }finally{scene.dispose();engine.dispose();}
});
