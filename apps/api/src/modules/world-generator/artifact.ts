import { worldRecipeChecksum } from './recipe-provenance.js';
import { createHash } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { landscapeMetrics, type GeneratedLandscape } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
export function canonicalJSON(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function artifactChecksum(data:GeneratedLandscape):string{
  return createHash('sha256').update(canonicalJSON(data)).digest('hex');
}
export async function readV2Artifact(db:Kysely<Database>|Transaction<Database>,worldId:string,includeProvenance=true):Promise<GeneratedLandscape>{
  const world=await db.selectFrom('worlds').selectAll().where('id','=',worldId).executeTakeFirstOrThrow();
  const n=world.widthCells*world.heightCells, data:Omit<GeneratedLandscape,'metrics'>={
    version:2,width:world.widthCells,height:world.heightCells,seed:Number(world.seed),altitudeCellRatio:.025,
    terrainCodes:new Array(n).fill(0),elevations:new Array(n).fill(0),woodland:new Array(n).fill(0),
    exposure:new Array(n).fill(0),humidity:new Array(n).fill(0),walkable:new Array(n).fill(0),components:new Array(n).fill(-1),stairs:[],
  };
  const chunks=await db.selectFrom('worldChunks').selectAll().where('worldId','=',worldId).orderBy('chunkY').orderBy('chunkX').execute();
  for(const c of chunks)for(let y=0;y<32;y++)for(let x=0;x<32;x++){
    const i=(c.chunkY*32+y)*data.width+c.chunkX*32+x,j=y*32+x;
    data.terrainCodes[i]=c.terrainCodes[j]!;data.elevations[i]=c.elevations[j]!;
  }
  const features=await db.selectFrom('worldCellOccupancies').innerJoin('worldFeatures',join=>join.onRef('worldFeatures.id','=','worldCellOccupancies.featureId').onRef('worldFeatures.worldId','=','worldCellOccupancies.worldId'))
    .select(['cellX','cellY','featureTypeCode']).where('worldCellOccupancies.worldId','=',worldId).execute();
  for(const f of features)if(f.featureTypeCode==='woodland')data.woodland[f.cellY*data.width+f.cellX]=1;
  for(let i=0;i<n;i++)data.walkable[i]=data.terrainCodes[i]===1&&!data.woodland[i]?1:0;
  const metrics=landscapeMetrics(data);
  if(!includeProvenance){delete metrics.landsWithoutAccess;metrics.isolatedZones=Math.max(0,metrics.accessibleComponents-metrics.landComponents);}
  metrics.warnings=['Legacy v2: current terrain recipe; climate and natural stairs are not applied.'];
  return {...data,metrics,...(includeProvenance?{provenance:{version:1 as const,worldRecipeChecksum:await worldRecipeChecksum(db,worldId)}}:{})};
}
export async function writeV3Chunks(tx:Transaction<Database>,id:string,data:GeneratedLandscape){
  for(let cy=0;cy<data.height/32;cy++)for(let cx=0;cx<data.width/32;cx++){
    const terrainCodes:number[]=[],elevations:number[]=[];
    for(let y=0;y<32;y++)for(let x=0;x<32;x++){const i=(cy*32+y)*data.width+cx*32+x;terrainCodes.push(data.terrainCodes[i]!);elevations.push(data.elevations[i]!);}
    await tx.insertInto('worldChunks').values({worldId:id,chunkX:cx,chunkY:cy,generationVersion:3,terrainCodes,elevations}).execute();
  }
}
