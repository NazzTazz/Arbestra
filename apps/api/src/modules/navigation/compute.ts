import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import type {RouteQuery,RouteResult} from '@arbestra/contracts';
import type {NavigationData} from './context.js';
import type {TravelRoute} from '@arbestra/contracts';
import type {NetworkJob,NetworkLoader,TravelNetworkExecutor} from './network-job.js';
import {HttpError} from '../../errors.js';
import {devTime,devTimeSync} from '../operations/dev-timing.js';
type Work={kind:'route'|'network';stage:string;id:string;resolve:(r:RouteResult|TravelRoute[])=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};
type Boot={promise:Promise<void>;resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};
type Lane={worker?:Worker|undefined;boot?:Boot|undefined;busy:boolean;work?:Work|undefined;contexts:Set<string>;sources:Set<string>;observation?:Int32Array|undefined};
type Waiting={resolve:(lane:Lane)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
export interface NavigationExecutor {readonly available:number;run(load:(known:{contexts:ReadonlySet<string>;sources:ReadonlySet<string>})=>Promise<{query:RouteQuery;data?:NavigationData}>):Promise<RouteResult>;close():Promise<void>}
/** Persistent CPU lanes; module startup is distinct from bounded geography work. */
export class NavigationCompute implements NavigationExecutor,TravelNetworkExecutor {
 private closed=false;
 private lanes:Lane[];
 private waiting:Waiting[]=[];
 private lastSuccessAt:string|null=null;private lastErrorAt:string|null=null;
 private expeditionDemand=false;
 get observing(){return this.lanes.some(l=>l.observation);}
 setExpeditionDemand(value:boolean){this.expeditionDemand=value;if(value)this.preemptObservation();}
 private preemptObservation(){for(const l of this.lanes)if(l.observation)Atomics.store(l.observation,0,1);}
 /** Fail closed at saturation. No inline fallback and no extra CPU lane. */
 async observationNetwork(load:NetworkLoader,hasExpeditions:()=>Promise<boolean>):Promise<TravelRoute[]>{
  if(this.closed||this.waiting.length||this.expeditionDemand||this.lanes.some(l=>l.observation)||await hasExpeditions())throw new HttpError(503,'OBSERVATION_BUSY','Observation retardée.');
  const lane=this.lanes.find(l=>l.worker&&!l.busy&&!l.boot);
  if(!lane||this.waiting.length||this.expeditionDemand)throw new HttpError(503,'OBSERVATION_BUSY','Observation retardée.');
  lane.busy=true;lane.observation=new Int32Array(new SharedArrayBuffer(4));
  try{const network=await load(lane);if(Atomics.load(lane.observation,0))throw Error('Observation preempted');
   return await this.dispatch(lane,{network,observation:lane.observation.buffer as SharedArrayBuffer},'network',this.networkLimits.computeMs) as TravelRoute[];
  }catch{throw new HttpError(503,'OBSERVATION_BUSY','Observation retardée.');}
  finally{lane.observation=undefined;lane.busy=false;this.drain();}
 }
 constructor(size=1,private readonly networkLimits={waiting:4,waitMs:15000,computeMs:30000}){this.lanes=Array.from({length:Math.max(1,Math.min(2,size))},()=>({busy:false,contexts:new Set(),sources:new Set()}));}
 get available(){return this.closed?0:this.lanes.filter(l=>!l.busy&&!l.boot).length;}
 get observation(){return {closed:this.closed,ready:this.lanes.filter(l=>l.worker&&!l.boot).length,total:this.lanes.length,active:this.lanes.filter(l=>l.busy).length,waiting:this.waiting.length,lastSuccessAt:this.lastSuccessAt,lastErrorAt:this.lastErrorAt};}
 async start(){if(this.closed)throw Error('Navigation fermée');await Promise.all(this.lanes.map(l=>this.ensureWorker(l)));}
 private async ensureWorker(lane:Lane){
  if(lane.boot)return lane.boot.promise;if(lane.worker)return;
  const source=import.meta.url.endsWith('.ts'),entry=new URL(source?'./compute-worker.ts':'./compute-worker.js',import.meta.url);
  const worker=source?new Worker(`import('tsx/esm/api').then(({register})=>{register();return import(${JSON.stringify(entry.href)});});`,{eval:true,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256}}):new Worker(entry,{execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256}});
  lane.worker=worker;
  let resolve!:()=>void,reject!:(e:Error)=>void;
  const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
  lane.boot={promise,resolve,reject,timer:setTimeout(()=>void this.fail(lane,'Démarrage navigation interrompu'),source?60000:8000)};
  worker.on('message',(reply:{ready?:boolean;id?:string;result?:RouteResult;network?:TravelRoute[];contexts?:string[];sources?:string[];stage?:string;error?:string})=>{
   if(lane.worker!==worker)return;
   if(reply.ready){this.lastSuccessAt=new Date().toISOString();const boot=lane.boot;lane.boot=undefined;if(boot){clearTimeout(boot.timer);boot.resolve();}if(!lane.work)worker.unref();this.drain();return;}
   if(!lane.work||reply.id!==lane.work.id)return;
   if(reply.stage){lane.work.stage=reply.stage;return;}
   const work=lane.work;lane.work=undefined;clearTimeout(work.timer);
   const result=work.kind==='network'?reply.network:reply.result;
   lane.contexts=new Set(reply.contexts);lane.sources=new Set(reply.sources);
   if(reply.error||!result||Array.isArray(result)!==(work.kind==='network')){if(!lane.observation)this.lastErrorAt=new Date().toISOString();work.reject(Error(reply.error??'Réponse navigation invalide'));}
   else{this.lastSuccessAt=new Date().toISOString();work.resolve(result);}
   worker.unref();
  });
  worker.on('error',(e)=>{if(lane.worker===worker)void this.fail(lane,e.message);});worker.on('exit',()=>{if(lane.worker===worker)void this.fail(lane);});
  return promise;
 }
 async run(load:(known:{contexts:ReadonlySet<string>;sources:ReadonlySet<string>})=>Promise<{query:RouteQuery;data?:NavigationData}>):Promise<RouteResult>{
  this.preemptObservation();
  const lane=this.lanes.find(l=>!l.busy&&!l.boot);if(this.closed||!lane)throw Error('Navigation occupée');lane.busy=true;
  try{
   await this.ensureWorker(lane);if(this.closed)throw Error('Navigation fermée');
   const job=await load(lane);if(this.closed)throw Error('Navigation fermée');
   return await this.dispatch(lane,job,'route',6000) as RouteResult;
  }finally{lane.busy=false;this.drain();}
 }
 private dispatch(lane:Lane,job:{query:RouteQuery;data?:NavigationData}|{network:NetworkJob;observation?:SharedArrayBuffer},kind:Work['kind'],timeout:number){
  lane.worker!.ref();
  return new Promise<RouteResult|TravelRoute[]>((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>void this.fail(lane),timeout);
   lane.work={kind,stage:'dispatch',id,resolve,reject,timer};
   try{if(kind==='network')devTimeSync('navigation_input',()=>lane.worker!.postMessage({id,...job}));else lane.worker!.postMessage({id,...job});}catch{void this.fail(lane);}
  });
 }
 private drain(){
  if(this.closed)return;
  for(const lane of this.lanes){if(lane.busy||lane.boot)continue;const next=this.waiting.shift();if(!next)break;
   clearTimeout(next.timer);lane.busy=true;next.resolve(lane);}
 }
 private acquireNetwork():Promise<Lane>{
  this.preemptObservation();
  if(this.closed)return Promise.reject(new HttpError(503,'NAVIGATION_UNAVAILABLE','Calcul des trajets indisponible.'));
  const lane=this.lanes.find(l=>!l.busy&&!l.boot);
  if(lane){lane.busy=true;return Promise.resolve(lane);}
  if(this.waiting.length>=this.networkLimits.waiting)return Promise.reject(new HttpError(503,'NAVIGATION_BUSY','Calcul des trajets occupé. Réessayez.'));
  return new Promise((resolve,reject)=>{
   const entry:Waiting={resolve,reject,timer:setTimeout(()=>{this.waiting=this.waiting.filter(w=>w!==entry);reject(new HttpError(503,'NAVIGATION_BUSY','Calcul des trajets occupé. Réessayez.'));},this.networkLimits.waitMs)};
   this.waiting.push(entry);
  });
 }
 async network(load:NetworkLoader):Promise<TravelRoute[]>{
  const lane=await devTime('navigation_queue',async()=>{const reserved=await this.acquireNetwork();
   try{await this.ensureWorker(reserved);return reserved;}catch{reserved.busy=false;this.drain();throw new HttpError(503,'NAVIGATION_UNAVAILABLE','Calcul des trajets indisponible.');}});
  try{
   if(this.closed)throw Error('Navigation fermée');
   const network=await load(lane);if(this.closed)throw Error('Navigation fermée');
   return await devTime('navigation',()=>this.dispatch(lane,{network},'network',this.networkLimits.computeMs)) as TravelRoute[];
  }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(503,'NAVIGATION_UNAVAILABLE','Calcul des trajets interrompu. Réessayez.');}
  finally{lane.busy=false;this.drain();}
 }
 private async fail(lane:Lane,message?:string){
  if(!this.closed)this.lastErrorAt=new Date().toISOString();
  const boot=lane.boot;lane.boot=undefined;if(boot){clearTimeout(boot.timer);boot.reject(Error(message??'Démarrage navigation interrompu'));}
  const work=lane.work;lane.work=undefined;if(work){clearTimeout(work.timer);work.reject(Error(message??'Navigation interrompue ('+work.stage+')'));}
  const worker=lane.worker;lane.worker=undefined;lane.contexts.clear();lane.sources.clear();await worker?.terminate();
 }
 async close(){this.closed=true;for(const entry of this.waiting){clearTimeout(entry.timer);entry.reject(new HttpError(503,'NAVIGATION_UNAVAILABLE','Calcul des trajets indisponible.'));}this.waiting=[];await Promise.all(this.lanes.map(l=>this.fail(l)));}
}
