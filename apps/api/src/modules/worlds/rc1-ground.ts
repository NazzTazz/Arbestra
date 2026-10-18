import { devTime, devTimeSync } from '../operations/dev-timing.js';
import {type Kysely} from 'kysely';
import {type TravelGround,type GeneratedLandscape,type Rc1Ground,type Rc1FeatureGeometry,type SpawnTerrace} from '@arbestra/contracts';
import {rc1NetworkGround,type Rc1NetworkEdits} from '../navigation/rc1-network-ground.js';
import type {Database} from '../../database/schema.js';
import {readRc1Source} from './rc1-source.js';
import {editedRc1Field} from '../onboarding/rc1-field.js';
type GroundGeometry={data:GeneratedLandscape;field:ReturnType<typeof editedRc1Field>;cell:(x:number,y:number)=>{code:number;elevation:number};patch:(x:number,y:number,size:number)=>Rc1Ground;terraces:SpawnTerrace[];navigation:TravelGround;navigationEdits:Rc1NetworkEdits};
const geometries=new Map<string,GroundGeometry>();
const MAX_GEOMETRIES=4,MAX_GEOMETRY_KEY=131_072;
const patches=new Map<string,{data:GeneratedLandscape;ground:Omit<Rc1Ground,'terraces'>}>();
export async function readRc1Ground(db:Kysely<Database>,worldId:string){
  return devTime('rc1_ground', async () => {
 const source=await readRc1Source(db,worldId),{world}=source;
 const vertices=world.terrainModel==='vertices'?await db.selectFrom('worldTerrainVertices').select(['vertexX','vertexY','height']).where('worldId','=',worldId).orderBy('vertexX').orderBy('vertexY').execute():undefined;
 // Current transactional edits are always read, even when their geometric
 // projection is reusable. No stock, permission or occupancy is cached.
 const terraces=await db.selectFrom('worldSpawnTerraces').select(['cellX','cellY','height']).where('worldId','=',worldId).orderBy('cellX').orderBy('cellY').execute();
 // Correlated LIMIT 1 preserves each unique world/feature lookup and uses
 // both index keys before PostgreSQL has statistics for a new world.
 const resourceEdits=await db.selectFrom('worldRc1Resources')
  .leftJoinLateral(eb=>eb.selectFrom('woodlandDeposits').select(['cleared','remainingAmount','initialAmount','cellX','cellY'])
   .whereRef('woodlandDeposits.worldId','=','worldRc1Resources.worldId').whereRef('woodlandDeposits.featureId','=','worldRc1Resources.featureId')
   .limit(1).as('woodlandDeposits'),j=>j.onTrue())
  .leftJoinLateral(eb=>eb.selectFrom('worldFeatures').select('variantSeed')
   .whereRef('worldFeatures.worldId','=','worldRc1Resources.worldId').whereRef('worldFeatures.id','=','worldRc1Resources.featureId')
   .limit(1).as('worldFeatures'),j=>j.onTrue())
  .select(['treeIndices','removedIndices','cleared','remainingAmount','initialAmount','woodlandDeposits.cellX','woodlandDeposits.cellY','variantSeed'])
  .where('worldRc1Resources.worldId','=',worldId).orderBy('worldRc1Resources.featureId').execute();
 const canonicalIndices=(indices:number[])=>[...new Set(indices)].sort((a,b)=>a-b);
 const removed=canonicalIndices(resourceEdits.flatMap(r=>r.cleared||r.remainingAmount!==null&&Number(r.remainingAmount)<=Number(r.initialAmount)*.1?r.treeIndices:r.removedIndices));
 // Full-grown trunks do not move with harvesting/regrowth. The collision
 // field separately retains the existing depleted-tree threshold above.
 const absent=canonicalIndices(resourceEdits.flatMap(r=>r.cleared?r.treeIndices:r.removedIndices));
 const groves=resourceEdits.filter(r=>!r.treeIndices.length&&r.cellX!==null&&r.cellY!==null&&!r.cleared);
 // woodlandTrees receives equal remaining/initial amounts for full growth;
 // only a zero amount changes that ratio. Positive quantities are irrelevant.
 const key=JSON.stringify([worldId,world.widthCells,world.heightCells,world.chunkSize,world.seed,vertices,terraces,removed,absent,
  groves.map(r=>[r.cellX,r.cellY,r.variantSeed??3,Number(r.initialAmount)===0?0:1])]);
 const prior=geometries.get(key);
 if(prior?.data===source.data){geometries.delete(key);geometries.set(key,prior);return prior;}
 const field=devTimeSync('rc1_field',()=>editedRc1Field(source.data,source.field,terraces,removed,vertices));
 const cell=(x:number,y:number)=>{const s=field.sample(x,y);return{code:s.elevation<=Math.max(0,s.surface)+1e-6?2:1,elevation:Math.round(s.elevation*100)};};
 const patch=(originX:number,originY:number,size:number):Rc1Ground=>{
  if(vertices){const stride=size+1,heights:number[]=[],water:number[]=[];for(let y=0;y<stride;y++)for(let x=0;x<stride;x++){const s=field.sample(originX-.5+x,originY-.5+y);heights.push(s.elevation);water.push(Math.max(0,s.surface));}return {model:'vertices',stride,heights,water,terraces:[]};}
  const patchKey=worldId+':'+world.widthCells+':'+world.heightCells+':'+originX+':'+originY+':'+size;
  let p=patches.get(patchKey);
  if(!p||p.data!==source.data){const stride=size*2+1,heights:number[]=[],water:number[]=[];for(let y=0;y<stride;y++)for(let x=0;x<stride;x++){const s=source.field.sample(originX-.5+x/2,originY-.5+y/2);heights.push(s.elevation);water.push(Math.max(0,s.surface));}p={data:source.data,ground:{stride,heights,water}};patches.set(patchKey,p);while(patches.size>32)patches.delete(patches.keys().next().value!);}
  return {...p.ground,terraces:terraces.filter(t=>t.cellX>=originX&&t.cellX<originX+size&&t.cellY>=originY&&t.cellY<originY+size)};
 };
 const navigationEdits:Rc1NetworkEdits={worldId,width:world.widthCells,height:world.heightCells,terraces,absent,...(vertices?{vertices}:{}),
  groves:groves.map(r=>({cellX:r.cellX!,cellY:r.cellY!,variantSeed:r.variantSeed??3,initialAmount:Number(r.initialAmount)}))};
 const navigation=rc1NetworkGround(source.data,source.field,navigationEdits,field);
 const geometry={data:source.data,field,cell,patch,terraces,navigation,navigationEdits};
 if(key.length<=MAX_GEOMETRY_KEY){geometries.delete(key);geometries.set(key,geometry);while(geometries.size>MAX_GEOMETRIES)geometries.delete(geometries.keys().next().value!);}
 return geometry;
  });
}
export async function rc1FeatureGeometry(db:Kysely<Database>,worldId:string,data:GeneratedLandscape,ids:string[],field?:GroundGeometry['field']):Promise<Map<string,Rc1FeatureGeometry>>{
  return devTime('rc1_geometry', async () => {
 if(!ids.length)return new Map();
 const rows=await db.selectFrom('worldRc1Resources').select(['featureId','sourceKey','treeIndices','removedIndices']).where('worldId','=',worldId).where('featureId','in',ids).execute();
 const grounded=<T extends {x:number;y:number;elevation:number}>(p:T):T=>field?.geometry?{...p,elevation:field.sample(p.x,p.y).elevation}:p;
 return new Map(rows.map(r=>{const removed=new Set(r.removedIndices);return[r.featureId,{trees:r.treeIndices.filter(i=>!removed.has(i)).map(i=>grounded(data.forest!.trees[i]!)),rocks:(r.sourceKey.startsWith('stone:')?data.stoneSites?.find(s=>String(s.id)===r.sourceKey.slice(6))?.rocks??[]:[]).map(grounded)}];}));
  });
}
export function rc1CellHeight(terraces:readonly SpawnTerrace[],x:number,y:number,fallback:number):number{return terraces.find(t=>t.cellX===x&&t.cellY===y)?.height??fallback;}
