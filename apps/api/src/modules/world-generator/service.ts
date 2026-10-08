import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { LANDSCAPE_RECIPE_REVISION, type GeneratedLandscape, type GenerateCandidate, type WorldCandidate } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import type { AppConfig } from '../../config.js';
import { HttpError } from '../../errors.js';
import { generatorSettings } from './settings.js';
import { worldRecipeChecksum } from './recipe-provenance.js';
import { artifactChecksum, canonicalJSON } from './artifact.js';
export async function listCandidates(db:Kysely<Database>):Promise<WorldCandidate[]>{
  const rows=await db.selectFrom('worldGenerationCandidates').innerJoin('worlds','worlds.id','worldGenerationCandidates.worldId')
    .select(['worldId','name','seed','widthCells','heightCells','generationVersion','parameters','status','attempt','revision','recipeRevision','checksum','error',
      'retainedAt','isOpen','worldGenerationCandidates.createdAt','heartbeatAt','durationMs','metrics']).orderBy('worldGenerationCandidates.createdAt','desc').execute();
  return rows.map(r=>({id:r.worldId,name:r.name,seed:Number(r.seed),width:r.widthCells,height:r.heightCells,version:r.generationVersion as 2|3,
    parameters:r.parameters,recipeRevision:r.recipeRevision,status:r.status,attempt:r.attempt,revision:r.revision,checksum:r.checksum,error:r.error,
    retained:Boolean(r.retainedAt),opened:r.isOpen,createdAt:r.createdAt.toISOString(),heartbeatAt:r.heartbeatAt?.toISOString()??null,
    durationMs:r.durationMs,metrics:r.metrics}));
}
export async function createCandidate(db:Kysely<Database>,config:AppConfig,accountId:string,input:GenerateCandidate){
  const settings=generatorSettings(config);
  if(input.width*input.height>settings.maxCells)throw new HttpError(400,'GENERATOR_SIZE_LIMIT','Taille du candidat trop grande.');
  const id=await db.transaction().execute(async tx=>{
    await sql`select pg_advisory_xact_lock(hashtextextended('world-generator-requests',0))`.execute(tx);
    const previous=await tx.selectFrom('worldGenerationCandidates').innerJoin('worlds','worlds.id','worldGenerationCandidates.worldId')
      .select(['worldId','ownerAccountId','parameters','seed','widthCells','heightCells','generationVersion','name']).where('commandId','=',input.commandId).executeTakeFirst();
    if(previous){
      if(previous.ownerAccountId!==accountId||canonicalJSON(previous.parameters)!==canonicalJSON(input.parameters)
        ||Number(previous.seed)!==input.seed||previous.widthCells!==input.width||previous.heightCells!==input.height
        ||previous.generationVersion!==input.version||previous.name!==input.name.trim())throw new HttpError(409,'COMMAND_CONFLICT','Cette demande existe avec un autre contenu.');
      return previous.worldId;
    }
    const id=randomUUID();
    await tx.insertInto('worlds').values({id,slug:'candidate-'+id,name:input.name.trim(),topology:'torus',
      widthCells:input.width,heightCells:input.height,chunkSize:32,seed:input.seed,generationVersion:input.version,
      generationStatus:'pending',generatedAt:null,isOpen:false}).execute();
    await tx.insertInto('worldGenerationCandidates').values({worldId:id,commandId:input.commandId,ownerAccountId:accountId,parameters:input.parameters,recipeRevision:input.version===3?LANDSCAPE_RECIPE_REVISION:0}).execute();
    return id;
  });
  return (await listCandidates(db)).find(c=>c.id===id)!;
}
export async function candidateArtifact(db:Kysely<Database>,id:string):Promise<GeneratedLandscape>{
  const row=await db.selectFrom('worldGenerationCandidates').select(['status','artifact']).where('worldId','=',id).executeTakeFirst();
  if(!row||row.status!=='ready'||!row.artifact)throw new HttpError(409,'CANDIDATE_NOT_READY','Le candidat n’est pas encore prêt.');
  return row.artifact;
}
export async function candidateAction(db:Kysely<Database>,id:string,action:'retain'|'open',identity:{checksum:string;revision:number}){
  await db.transaction().execute(async tx=>{
    const row=await tx.selectFrom('worldGenerationCandidates').innerJoin('worlds','worlds.id','worldGenerationCandidates.worldId')
      .selectAll().where('worldId','=',id).forUpdate().executeTakeFirst();
    if(!row||row.status!=='ready'||row.checksum!==identity.checksum||row.revision!==identity.revision||!row.artifact
      ||artifactChecksum(row.artifact)!==row.checksum)throw new HttpError(409,'CANDIDATE_CHANGED','Identité ou checksum du candidat incorrect.');
    if(action==='retain'){
      await tx.updateTable('worldGenerationCandidates').set({retainedAt:sql`coalesce(retained_at,statement_timestamp())`}).where('worldId','=',id).execute();
    }else{
      if(row.artifact.provenance&&row.artifact.provenance.worldRecipeChecksum!==await worldRecipeChecksum(tx,id))throw new HttpError(409,'CANDIDATE_CHANGED','Le contenu du monde a changé depuis sa recette.');
      if(!row.retainedAt)throw new HttpError(409,'CANDIDATE_NOT_RETAINED','Conserve ce candidat avant de l’ouvrir.');
      if(row.generationVersion!==2)throw new HttpError(409,'V3_NOT_OPENABLE','Le spawn et les accès géographiques v3 doivent être qualifiés avant ouverture.');
      const free=await tx.selectFrom('worldClearings').select('id').where('worldId','=',id).where('status','=','protected').where('claimedVillageId','is',null).executeTakeFirst();
      if(!free)throw new HttpError(409,'NO_SPAWN_CAPACITY','Aucune clairière disponible.');
      await tx.updateTable('worlds').set({isOpen:true,openedAt:sql`coalesce(opened_at,statement_timestamp())`}).where('id','=',id).execute();
    }
  });
}
export async function retryCandidate(db:Kysely<Database>,id:string){
  const r=await db.updateTable('worldGenerationCandidates').set({status:'pending',error:null,revision:sql`revision+1`,heartbeatAt:null})
    .where('worldId','=',id).where('status','=','failed').returning('worldId').executeTakeFirst();
  if(!r)throw new HttpError(409,'CANDIDATE_NOT_FAILED','Seul un candidat échoué peut être repris.');
}
export async function deleteCandidate(db:Kysely<Database>,id:string){
  await db.transaction().execute(async tx=>{
    const row=await tx.selectFrom('worldGenerationCandidates').innerJoin('worlds','worlds.id','worldGenerationCandidates.worldId')
      .select(['status','isOpen']).where('worldId','=',id).forUpdate().executeTakeFirst();
    if(!row)throw new HttpError(404,'CANDIDATE_NOT_FOUND','Candidat absent.');
    const user=await tx.selectFrom('worldMemberships').select('accountId').where('worldId','=',id).executeTakeFirst();
    if(row.isOpen||row.status==='running'||user)throw new HttpError(409,'CANDIDATE_PROTECTED','Ce monde ne peut pas être supprimé.');
    await tx.deleteFrom('stoneDeposits').where('worldId','=',id).execute();
    await tx.deleteFrom('woodlandDeposits').where('worldId','=',id).execute();
    await tx.deleteFrom('worlds').where('id','=',id).execute();
  });
}
