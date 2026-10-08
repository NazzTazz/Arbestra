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
import {instantiateBakedBuilding,loadBakedBuilding} from './building-assets';
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
