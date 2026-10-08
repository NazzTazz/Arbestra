import { Type } from '@sinclair/typebox';
import { CandidateIdentitySchema, GenerateCandidateSchema, type GenerateCandidate } from '@arbestra/contracts';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { authenticate } from '../auth/service.js';
import { generatorSettings } from './settings.js';
import { candidateAction, candidateArtifact, createCandidate, deleteCandidate, listCandidates, retryCandidate } from './service.js';
export async function registerWorldGeneratorRoutes(app:FastifyInstance,db:Kysely<Database>,config:AppConfig){
  const base='/api/admin/world-generator',params=Type.Object({id:Type.String({format:'uuid'})});
  const authorize=async(request:{cookies:Record<string,string|undefined>})=>{
    const account=await authenticate(db,request.cookies[config.cookieName]);
    if(!generatorSettings(config).operatorEmails.includes(account.email.toLowerCase()))
      throw new HttpError(403,'OPERATOR_REQUIRED','Accès opérateur requis.');
    return account;
  };
  app.addHook('onRequest',async(request,reply)=>{if(request.url.startsWith(base))reply.header('Cache-Control','private, no-store');});
  app.get(base,async request=>{await authorize(request);return {candidates:await listCandidates(db),limits:{maxCells:generatorSettings(config).maxCells}};});
  app.post(base,{schema:{body:GenerateCandidateSchema}},async request=>{
    const account=await authorize(request);return createCandidate(db,config,account.id,request.body as GenerateCandidate);
  });
  app.get(base+'/:id/preview',{schema:{params}},async request=>{await authorize(request);return candidateArtifact(db,(request.params as {id:string}).id);});
  for(const action of ['retain','open'] as const)app.post(base+'/:id/'+action,{schema:{params,body:CandidateIdentitySchema}},async request=>{
    await authorize(request);await candidateAction(db,(request.params as {id:string}).id,action,request.body as {checksum:string;revision:number});return {ok:true};
  });
  app.post(base+'/:id/retry',{schema:{params}},async request=>{await authorize(request);await retryCandidate(db,(request.params as {id:string}).id);return {ok:true};});
  app.delete(base+'/:id',{schema:{params}},async request=>{await authorize(request);await deleteCandidate(db,(request.params as {id:string}).id);return {ok:true};});
}
