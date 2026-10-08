import { createHash } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../database/schema.js';
import { STARTER_VILLAGE } from '../onboarding/starter-village.js';
import { canonicalJSON } from './artifact.js';
/** Canonical world contents. IDs and administrative timestamps are deliberately excluded; economic clocks are included. */
export async function worldRecipeChecksum(db:Kysely<Database>|Transaction<Database>,worldId:string):Promise<string>{
  const world=await db.selectFrom('worlds').select(['topology','widthCells','heightCells','chunkSize','seed','generationVersion']).where('id','=',worldId).executeTakeFirstOrThrow();
  const chunks=await db.selectFrom('worldChunks').select(['chunkX','chunkY','generationVersion','terrainCodes','elevations']).where('worldId','=',worldId).execute();
  const clearings=await db.selectFrom('worldClearings').select(['centerCellX','centerCellY','innerRadius','transitionRadius','status']).where('worldId','=',worldId).execute();
  const features=await db.selectFrom('worldFeatures').select(['id','featureTypeCode','state','variantSeed']).where('worldId','=',worldId).execute();
  const occupancies=await db.selectFrom('worldCellOccupancies').select(['featureId','buildingId','cellX','cellY','role']).where('worldId','=',worldId).execute();
  const woods=await db.selectFrom('woodlandDeposits').select(['featureId','cellX','cellY','initialAmount','remainingAmount','reservedAmount','regrowthPeriodMs','regrowthUpdatedAt']).where('worldId','=',worldId).execute();
  const stones=await db.selectFrom('stoneDeposits').select(['featureId','cellX','cellY','initialAmount','remainingAmount','reservedAmount']).where('worldId','=',worldId).execute();
  if(occupancies.some(c=>c.buildingId))throw Error('Recipe signature requires an uninhabited source');
  const group=<T extends {featureId:string|null}>(rows:T[])=>{const map=new Map<string,T[]>();for(const row of rows){if(!row.featureId)continue;if(!map.has(row.featureId))map.set(row.featureId,[]);map.get(row.featureId)!.push(row);}return map;};
  const featureCells=group(occupancies),featureWoods=group(woods),featureStones=group(stones);
  const sorted=(items:unknown[])=>items.map(item=>JSON.parse(JSON.stringify(item)) as unknown).sort((a,b)=>{const left=canonicalJSON(a),right=canonicalJSON(b);return left<right?-1:left>right?1:0;});
  const content={world,chunks:sorted(chunks),clearings:sorted(clearings),starterTemplate:STARTER_VILLAGE,
    features:sorted(features.map(f=>({type:f.featureTypeCode,state:f.state,variantSeed:f.variantSeed,
      cells:sorted((featureCells.get(f.id)??[]).map(c=>({x:c.cellX,y:c.cellY,role:c.role}))),
      woods:sorted((featureWoods.get(f.id)??[]).map(d=>Object.fromEntries(Object.entries(d).filter(([key])=>key!=='featureId')))),
      stones:sorted((featureStones.get(f.id)??[]).map(d=>Object.fromEntries(Object.entries(d).filter(([key])=>key!=='featureId')))),
    })))};
  return createHash('sha256').update(canonicalJSON(content)).digest('hex');
}
