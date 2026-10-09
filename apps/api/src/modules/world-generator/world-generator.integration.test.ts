import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_GENERATOR_PARAMETERS, type GenerateCandidate } from '@arbestra/contracts';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { loadConfig } from '../../config.js';
import { buildApp } from '../../app.js';
import { hashSessionToken } from '../../security/sessions.js';
import { createCandidate, candidateArtifact, candidateAction, listCandidates, retryCandidate } from './service.js';
import { runGenerationOnce } from './worker.js';
import { copyCandidateForRecipe } from './recipe-copy.js';
import { joinWorld } from '../onboarding/service.js';
import { worldRecipeChecksum } from './recipe-provenance.js';
import { artifactChecksum } from './artifact.js';
const url=testDatabaseUrl(),target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/arbestra_test')throw Error('Unexpected generator test target');
const db=createDatabase(url),accountId=randomUUID(),ordinaryId=randomUUID(),email=accountId+'@generator.test';
const config={...loadConfig({...process.env,DATABASE_URL:url}),isProduction:true,worldGeneratorOperatorEmails:[email]};
const worlds:string[]=[];
let app:Awaited<ReturnType<typeof buildApp>>;
const input=(version:2|3=3):GenerateCandidate=>({commandId:randomUUID(),name:'Generator fixture',seed:17,width:64,height:64,version,parameters:{...DEFAULT_GENERATOR_PARAMETERS,treePercent:10}});
async function create(version:2|3=3){const command=input(version),candidate=await createCandidate(db,config,accountId,command);worlds.push(candidate.id);return {candidate,command};}
const headers=(id:string)=>({cookie:config.cookieName+'='+id});
describe('closed world generator',()=>{
  beforeAll(async()=>{
    await migrateToLatest(url);
    await db.insertInto('accounts').values([{id:accountId,email,passwordHash:'fixture'},{id:ordinaryId,email:ordinaryId+'@generator.test',passwordHash:'fixture'}]).execute();
    await db.insertInto('sessions').values([accountId,ordinaryId].map(id=>({accountId:id,tokenHash:hashSessionToken(id),expiresAt:new Date(Date.now()+3600000)}))).execute();
    app=await buildApp(config,db);await app.ready();
  },120000);
  afterAll(async()=>{
    await app?.close();
    if(worlds.length){await db.updateTable('worldClearings').set({claimedVillageId:null,status:'protected'}).where('worldId','in',worlds).execute();await db.deleteFrom('populationCohorts').where('worldId','in',worlds).execute();await db.deleteFrom('stoneDeposits').where('worldId','in',worlds).execute();await db.deleteFrom('woodlandDeposits').where('worldId','in',worlds).execute();await db.deleteFrom('worlds').where('id','in',worlds).execute();}
    await db.deleteFrom('accounts').where('id','in',[accountId,ordinaryId]).execute();await db.destroy();
  });
  it('enforces operator access in production, bounded size and idempotent command contents',async()=>{
    expect((await app.inject({method:'GET',url:'/api/admin/world-generator'})).statusCode).toBe(401);
    expect((await app.inject({method:'GET',url:'/api/admin/world-generator',headers:headers(ordinaryId)})).statusCode).toBe(403);
    const {candidate,command}=await create();
    expect(candidate.recipeRevision).toBe(11);
    const again=await createCandidate(db,config,accountId,command);expect(again.id).toBe(candidate.id);
    await expect(createCandidate(db,config,accountId,{...command,seed:18})).rejects.toMatchObject({code:'COMMAND_CONFLICT'});
    expect((await app.inject({method:'POST',url:'/api/admin/world-generator',headers:headers(accountId),payload:{...input(),width:512,height:512}})).statusCode).toBe(400);
    expect((await app.inject({method:'GET',url:'/api/admin/world-generator/'+candidate.id+'/preview',headers:headers(ordinaryId)})).statusCode).toBe(403);
  });
  it('publishes atomically from an isolated process while health and durable status stay readable; ready v3 remains closed',async()=>{
    const candidate=(await listCandidates(db)).find(c=>c.status==='pending'&&worlds.includes(c.id))??(await create()).candidate,start=Date.now();
    process.env.DATABASE_URL=url;
    const work=runGenerationOnce(db,config);
    let observedRunning=false;
    for(let i=0;i<80;i++){
      const c=(await listCandidates(db)).find(c=>c.id===candidate.id);
      expect((await app.inject({method:'GET',url:'/api/health'})).statusCode).toBe(200);
      if(c?.status==='running'){
        observedRunning=true;
        expect(await runGenerationOnce(db,config)).toBe(false); // Real executor lock held by the first attempt.
        await expect(candidateArtifact(db,candidate.id)).rejects.toMatchObject({code:'CANDIDATE_NOT_READY'});
        break;
      }
      await new Promise(r=>setTimeout(r,20));
    }
    expect(await work).toBe(true);expect(observedRunning).toBe(true);
    // Drain only the explicitly created bounded fixtures.
    while((await listCandidates(db)).some(c=>c.status==='pending'&&worlds.includes(c.id)))await runGenerationOnce(db,config);
    const current=(await listCandidates(db)).find(c=>c.id===candidate.id)!;
    expect(current.status,current.error??undefined).toBe('ready');const artifact=await candidateArtifact(db,candidate.id);
    expect(artifact.geography?.relief?.halfRange).toBe(2);expect(Array.isArray(artifact.stoneSites)).toBe(true);expect(artifact.forest?.version).toBe(1);expect(Array.isArray(artifact.forest?.trees)).toBe(true);expect(artifact.recipeRevision).toBe(11);expect(artifact.geography?.oceans?.version).toBe(1);expect(artifact.geography?.connections?.version).toBe(1);expect(artifact.geography?.connections?.mainLand).toHaveLength(4096);expect(artifact.geography?.geology?.version).toBe(1);expect(artifact.geography?.circulation?.version).toBe(1);expect(artifact.geography?.lakeSurface).toHaveLength(256);expect(artifact.geography?.version).toBe(1);expect(artifact.geography?.parent).toHaveLength(256);expect(Array.isArray(artifact.geography?.rivers)).toBe(true);
    expect(artifactChecksum(artifact)).toBe(current.checksum);
    expect(await db.selectFrom('worldChunks').select('worldId').where('worldId','=',candidate.id).execute()).toHaveLength(4);
    expect(await db.selectFrom('worldClearings').select('id').where('worldId','=',candidate.id).execute()).toHaveLength(0);
    const identity={checksum:current.checksum!,revision:current.revision};
    await candidateAction(db,candidate.id,'retain',identity);
    await expect(candidateAction(db,candidate.id,'open',identity)).rejects.toMatchObject({code:'V3_NOT_OPENABLE'});
    await expect(candidateAction(db,candidate.id,'retain',{...identity,revision:identity.revision+1})).rejects.toMatchObject({code:'CANDIDATE_CHANGED'});
    expect((await app.inject({method:'GET',url:'/api/worlds',headers:headers(ordinaryId)})).json().some((w:{slug:string})=>w.slug==='candidate-'+candidate.id)).toBe(false);
    expect((await app.inject({method:'POST',url:'/api/worlds/candidate-'+candidate.id+'/join',headers:headers(ordinaryId),payload:{playerName:'Test',villageName:'Test'}})).statusCode).toBe(409);
    expect(Date.now()-start).toBeLessThan(120000);
  },120000);
  it('recovers interrupted attempts without publishing leftovers and retries the same closed identity',async()=>{
    const {candidate}=await create();
    await db.updateTable('worldGenerationCandidates').set({status:'running',attempt:1,heartbeatAt:new Date(0)}).where('worldId','=',candidate.id).execute();
    expect(await runGenerationOnce(db,config)).toBe(false);
    expect((await listCandidates(db)).find(c=>c.id===candidate.id)?.status).toBe('failed');
    expect(await db.selectFrom('worldChunks').select('worldId').where('worldId','=',candidate.id).execute()).toHaveLength(0);
    await retryCandidate(db,candidate.id);expect(await runGenerationOnce(db,config)).toBe(true);
    const current=(await listCandidates(db)).find(c=>c.id===candidate.id)!;expect(current.status).toBe('ready');expect(current.attempt).toBe(2);expect(current.revision).toBe(2);
  },120000);
  it('kills an over-budget child without publishing partial chunks and permits explicit retry',async()=>{
    const {candidate}=await create(),previous=process.env.WORLD_GENERATOR_TIMEOUT_MS;
    try{process.env.WORLD_GENERATOR_TIMEOUT_MS='10';expect(await runGenerationOnce(db,config)).toBe(true);}
    finally{if(previous===undefined)delete process.env.WORLD_GENERATOR_TIMEOUT_MS;else process.env.WORLD_GENERATOR_TIMEOUT_MS=previous;}
    const failed=(await listCandidates(db)).find(c=>c.id===candidate.id)!;
    expect(failed.status).toBe('failed');expect(failed.error).toBe('Generation time limit exceeded.');expect(failed.checksum).toBeNull();
    expect(await db.selectFrom('worldChunks').select('worldId').where('worldId','=',candidate.id).execute()).toHaveLength(0);
    await retryCandidate(db,candidate.id);expect(await runGenerationOnce(db,config)).toBe(true);
    expect((await listCandidates(db)).find(c=>c.id===candidate.id)?.status).toBe('ready');
  },120000);
  it('retains and opens only the exact ready v2 candidate, without regenerating it',async()=>{
    const {candidate}=await create(2);expect(await runGenerationOnce(db,config)).toBe(true);
    const current=(await listCandidates(db)).find(c=>c.id===candidate.id)!;expect(current.status).toBe('ready');
    const identity={checksum:current.checksum!,revision:current.revision};
    await expect(candidateAction(db,candidate.id,'open',identity)).rejects.toMatchObject({code:'CANDIDATE_NOT_RETAINED'});
    const copy=await copyCandidateForRecipe(db,db,candidate.id,url);worlds.push(copy.id);
    expect(copy.checksum).toBe(identity.checksum);
    expect(await worldRecipeChecksum(db,copy.id)).toBe(copy.worldRecipeChecksum);
    const stock=await db.selectFrom('woodlandDeposits').select(['featureId','remainingAmount']).where('worldId','=',candidate.id).orderBy('featureId').executeTakeFirstOrThrow();
    await db.updateTable('woodlandDeposits').set({remainingAmount:Number(stock.remainingAmount)-1}).where('worldId','=',candidate.id).where('featureId','=',stock.featureId).execute();
    try{
      expect(await worldRecipeChecksum(db,candidate.id)).not.toBe(copy.worldRecipeChecksum);
      await expect(copyCandidateForRecipe(db,db,candidate.id,url)).rejects.toThrow('Source recipe contents changed');
      await expect(candidateAction(db,candidate.id,'open',identity)).rejects.toMatchObject({code:'CANDIDATE_CHANGED'});
    }finally{await db.updateTable('woodlandDeposits').set({remainingAmount:stock.remainingAmount}).where('worldId','=',candidate.id).where('featureId','=',stock.featureId).execute();}
    expect(await worldRecipeChecksum(db,candidate.id)).toBe(copy.worldRecipeChecksum);
    const spawned=await joinWorld(db,ordinaryId,copy.slug,{playerName:'Recipe player',villageName:'Recipe village'});
    expect(spawned.villageId).toBeTruthy();
    expect(await db.selectFrom('villages').select('id').where('worldId','=',candidate.id).execute()).toHaveLength(0);
    expect(artifactChecksum(await candidateArtifact(db,candidate.id))).toBe(identity.checksum);
    await candidateAction(db,candidate.id,'retain',identity);await candidateAction(db,candidate.id,'open',identity);await candidateAction(db,candidate.id,'open',identity);
    expect(artifactChecksum(await candidateArtifact(db,candidate.id))).toBe(identity.checksum);
    expect((await listCandidates(db)).find(c=>c.id===candidate.id)?.opened).toBe(true);
    await expect(retryCandidate(db,candidate.id)).rejects.toMatchObject({code:'CANDIDATE_NOT_FAILED'});
  },120000);
  it('admits more than twelve candidates regardless of the legacy capacity setting',async()=>{
    const previous=process.env.WORLD_GENERATOR_MAX_CANDIDATES;
    try{
      process.env.WORLD_GENERATOR_MAX_CANDIDATES='1';
      const {candidate,command}=await create();
      for(let i=0;i<12;i++)await create();
      const response=await app.inject({method:'GET',url:'/api/admin/world-generator',headers:headers(accountId)});
      expect(response.json().limits).not.toHaveProperty('maxCandidates');
      expect(response.json().candidates.length).toBeGreaterThanOrEqual(13);
      expect((await createCandidate(db,config,accountId,command)).id).toBe(candidate.id);
    }finally{if(previous===undefined)delete process.env.WORLD_GENERATOR_MAX_CANDIDATES;else process.env.WORLD_GENERATOR_MAX_CANDIDATES=previous;}
  });
});
