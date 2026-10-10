import '@babylonjs/core/Loading/Plugins/babylonFileLoader';
import {SceneLoader} from '@babylonjs/core/Loading/sceneLoader';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {InstancedMesh} from '@babylonjs/core/Meshes/instancedMesh';
import {Geometry} from '@babylonjs/core/Meshes/geometry';
import {decodeBuildingAsset} from './building-asset-format';
import type {Scene} from '@babylonjs/core/scene';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import {attachFrostedGlass} from './frosted-glass';
import manifestJson from './building-assets-manifest.json';
import {coordinateBuildingLod} from './building-lod';

export const buildingAssets:Record<string,{url:string;bytes:number;thumbnail?:string}>=manifestJson;
const scenes=new WeakMap<Scene,Map<string,Promise<AssetContainer>>>();

/** Native instances retain individual transforms, culling and picking, sharing each material draw. */
export function instantiateBakedBuilding(container:AssetContainer,parent:Mesh,cloneMeshes=false){
  for(const source of container.meshes){
    source.receiveShadows=true;
    if(source.metadata?.buildingAttachment==='glass'&&source instanceof Mesh)attachFrostedGlass(source);
    // Babylon resolves an instance's lights through its source. Keep sources registered
    // for lighting changes, but never draw/pick the template itself.
    if(source.getTotalVertices()>0){source.isVisible=false;source.isPickable=false;
      if(!parent.getScene().meshes.includes(source))parent.getScene().addMesh(source);
    }
  }
  const model=container.instantiateModelsToScene(name=>`${parent.name}-${name}`,false,{doNotInstantiate:cloneMeshes});
  for(const node of model.rootNodes){node.parent=parent;for(const mesh of node.getChildMeshes()){
    const source=mesh instanceof InstancedMesh?mesh.sourceMesh:mesh;
    mesh.metadata={...source.metadata,...parent.metadata};
    mesh.isPickable=source.metadata?.buildingAttachment!=='glass'&&parent.isPickable;
    mesh.isVisible=true;
  }}
  return model;
}

/** One download/geometry allocation per recipe per scene. Instances share geometry/materials. */
async function bakedContainer(scene:Scene,key:string):Promise<AssetContainer> {
  const asset=buildingAssets[key];if(!asset)throw new Error(`Missing building asset: ${key}`);
  let cache=scenes.get(scene);
  if(!cache){cache=new Map();scenes.set(scene,cache);scene.onDisposeObservable.addOnce(()=>{for(const promise of cache!.values())void promise.then(c=>c.dispose(),()=>{});cache!.clear();});}
  let promise=cache.get(key);
  if(!promise){
    promise=(async()=>{
      const response=await fetch(asset.url,{cache:'force-cache'});if(!response.ok)throw new Error(`Building asset HTTP ${response.status}`);
      // Static hosts may decode Content-Encoding themselves; do not decompress twice.
      const buffer=response.headers.get('content-encoding')?.includes('gzip')?await response.arrayBuffer():await new Response(response.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const source=decodeBuildingAsset(buffer);
      if(scene.isDisposed)throw new Error('Building scene disposed');
      const geometries=(source.geometries?.vertexData??[]).map(data=>Geometry.Parse(data,scene,''));
      source.geometries={vertexData:[]};
      try {
        const container=await SceneLoader.LoadAssetContainerAsync('',`data:${JSON.stringify(source)}`,scene,undefined,'.babylon');
        for(const geometry of geometries)if(geometry){if(!container.geometries.includes(geometry))container.geometries.push(geometry);scene.removeGeometry(geometry);}
        return container;
      }catch(error){for(const geometry of geometries)geometry?.dispose();throw error;}
    })();
    cache.set(key,promise);void promise.catch(()=>cache!.delete(key));
  }
  return promise;
}

export async function loadBakedBuilding(parent:Mesh,key:string,withLod=false,cloneMeshes=false):Promise<void> {
  const scene=parent.getScene();
  const container=await bakedContainer(scene,key);if(parent.isDisposed()||scene.isDisposed)return;
  const detailed=instantiateBakedBuilding(container,parent,cloneMeshes);
  // The detailed model becomes usable immediately. A failed/delayed optional variant
  // neither blocks the building nor causes the detailed model to be instantiated twice.
  if(withLod&&buildingAssets[`${key}-lod1`]){
    parent.metadata={...parent.metadata,lodAssetState:'loading'};
    const keys=[`${key}-lod1`,`${key}-lod2`].filter(variant=>buildingAssets[variant]);
    void Promise.all(keys.map(variant=>bakedContainer(scene,variant))).then(containers=>{
      if(parent.isDisposed()||scene.isDisposed)return;
      const variants=containers.map(coarse=>instantiateBakedBuilding(coarse,parent));
      coordinateBuildingLod(parent,detailed.rootNodes,variants.at(-1)!.rootNodes,variants.length===2?variants[0]!.rootNodes:undefined);
      parent.metadata={...parent.metadata,lodAssetState:'ready'};
    }).catch(error=>{
      if(parent.isDisposed()||scene.isDisposed)return;
      parent.metadata={...parent.metadata,lodAssetState:'error'};
      console.warn('Distant building asset unavailable; keeping detailed model',key,error);
    });
  }
}
