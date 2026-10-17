import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {ObservationAction,ObservationLease,ObservationPublication,ObservationSource,ObservationStatus} from '@arbestra/contracts';
import {HttpError} from '../../errors.js';

const fail=(code='OBSERVATION_EXPIRED')=>new HttpError(404,code,'Observation indisponible.');
type Lease=ObservationLease&{actorId:string;seen:number;generation:number;opening:boolean;close?:(()=>void)|undefined};
type Source=ObservationSource&{session:string;worldId:string;villageId:string;accountId:string;rateAt:number;count:number;poseCount:number};
type Feed={actions:ObservationAction[];versions:Map<string,number>;started:string;sequence:number;truncated:boolean;degraded:boolean};
/** No credentials or business entities are retained here. All callers authorize first. */
export class ObservationHub {
 readonly instanceId=randomUUID();private leases=new Map<string,Lease>();private sources=new Map<string,Source>();private feeds=new Map<string,Feed>();
 private listeners=new Set<(lease:ObservationLease,reason:string,actorId:string)=>void>();
 constructor(private now:()=>number=Date.now){}
 get collecting(){return this.leases.size>0;}
 onClose(fn:(lease:ObservationLease,reason:string,actorId:string)=>void){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 private key(worldId:string,villageId:string,accountId:string){return worldId+':'+villageId+':'+accountId;}
 sweep(){const now=this.now();for(const l of this.leases.values())if(now-l.seen>=45000||Date.parse(l.expiresAt)<=now)this.close(l.id,'expired');for(const [id,s]of this.sources)if(now-Date.parse(s.lastSourceSeenAt)>=30000)this.sources.delete(id);}
 active(worldId:string,villageId:string,accountId?:string){this.sweep();return [...this.leases.values()].some(l=>l.worldId===worldId&&l.villageId===villageId&&(!accountId||l.accountId===accountId));}
 create(actorId:string,target:Pick<ObservationLease,'worldId'|'villageId'|'accountId'|'worldSlug'|'villageName'>):ObservationLease{
  this.sweep();if(this.leases.size>=16||[...this.leases.values()].filter(l=>l.actorId===actorId).length>=4)throw new HttpError(429,'OBSERVATION_LIMIT','Trop d’observations ouvertes.');
  const at=this.now(),l:Lease={...target,id:randomUUID(),instanceId:this.instanceId,createdAt:new Date(at).toISOString(),expiresAt:new Date(at+1800000).toISOString(),actorId,seen:at,generation:0,opening:false};this.leases.set(l.id,l);
  const key=this.key(l.worldId,l.villageId,l.accountId);if(!this.feeds.has(key))this.feeds.set(key,{actions:[],versions:new Map(),started:l.createdAt,sequence:0,truncated:false,degraded:false});return this.publicLease(l);
 }
 private publicLease(l:Lease):ObservationLease{const {id,instanceId,worldId,villageId,accountId,worldSlug,villageName,createdAt,expiresAt}=l;return{id,instanceId,worldId,villageId,accountId,worldSlug,villageName,createdAt,expiresAt};}
 get(id:string,actorId:string){this.sweep();const l=this.leases.get(id);if(!l||l.actorId!==actorId)throw fail();return this.publicLease(l);}
 heartbeat(id:string,actorId:string){this.get(id,actorId);this.leases.get(id)!.seen=this.now();}
 close(id:string,reason='closed'){const l=this.leases.get(id);if(!l)return;this.leases.delete(id);l.close?.();for(const fn of this.listeners)fn(this.publicLease(l),reason,l.actorId);
  if(![...this.leases.values()].some(x=>x.worldId===l.worldId&&x.villageId===l.villageId&&x.accountId===l.accountId)){this.feeds.delete(this.key(l.worldId,l.villageId,l.accountId));for(const [sid,s]of this.sources)if(s.worldId===l.worldId&&s.villageId===l.villageId&&s.accountId===l.accountId)this.sources.delete(sid);}
 }
 closeAll(){for(const id of [...this.leases.keys()])this.close(id,'shutdown');}
 open(id:string,actorId:string){this.get(id,actorId);const l=this.leases.get(id)!;if(l.opening)throw new HttpError(429,'OBSERVATION_BUSY','Ouverture déjà en cours.');l.opening=true;const generation=++l.generation;l.close?.();l.close=undefined;
  return {attach:(close:()=>void)=>{if(this.leases.get(id)!==l||l.generation!==generation){close();return false;}l.opening=false;l.close=close;return true;},current:()=>this.leases.get(id)===l&&l.generation===generation,release:()=>{if(this.leases.get(id)===l&&l.generation===generation){l.opening=false;l.close=undefined;}}};
 }
 source(session:string,accountId:string,worldId:string,villageId:string){if(!this.active(worldId,villageId,accountId))throw fail();if([...this.sources.values()].filter(s=>s.worldId===worldId&&s.villageId===villageId).length>=4)throw new HttpError(429,'OBSERVATION_SOURCE_LIMIT','Trop de sources caméra.');const id=randomUUID();this.sources.set(id,{id,session,accountId,worldId,villageId,poseSequence:0,visible:false,pose:null,lastPoseChangedAt:null,lastSourceSeenAt:new Date(this.now()).toISOString(),fresh:false,rateAt:this.now(),count:0,poseCount:0});return id;}
 publish(session:string,accountId:string,worldId:string,villageId:string,p:ObservationPublication){if(!this.active(worldId,villageId,accountId))throw fail();const s=this.sources.get(p.sourceId);if(!s||s.session!==session||s.accountId!==accountId||s.worldId!==worldId||s.villageId!==villageId)throw fail();const at=this.now();
  if(at-s.rateAt>=1000){s.rateAt=at;s.count=0;s.poseCount=0;}if(++s.count>6||(p.pose&&++s.poseCount>5))throw new HttpError(429,'OBSERVATION_RATE','Publication trop fréquente.');
  if(p.pose){if(p.poseSequence<=s.poseSequence)return {needPose:false};s.pose=p.pose;s.poseSequence=p.poseSequence;s.lastPoseChangedAt=new Date(at).toISOString();}
  else if(!s.pose||p.poseSequence!==s.poseSequence)return {needPose:true};
  s.visible=p.visible;s.lastSourceSeenAt=new Date(at).toISOString();return{needPose:false};
 }
 record(action:ObservationAction){this.sweep();const f=this.feeds.get(this.key(action.worldId,action.villageId,action.accountId));if(!f||Date.parse(action.at)<Date.parse(f.started))return;const old=f.actions.findIndex(a=>a.id===action.id);if(old>=0&&isDeepStrictEqual(f.actions[old],action))return;if(old>=0)f.actions.splice(old,1);f.actions.push(structuredClone(action));f.versions.set(action.id,++f.sequence);
  while(f.actions.length>500||f.actions[0]&&this.now()-Date.parse(f.actions[0].at)>900000){const removed=f.actions.shift();if(removed)f.versions.delete(removed.id);f.truncated=true;}
  const bytes=()=>[...this.feeds.values()].reduce((n,x)=>n+Buffer.byteLength(JSON.stringify(x.actions)),0);
  while(bytes()>8*1024*1024){const oldest=[...this.feeds.values()].filter(x=>x.actions.length).sort((a,b)=>Date.parse(a.actions[0]!.at)-Date.parse(b.actions[0]!.at))[0];if(!oldest)break;const removed=oldest.actions.shift();if(removed)oldest.versions.delete(removed.id);oldest.truncated=true;}
 }
 degrade(l:ObservationLease,value:boolean){if(!this.leases.has(l.id))return;const f=this.feeds.get(this.key(l.worldId,l.villageId,l.accountId));if(f)f.degraded=value;}
 cameras(lease:ObservationLease){return [...this.sources.values()].filter(s=>s.worldId===lease.worldId&&s.villageId===lease.villageId&&s.accountId===lease.accountId).map(s=>{const {id,poseSequence,visible,pose,lastPoseChangedAt,lastSourceSeenAt}=s;return{id,poseSequence,visible,pose,lastPoseChangedAt,lastSourceSeenAt,fresh:visible&&Boolean(pose)&&this.now()-Date.parse(lastSourceSeenAt)<15000};});}
 status(id:string,actorId:string):ObservationStatus{const lease=this.get(id,actorId),f=this.feeds.get(this.key(lease.worldId,lease.villageId,lease.accountId))!;
  f.actions=f.actions.filter(a=>{const keep=this.now()-Date.parse(a.at)<=900000;if(!keep){f.truncated=true;f.versions.delete(a.id);}return keep;});
  const sources=this.cameras(lease);
  return{lease,sources,actions:structuredClone(f.actions),sequence:f.sequence,coverageStartedAt:f.started,truncated:f.truncated,degraded:f.degraded,oldestSequence:f.versions.size?Math.min(...f.versions.values()):f.sequence};
 }
}
