import {createSpawnSurfaceIndex,createSpawnTerrainField,editedRc1Field,createSpawnTerrainInspector,starterElementSurfaces,spawnSurfacesAt,type SpawnMap,type StarterElement,type SpawnPoint} from '@arbestra/contracts';
let map:SpawnMap,field:ReturnType<typeof editedRc1Field>;
self.onmessage=(event:MessageEvent<{kind:'init';map:SpawnMap}|{kind:'inspect';sequence:number;point:SpawnPoint;turns:number;elements:StarterElement[];grouped:boolean;referenceHeight?:number;occupied:Array<{cellX:number;cellY:number}>}>)=>{
 const m=event.data;if(m.kind==='init'){map=m.map;field=editedRc1Field(map.landscape,createSpawnTerrainField(map.landscape),map.terraces??[],map.removedTreeIndices??[]);self.postMessage({ready:true});return;}
 if(!field)return;
 const surfaces=m.elements.flatMap(e=>starterElementSurfaces(e,m.grouped)),posed=spawnSurfacesAt(surfaces,m.point,m.turns),protectedSurfaces=m.occupied.map(c=>({x:c.cellX,y:c.cellY,halfWidth:.5,halfHeight:.5}));
 const result=createSpawnTerrainInspector(map.landscape,field)(m.point,surfaces,m.turns,m.grouped?map.villages:[],false,protectedSurfaces,m.grouped?map.territories:[]);
 const blocked=createSpawnSurfaceIndex(protectedSurfaces,512,256);
 const valid=m.grouped?result.terrainCompatible:posed.every(s=>!blocked(s)&&!field.surfaceReason(s,m.referenceHeight!,.125));
 self.postMessage({sequence:m.sequence,valid,referenceHeight:m.referenceHeight??result.referenceHeight});
};
