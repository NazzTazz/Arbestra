import '@babylonjs/core/Loading/Plugins/babylonFileLoader';
import {SceneLoader} from '@babylonjs/core/Loading/sceneLoader';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {Geometry} from '@babylonjs/core/Meshes/geometry';
import {decodeBuildingAsset} from './building-asset-format';
import type {Scene} from '@babylonjs/core/scene';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import {attachFrostedGlass} from './frosted-glass';
import manifestJson from './building-assets-manifest.json';

export const buildingAssets:Record<string,{url:string;bytes:number;thumbnail?:string}>=manifestJson;
const scenes=new WeakMap<Scene,Map<string,Promise<AssetContainer>>>();

/** One download/geometry allocation per recipe per scene. Instances share geometry/materials. */
export async function loadBakedBuilding(parent:Mesh,key:string):Promise<void> {
  const asset=buildingAssets[key];if(!asset)throw new Error(`Missing building asset: ${key}`);
  const scene=parent.getScene();let cache=scenes.get(scene);
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
  const container=await promise;if(parent.isDisposed()||scene.isDisposed)return;
  const instance=container.instantiateModelsToScene(name=>`${parent.name}-${name}`,false,{doNotInstantiate:true});
  for(const node of instance.rootNodes){node.parent=parent;for(const mesh of node.getChildMeshes()){
    mesh.receiveShadows=true;mesh.metadata={...mesh.metadata,...parent.metadata};
    if(mesh.metadata?.buildingAttachment==='glass'&&mesh instanceof Mesh)attachFrostedGlass(mesh);
  }}
}
