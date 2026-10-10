import {createSpawnSurfaceIndex,planSpawnCleaning,spawnSurfacesAt,starterElementSurfaces,type StarterElement,type SpawnPoint,type SpawnCleaningPlan,type SpawnMap} from '@arbestra/contracts';
import {editedRc1Field} from './rc1-field.js';
import type {createSpawnTerrainField} from '@arbestra/contracts';
import type {SpawnSnapshot} from './spawn-compute-protocol.js';
export interface ElementInput {element:StarterElement;point:SpawnPoint;quarterTurns:number;referenceHeight:number}
export interface ElementPlan {valid:boolean;cleaning:SpawnCleaningPlan}
export function planElement(map:SpawnMap,input:ElementInput,spatial:SpawnSnapshot['spatial'],base:ReturnType<typeof createSpawnTerrainField>):ElementPlan{
 const field=editedRc1Field(map.landscape,base,map.terraces??[],map.removedTreeIndices??[]),surfaces=starterElementSurfaces(input.element,false);
 const occupied=createSpawnSurfaceIndex(spatial.protectedSurfaces,512,256);
 const valid=spawnSurfacesAt(surfaces,input.point,input.quarterTurns).every(s=>!occupied(s)&&!field.surfaceReason(s,input.referenceHeight,.125));
 const cleaning=planSpawnCleaning(map.landscape,input.point,surfaces,input.quarterTurns,field);cleaning.referenceHeight=input.referenceHeight;
 return {valid,cleaning};
}
