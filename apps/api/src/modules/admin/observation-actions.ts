import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {ObservationAction} from '@arbestra/contracts';
import {HttpError} from '../../errors.js';
import type {ObservationHub} from './observation-hub.js';

const actions=new WeakMap<FastifyRequest,ObservationAction>();
const context=new AsyncLocalStorage<{hub:ObservationHub;request:FastifyRequest;kind:string;at:string;accountId?:string}>();
export function observationAuthenticated(accountId:string){const current=context.getStore();if(current)current.accountId=accountId;}
/** Bind only facts already authorized by the normal ownership read. No extra SQL. */
export function observationVillage(accountId:string,worldId:string,villageId:string){
 const current=context.getStore();if(!current||current.accountId!==accountId||actions.has(current.request)||!current.hub.active(worldId,villageId,accountId))return;
 if((current.request.params as {villageId?:string}).villageId!==villageId)return;
 const {request,kind,hub}=current,body=request.body as Record<string,unknown>|undefined;
 const action:ObservationAction={id:randomUUID(),requestId:request.id,worldId,villageId,accountId,at:current.at,kind,businessOutcome:'unknown',httpOutcome:'pending'};
 if(typeof body?.commandId==='string'&&/^[\da-f-]{36}$/i.test(body.commandId))action.commandId=body.commandId;
 const target=(body?.target??body) as {cellX?:unknown;cellY?:unknown}|undefined;
 if(target&&typeof target.cellX==='number'&&typeof target.cellY==='number')action.target={cellX:target.cellX,cellY:target.cellY};
 actions.set(request,action);hub.record(action);
}
/** Called immediately after a command transaction resolves, before transport projection. */
export function observationCommitted(request:FastifyRequest){const action=actions.get(request);if(action)action.businessOutcome='accepted';}
export function observationCommandKind(route:string):string|null{
 if(!route.startsWith('/api/worlds/:worldSlug/villages/:villageId/')||route.endsWith('/preview'))return null;
 const tail=route.split('/:villageId/')[1]!;
 if(/^(buildings(?:\/:buildingId\/(?:upgrade|expansions|harvest|discover-supplies))?|garden-harvests|harvest-intents|extraction-pools|market|processing|infrastructure|exploitation|science|population\/(?:feed|rest|gestures)|worksites(?:\/:worksiteId)?|features\/:featureId\/(?:extractions|clear))$/.test(tail))return tail;
 return null;
}
export function instrumentObservationActions(app:FastifyInstance,hub:ObservationHub){
 app.addHook('onRoute',options=>{
  if(![options.method].flat().includes('POST'))return;const kind=observationCommandKind(options.url);if(!kind)return;
  const handler=options.handler;
  options.handler=async function(request,reply){
   if(!hub.collecting)return handler.call(this,request,reply);
   const body=request.body as Record<string,unknown>|undefined;
   let finished=false;
   const finish=()=>{finished=true;const action=actions.get(request);if(action){action.httpOutcome='finished';action.statusCode=reply.statusCode;hub.record(action);}};
   reply.raw.once('finish',finish);reply.raw.once('close',()=>{const action=actions.get(request);if(!finished&&action){action.httpOutcome='interrupted';hub.record(action);}});
   try{const result=await context.run({hub,request,kind,at:new Date().toISOString()},()=>handler.call(this,request,reply));const action=actions.get(request);if(!action)return result;
    if(action.businessOutcome==='unknown')action.businessOutcome=kind==='science'&&(body?.action==='survey'||body?.action==='explore')||kind==='harvest-intents'?'pending':'accepted';
    hub.record(action);return result;
   }catch(error){const action=actions.get(request);if(action){if(error instanceof HttpError&&action.businessOutcome==='unknown'&&error.statusCode<500){action.businessOutcome='rejected';action.code=error.code;}hub.record(action);}throw error;}
  };
 });
}
