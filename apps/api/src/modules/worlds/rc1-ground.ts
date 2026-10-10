import {sql,type Kysely} from 'kysely';
import {RC1_WORLD,createSpawnTerrainField,type GeneratedLandscape,type Rc1Ground,type Rc1FeatureGeometry,type SpawnTerrace} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {HttpError} from '../../errors.js';
import {artifactChecksum} from '../world-generator/artifact.js';
import {RC1_CANONICAL_CHECKSUM} from '../onboarding/spawn-compute-protocol.js';
import {editedRc1Field} from '../onboarding/rc1-field.js';
let cached:{json:string;data:GeneratedLandscape;field:ReturnType<typeof createSpawnTerrainField>}|undefined;
const patches=new Map<string,Omit<Rc1Ground,'terraces'>>();
export async function readRc1Ground(db:Kysely<Database>,worldId:string){
 const world=await db.selectFrom('worlds').select(['widthCells','heightCells','chunkSize','seed']).where('id','=',worldId).executeTakeFirstOrThrow();
 if(world.widthCells!==RC1_WORLD.widthCells||world.heightCells!==RC1_WORLD.heightCells||world.chunkSize!==RC1_WORLD.chunkSize)throw new HttpError(409,'WORLD_NOT_READY','Dimensions RC1 incohérentes.');
 const row=await db.selectFrom('worldGenerationCandidates').select(['checksum',sql<string>`artifact::text`.as('json')]).where('worldId','=',worldId).executeTakeFirst();
 if(!row||row.checksum!==RC1_CANONICAL_CHECKSUM)throw new HttpError(409,'WORLD_NOT_READY','Géographie RC1 indisponible.');
 if(cached?.json!==row.json){const data=JSON.parse(row.json) as GeneratedLandscape;if(artifactChecksum(data)!==RC1_CANONICAL_CHECKSUM)throw new HttpError(409,'WORLD_NOT_READY','Géographie RC1 invalide.');cached={json:row.json,data,field:createSpawnTerrainField(data)};patches.clear();}
 const terraces=await db.selectFrom('worldSpawnTerraces').select(['cellX','cellY','height']).where('worldId','=',worldId).execute();
 const source=cached;
 if(Number(world.seed)!==source.data.seed)throw new HttpError(409,'WORLD_NOT_READY','Identité RC1 incohérente.');
 const resourceEdits=await db.selectFrom('worldRc1Resources').leftJoin('woodlandDeposits',j=>j.onRef('woodlandDeposits.worldId','=','worldRc1Resources.worldId').onRef('woodlandDeposits.featureId','=','worldRc1Resources.featureId')).select(['treeIndices','removedIndices','cleared','remainingAmount','initialAmount']).where('worldRc1Resources.worldId','=',worldId).execute();
 const removed=resourceEdits.flatMap(r=>r.cleared||r.remainingAmount!==null&&Number(r.remainingAmount)<=Number(r.initialAmount)*.1?r.treeIndices:r.removedIndices);
 const field=editedRc1Field(source.data,source.field,terraces,removed);
 const cell=(x:number,y:number)=>{const s=field.sample(x,y);return{code:s.elevation<=Math.max(0,s.surface)+1e-6?2:1,elevation:Math.round(s.elevation*100)};};
 const patch=(originX:number,originY:number,size:number):Rc1Ground=>{
  const key=originX+':'+originY+':'+size;let p=patches.get(key);
  if(!p){const stride=size*2+1,heights:number[]=[],water:number[]=[];for(let y=0;y<stride;y++)for(let x=0;x<stride;x++){const s=source.field.sample(originX-.5+x/2,originY-.5+y/2);heights.push(s.elevation);water.push(Math.max(0,s.surface));}p={stride,heights,water};patches.set(key,p);while(patches.size>32)patches.delete(patches.keys().next().value!);}
  return {...p,terraces:terraces.filter(t=>t.cellX>=originX&&t.cellX<originX+size&&t.cellY>=originY&&t.cellY<originY+size)};
 };
 const walkSamples=new Map<string,{elevation:number;dry:boolean;blocked:boolean}>();
 const navigation={width:world.widthCells,height:world.heightCells,revision:worldId+':'+JSON.stringify(terraces),sample(x:number,y:number){const key=x+':'+y,prior=walkSamples.get(key);if(prior)return prior;const v=field.sample(x,y),result={elevation:v.elevation,dry:v.elevation>Math.max(0,v.surface)+1e-6,blocked:field.intersectsRock({x,y,halfWidth:0,halfHeight:0})};walkSamples.set(key,result);return result;}};
 return {data:source.data,field,cell,patch,terraces,navigation};
}
export async function rc1FeatureGeometry(db:Kysely<Database>,worldId:string,data:GeneratedLandscape,ids:string[]):Promise<Map<string,Rc1FeatureGeometry>>{
 if(!ids.length)return new Map();
 const rows=await db.selectFrom('worldRc1Resources').select(['featureId','sourceKey','treeIndices','removedIndices']).where('worldId','=',worldId).where('featureId','in',ids).execute();
 return new Map(rows.map(r=>{const removed=new Set(r.removedIndices);return[r.featureId,{trees:r.treeIndices.filter(i=>!removed.has(i)).map(i=>data.forest!.trees[i]!),rocks:r.sourceKey.startsWith('stone:')?data.stoneSites?.find(s=>String(s.id)===r.sourceKey.slice(6))?.rocks??[]:[]}];}));
}
export function rc1CellHeight(terraces:readonly SpawnTerrace[],x:number,y:number,fallback:number):number{return terraces.find(t=>t.cellX===x&&t.cellY===y)?.height??fallback;}
