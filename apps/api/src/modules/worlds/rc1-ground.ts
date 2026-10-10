import {type Kysely} from 'kysely';
import {type GeneratedLandscape,type Rc1Ground,type Rc1FeatureGeometry,type SpawnTerrace} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {readRc1Source} from './rc1-source.js';
import {editedRc1Field} from '../onboarding/rc1-field.js';
const patches=new Map<string,Omit<Rc1Ground,'terraces'>>();
export async function readRc1Ground(db:Kysely<Database>,worldId:string){
 const source=await readRc1Source(db,worldId),{world}=source;
 const terraces=await db.selectFrom('worldSpawnTerraces').select(['cellX','cellY','height']).where('worldId','=',worldId).execute();
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
