import { worldRecipeChecksum } from './recipe-provenance.js';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';
import { artifactChecksum, readV2Artifact } from './artifact.js';
/** Fixture tool only. Both databases must be test targets, never an alpha-world mutation. */
export async function copyCandidateForRecipe(source:Kysely<Database>,target:Kysely<Database>,id:string,targetUrl:string){
  if(!new URL(targetUrl).pathname.endsWith('_test'))throw new Error('Recipe copy requires a test database');
  return source.transaction().setIsolationLevel('repeatable read').execute(async snapshot=>{
  const candidate=await snapshot.selectFrom('worldGenerationCandidates').selectAll().where('worldId','=',id).executeTakeFirstOrThrow();
  const world=await snapshot.selectFrom('worlds').selectAll().where('id','=',id).executeTakeFirstOrThrow();
  if(candidate.status!=='ready'||!candidate.artifact||artifactChecksum(candidate.artifact)!==candidate.checksum)throw new Error('Invalid source artifact');
  if(world.isOpen)throw new Error('Recipe source must remain closed');
  if(world.generationVersion!==2)throw new Error('Player recipe is only available for v2 until local v3 spawn exists');
  const signature=await worldRecipeChecksum(snapshot,id);
  if(candidate.artifact.provenance&&candidate.artifact.provenance.worldRecipeChecksum!==signature)throw new Error('Source recipe contents changed');
  const chunks=await snapshot.selectFrom('worldChunks').selectAll().where('worldId','=',id).execute();
  const clearings=await snapshot.selectFrom('worldClearings').selectAll().where('worldId','=',id).execute();
  const features=await snapshot.selectFrom('worldFeatures').selectAll().where('worldId','=',id).execute();
  const occupancies=await snapshot.selectFrom('worldCellOccupancies').selectAll().where('worldId','=',id).execute();
  const woods=await snapshot.selectFrom('woodlandDeposits').selectAll().where('worldId','=',id).execute();
  const stones=await snapshot.selectFrom('stoneDeposits').selectAll().where('worldId','=',id).execute();
  if(occupancies.some(o=>o.buildingId)||clearings.some(c=>c.claimedVillageId))throw new Error('Source candidate is inhabited');
  const copyId=randomUUID(),slug='recipe-'+copyId,ids=new Map(features.map(f=>[f.id,randomUUID()]));
  await target.transaction().execute(async tx=>{
    await tx.insertInto('worlds').values({id:copyId,slug,name:'Private recipe copy',topology:'torus',seed:world.seed,
      widthCells:world.widthCells,heightCells:world.heightCells,chunkSize:32,generationVersion:2,generationStatus:'ready',generatedAt:new Date(),isOpen:true}).execute();
    for(const c of chunks)await tx.insertInto('worldChunks').values({worldId:copyId,chunkX:c.chunkX,chunkY:c.chunkY,generationVersion:2,terrainCodes:c.terrainCodes,elevations:c.elevations}).execute();
    if(clearings.length)await tx.insertInto('worldClearings').values(clearings.map(c=>({id:randomUUID(),worldId:copyId,centerCellX:c.centerCellX,centerCellY:c.centerCellY,innerRadius:c.innerRadius,transitionRadius:c.transitionRadius,status:'protected' as const,claimedVillageId:null}))).execute();
    for(let offset=0;offset<features.length;offset+=500){
      const batch=features.slice(offset,offset+500),keys=new Set(batch.map(f=>f.id));
      await tx.insertInto('worldFeatures').values(batch.map(f=>({id:ids.get(f.id)!,worldId:copyId,featureTypeCode:f.featureTypeCode,state:f.state,variantSeed:f.variantSeed}))).execute();
      const cells=occupancies.filter(o=>o.featureId&&keys.has(o.featureId));
      if(cells.length)await tx.insertInto('worldCellOccupancies').values(cells.map(o=>({worldId:copyId,cellX:o.cellX,cellY:o.cellY,buildingId:null,featureId:ids.get(o.featureId!)!,role:o.role}))).execute();
      const copyWoods=woods.filter(d=>keys.has(d.featureId));
      if(copyWoods.length)await tx.insertInto('woodlandDeposits').values(copyWoods.map(d=>({worldId:copyId,featureId:ids.get(d.featureId)!,cellX:d.cellX,cellY:d.cellY,
        initialAmount:d.initialAmount,remainingAmount:d.remainingAmount,reservedAmount:d.reservedAmount,revision:1,regrowthPeriodMs:d.regrowthPeriodMs,
        regrowthUpdatedAt:d.regrowthUpdatedAt,updatedAt:new Date()}))).execute();
      const copyStones=stones.filter(d=>keys.has(d.featureId));
      if(copyStones.length)await tx.insertInto('stoneDeposits').values(copyStones.map(d=>({worldId:copyId,featureId:ids.get(d.featureId)!,cellX:d.cellX,cellY:d.cellY,
        initialAmount:d.initialAmount,remainingAmount:d.remainingAmount,reservedAmount:d.reservedAmount,revision:1,updatedAt:new Date()}))).execute();
    }
    if(artifactChecksum(await readV2Artifact(tx,copyId,Boolean(candidate.artifact!.provenance)))!==candidate.checksum)throw new Error('Copied artifact checksum mismatch');
    if(await worldRecipeChecksum(tx,copyId)!==signature)throw new Error('Copied world recipe checksum mismatch');
  });
  return {id:copyId,slug,checksum:candidate.checksum,worldRecipeChecksum:signature};
  });
}
