import {vertexSurface,type TerrainVertex} from './terrain-vertices.js';
import {createSpawnTerrainField,spawnDelta,SPAWN_TERRACE_TOLERANCE,type SpawnSurface} from './spawn-map.js';
import {terraceHeight,type SpawnTerrace} from './spawn-installation.js';
import type {GeneratedLandscape} from './world-generator.js';
/** Current local edits over the signed substrate. Never lower the baseline used for later manual poses. */
export function editedRc1Field(data:GeneratedLandscape,base:ReturnType<typeof createSpawnTerrainField>,terraces:readonly SpawnTerrace[],removedIndices:readonly number[],vertices?:readonly TerrainVertex[]){
 const removed=new Set(removedIndices);
 const trees=new Map<string,Array<{x:number;y:number}>>();
 for(const [i,t] of (data.forest?.trees??[]).entries())if(!removed.has(i)){
  const key=Math.floor(t.x)+':'+Math.floor(t.y),bucket=trees.get(key)??[];bucket.push(t);trees.set(key,bucket);
 }
 const geometry=vertices ? vertexSurface({widthCells:data.width,heightCells:data.height},(x,y)=>base.sample(x,y).elevation,vertices) : undefined;
 const water=vertices ? vertexSurface({widthCells:data.width,heightCells:data.height},(x,y)=>Math.max(0,base.sample(x,y).surface),[]) : undefined;
 const sample=(x:number,y:number)=>{const value=base.sample(x,y);if(geometry)return {...value,elevation:geometry.sample(x,y),surface:water!.sample(x,y)};const height=terraceHeight(terraces,x,y,{widthCells:data.width,heightCells:data.height});return height===undefined?value:{...value,elevation:height};};
 // Navigation needs only the two affine surfaces. Sampling climate/geology at
 // every interior substep adds no information once the shared corners exist.
 const physicalSample=(x:number,y:number)=>geometry?{elevation:geometry.sample(x,y),surface:water!.sample(x,y)}:sample(x,y);
 const intersectsTree=(s:SpawnSurface)=>{
  for(let y=Math.floor(s.y-s.halfHeight);y<=Math.floor(s.y+s.halfHeight);y++)for(let x=Math.floor(s.x-s.halfWidth);x<=Math.floor(s.x+s.halfWidth);x++)
   if(trees.get(((x%data.width+data.width)%data.width)+':'+((y%data.height+data.height)%data.height))?.some(t=>Math.abs(spawnDelta(t.x,s.x,data.width))<=s.halfWidth&&Math.abs(spawnDelta(t.y,s.y,data.height))<=s.halfHeight))return true;
  return false;
 };
 const surfaceReason=(s:SpawnSurface,reference:number|null,resolution:number):'water'|'rock'|'relief'|null=>{
  if(base.intersectsRock(s))return 'rock';
  // A complete cell consists of two affine triangles. Their height and
  // ground-minus-water extrema are attained at these four shared corners.
  if(geometry&&Number.isInteger(s.x)&&Number.isInteger(s.y)&&s.halfWidth===.5&&s.halfHeight===.5)resolution=1;
  const nx=Math.max(1,Math.ceil(s.halfWidth*2/resolution)),ny=Math.max(1,Math.ceil(s.halfHeight*2/resolution));let relief=false;
  for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++){const v=physicalSample(s.x-s.halfWidth+x*2*s.halfWidth/nx,s.y-s.halfHeight+y*2*s.halfHeight/ny);
   if(v.elevation<=Math.max(0,v.surface)+1e-6)return 'water';if(reference!==null&&Math.abs(v.elevation-reference)>SPAWN_TERRACE_TOLERANCE+1e-6)relief=true;}
  return relief?'relief':null;
 };
 return {sample,physicalSample,surfaceReason,intersectsTree,intersectsRock:base.intersectsRock,geometry};
}
