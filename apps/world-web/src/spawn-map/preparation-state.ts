import type {TerrainResponse,SpawnMap,SpawnPoint,VillageState} from '@arbestra/contracts';
/** A local render snapshot, never a persisted village or an economy. */
export function preparationState(terrain:TerrainResponse,map:SpawnMap,point:SpawnPoint,name:string):VillageState {
 const chunk=terrain.chunks[0]!,size=terrain.world.chunkSize,now=new Date().toISOString();
 const interior=(values:number[])=>Array.from({length:size*size},(_,i)=>values[(Math.floor(i/size)+1)*(size+2)+i%size+1]!);
 return {serverTime:now,world:{...terrain.world,name:map.worldName,slug:map.worldSlug,topology:'torus',seed:String(map.landscape.seed)},
  village:{id:'00000000-0000-0000-0000-000000000000',name:name||'Votre village',anchorCellX:point.x,anchorCellY:point.y,resources:[],wood:0,carrots:0,woodProductionPerHour:0,woodProductionUpdatedAt:now,
   population:{total:0,housingCapacity:0,available:0,working:0,resting:0,energyCounts:Array(11).fill(0)},accomplishments:[],extractions:[],worksites:[]},
  buildingTypes:[],travelRoutes:[],cells:[],region:{originCellX:chunk.originCellX,originCellY:chunk.originCellY,width:size,height:size,terrainCodes:interior(chunk.terrainCodes),elevations:interior(chunk.elevations),features:terrain.chunks.flatMap(c=>c.features)}};
}
