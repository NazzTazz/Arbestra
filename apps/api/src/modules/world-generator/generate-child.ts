import { performance } from 'node:perf_hooks';
import { sql } from 'kysely';
import { generateLandscape, type GeneratorParameters } from '@arbestra/contracts';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../database/connection.js';
import { generateWorld } from '../worlds/generation.js';
import { artifactChecksum, readV2Artifact, writeV3Chunks } from './artifact.js';
const id=process.argv[2]!,attempt=Number(process.argv[3]);
const db=createDatabase(loadConfig().databaseUrl), start=performance.now();
try{
  const row=await db.selectFrom('worldGenerationCandidates').innerJoin('worlds','worlds.id','worldGenerationCandidates.worldId')
    .selectAll().where('worldId','=',id).where('attempt','=',attempt).where('status','=','running').executeTakeFirstOrThrow();
  const prepared=row.generationVersion===3?generateLandscape(Number(row.seed),row.widthCells,row.heightCells,row.parameters as GeneratorParameters,row.recipeRevision):null;
  await db.transaction().execute(async tx=>{
    await sql`set local statement_timeout='120s'`.execute(tx);
    const current=await tx.selectFrom('worldGenerationCandidates').select(['attempt','status']).where('worldId','=',id).forUpdate().executeTakeFirstOrThrow();
    if(current.attempt!==attempt||current.status!=='running')throw new Error('Obsolete generation attempt');
    const world=await tx.selectFrom('worlds').select(['isOpen','generationStatus']).where('id','=',id).forUpdate().executeTakeFirstOrThrow();
    if(world.isOpen||world.generationStatus==='ready')throw new Error('World already published');
    if(prepared)await writeV3Chunks(tx,id,prepared);else await generateWorld(tx,id);
    const artifact=prepared??await readV2Artifact(tx,id),checksum=artifactChecksum(artifact);
    await tx.updateTable('worldGenerationCandidates').set({artifact,metrics:artifact.metrics,checksum,status:'ready',
      finishedAt:new Date(),durationMs:Math.round(performance.now()-start),error:null}).where('worldId','=',id).where('attempt','=',attempt).execute();
    await tx.updateTable('worlds').set({generationStatus:'ready',generatedAt:new Date()}).where('id','=',id).execute();
  });
}catch(error){console.error(error instanceof Error?error.message:'Generation failed');process.exitCode=1;}
finally{await db.destroy();}
