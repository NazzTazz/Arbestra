import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import type {RouteQuery,RouteResult} from '@arbestra/contracts';
import type {NavigationData} from './context.js';
type Work={stage:string;id:string;resolve:(r:RouteResult)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};
type Boot={promise:Promise<void>;resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};
type Lane={worker?:Worker|undefined;boot?:Boot|undefined;busy:boolean;work?:Work|undefined;contexts:Set<string>;sources:Set<string>};
export interface NavigationExecutor {readonly available:number;run(load:(known:{contexts:ReadonlySet<string>;sources:ReadonlySet<string>})=>Promise<{query:RouteQuery;data?:NavigationData}>):Promise<RouteResult>;close():Promise<void>}
/** Persistent CPU lanes; module startup is distinct from bounded geography work. */
export class NavigationCompute implements NavigationExecutor {
 private closed=false;
 private lanes:Lane[];
 private lastSuccessAt:string|null=null;private lastErrorAt:string|null=null;
 constructor(size=1){this.lanes=Array.from({length:Math.max(1,Math.min(2,size))},()=>({busy:false,contexts:new Set(),sources:new Set()}));}
 get available(){return this.closed?0:this.lanes.filter(l=>!l.busy&&!l.boot).length;}
 get observation(){return {closed:this.closed,ready:this.lanes.filter(l=>l.worker&&!l.boot).length,total:this.lanes.length,active:this.lanes.filter(l=>l.busy).length,waiting:0,lastSuccessAt:this.lastSuccessAt,lastErrorAt:this.lastErrorAt};}
 async start(){if(this.closed)throw Error('Navigation fermée');await Promise.all(this.lanes.map(l=>this.ensureWorker(l)));}
 private async ensureWorker(lane:Lane){
  if(lane.boot)return lane.boot.promise;if(lane.worker)return;
  const source=import.meta.url.endsWith('.ts'),entry=new URL(source?'./compute-worker.ts':'./compute-worker.js',import.meta.url);
  const worker=source?new Worker(`import('tsx/esm/api').then(({register})=>{register();return import(${JSON.stringify(entry.href)});});`,{eval:true,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256}}):new Worker(entry,{execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256}});
  lane.worker=worker;
  let resolve!:()=>void,reject!:(e:Error)=>void;
  const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
  lane.boot={promise,resolve,reject,timer:setTimeout(()=>void this.fail(lane,'Démarrage navigation interrompu'),source?60000:8000)};
  worker.on('message',(reply:{ready?:boolean;id?:string;result?:RouteResult;contexts?:string[];sources?:string[];stage?:string;error?:string})=>{
   if(lane.worker!==worker)return;
   if(reply.ready){this.lastSuccessAt=new Date().toISOString();const boot=lane.boot;lane.boot=undefined;if(boot){clearTimeout(boot.timer);boot.resolve();}if(!lane.work)worker.unref();return;}
   if(!lane.work||reply.id!==lane.work.id)return;
   if(reply.stage){lane.work.stage=reply.stage;return;}
   const work=lane.work;lane.work=undefined;clearTimeout(work.timer);
   if(reply.error||!reply.result){this.lastErrorAt=new Date().toISOString();work.reject(Error(reply.error??'Réponse navigation invalide'));}
   else{this.lastSuccessAt=new Date().toISOString();lane.contexts=new Set(reply.contexts);lane.sources=new Set(reply.sources);work.resolve(reply.result);}
   worker.unref();
  });
  worker.on('error',(e)=>{if(lane.worker===worker)void this.fail(lane,e.message);});worker.on('exit',()=>{if(lane.worker===worker)void this.fail(lane);});
  return promise;
 }
 async run(load:(known:{contexts:ReadonlySet<string>;sources:ReadonlySet<string>})=>Promise<{query:RouteQuery;data?:NavigationData}>):Promise<RouteResult>{
  const lane=this.lanes.find(l=>!l.busy&&!l.boot);if(this.closed||!lane)throw Error('Navigation occupée');lane.busy=true;
  try{
   await this.ensureWorker(lane);if(this.closed)throw Error('Navigation fermée');
   const job=await load(lane);if(this.closed)throw Error('Navigation fermée');
   lane.worker!.ref();
   return await new Promise<RouteResult>((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>void this.fail(lane),6000);lane.work={stage:'dispatch',id,resolve,reject,timer};
    try{lane.worker!.postMessage({id,...job});}catch{void this.fail(lane);}});
  }finally{lane.busy=false;}
 }
 private async fail(lane:Lane,message?:string){
  if(!this.closed)this.lastErrorAt=new Date().toISOString();
  const boot=lane.boot;lane.boot=undefined;if(boot){clearTimeout(boot.timer);boot.reject(Error(message??'Démarrage navigation interrompu'));}
  const work=lane.work;lane.work=undefined;if(work){clearTimeout(work.timer);work.reject(Error(message??'Navigation interrompue ('+work.stage+')'));}
  const worker=lane.worker;lane.worker=undefined;lane.contexts.clear();lane.sources.clear();await worker?.terminate();
 }
 async close(){this.closed=true;await Promise.all(this.lanes.map(l=>this.fail(l)));}
}
