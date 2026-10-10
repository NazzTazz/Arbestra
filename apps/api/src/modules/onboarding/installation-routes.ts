import {getPreparationTerrain} from '../worlds/terrain.js';
import {TerrainResponseSchema} from '@arbestra/contracts';
import {HttpError} from '../../errors.js';
import {Type} from '@sinclair/typebox';
import {SpawnPoseRequestSchema,StarterPoseRequestSchema,StarterInstallationSchema,StarterKitSchema,type SpawnPoseRequest,type StarterPoseRequest} from '@arbestra/contracts';
import type {FastifyInstance} from 'fastify';
import type {Kysely} from 'kysely';
import type {Database} from '../../database/schema.js';
import type {AppConfig} from '../../config.js';
import {authenticate} from '../auth/service.js';
import {getSpawnAtlas,readSpawnSnapshot} from './spawn-map.js';
import {STARTER_KIT} from './starter-kit.js';
import {installVillage,poseRemainingStarter,readInstallation} from './installation.js';
import type {SpawnCompute} from './spawn-compute.js';
import type {InstallationPlan} from './installation-plan.js';
const worldParams=Type.Object({worldSlug:Type.String({minLength:1,maxLength:64})});
export async function registerInstallationRoutes(app:FastifyInstance,db:Kysely<Database>,config:AppConfig,compute:SpawnCompute){
 app.get('/api/worlds/:worldSlug/starter/terrain',{schema:{params:worldParams,querystring:Type.Object({chunks:Type.String({maxLength:1024})}),response:{200:TerrainResponseSchema}}},async(request,reply)=>{
  const account=await authenticate(db,request.cookies[config.cookieName]);reply.header('cache-control','no-store');return getPreparationTerrain(db,account.id,(request.params as {worldSlug:string}).worldSlug,(request.query as {chunks:string}).chunks);
 });
 app.get('/api/worlds/:worldSlug/starter',{schema:{params:worldParams,response:{200:Type.Object({kit:StarterKitSchema,installation:Type.Union([StarterInstallationSchema,Type.Null()])})}}},async(request,reply)=>{
  const account=await authenticate(db,request.cookies[config.cookieName]),slug=(request.params as {worldSlug:string}).worldSlug;
  await getSpawnAtlas(db,slug);reply.header('cache-control','no-store');return{kit:STARTER_KIT,installation:await readInstallation(db,account.id,slug)};
 });
 app.post('/api/worlds/:worldSlug/starter/inspect',{schema:{params:worldParams,body:SpawnPoseRequestSchema}},async(request,reply)=>{
  await authenticate(db,request.cookies[config.cookieName]);const slug=(request.params as {worldSlug:string}).worldSlug;
  const snapshot=await readSpawnSnapshot(db,slug,true),input=request.body as SpawnPoseRequest;
  if(input.artifactChecksum!==snapshot.map.artifactChecksum||input.kitVersion!==STARTER_KIT.version)throw new HttpError(409,'SPAWN_MAP_STALE','Rechargez la préparation.');
  // Only the public decision and expected cleaning cross the API; no foreign paths/reservations.
  const plan=await compute.run({kind:'installation',snapshot,input}) as InstallationPlan;reply.header('cache-control','no-store');
  return{terrain:plan.terrain,status:plan.status,poorInResources:plan.poorInResources,treesToRemove:plan.cleaning.removedTreeIndices.length};
 });
 app.post('/api/worlds/:worldSlug/starter',{schema:{params:worldParams,body:SpawnPoseRequestSchema,response:{200:StarterInstallationSchema}}},async request=>{
  const account=await authenticate(db,request.cookies[config.cookieName]);return installVillage(db,compute,account.id,(request.params as {worldSlug:string}).worldSlug,request.body as SpawnPoseRequest);
 });
 app.post('/api/worlds/:worldSlug/villages/:villageId/starter',{schema:{params:Type.Object({worldSlug:Type.String({minLength:1,maxLength:64}),villageId:Type.String({format:'uuid'})}),body:StarterPoseRequestSchema,response:{200:StarterInstallationSchema}}},async request=>{
  const account=await authenticate(db,request.cookies[config.cookieName]),params=request.params as {worldSlug:string;villageId:string};return poseRemainingStarter(db,compute,account.id,params.worldSlug,params.villageId,request.body as StarterPoseRequest);
 });
}
