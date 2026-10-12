import {canWalkSpawnSegment,type SpawnAccessField} from './spawn-access.js';
import {spawnDelta} from './spawn-map.js';
import type {TravelCell} from './travel-paths.js';

export const ROUTE_POLICY_VERSION = 'rc1-pedestrian-1';
export type RouteEndpoint = {kind:'point';cellX:number;cellY:number}|{kind:'access';accessId:string};
export interface RouteQuery {
 worldId:string;contextId:string;policyVersion:string;movementProfileId:string;traversalConstraintsId:string;
 starts:RouteEndpoint[];goals:RouteEndpoint[];limits:{maxNodes:number;maxDurationMs:number};
}
export interface RouteAccess {id:string;path:TravelCell[]}
export interface RouteField extends SpawnAccessField {
 worldId:string;contextId:string;traversalConstraintsId:string;accesses:RouteAccess[];
 /** Access connectors are certified separately, with only their own interior exemption. */
 connector:(access:RouteAccess)=>boolean;
 minimumCost?:number;
 cost?:(a:TravelCell,b:TravelCell)=>number;
}
export type RouteResult =
 | {kind:'found';contextId:string;policyVersion:string;movementProfileId:string;traversalConstraintsId:string;path:TravelCell[];length:number;cost:number;visited:number}
 | {kind:'unreachable';reason:'endpoints';visited:number}
 | {kind:'budget-exceeded';visited:number}
 | {kind:'context-unavailable';visited:number};
const wrap=(x:number,n:number)=>(x%n+n)%n;
type Entry={id:number;x:number;y:number;g:number;f:number;parent:Entry|null;prefix:TravelCell[]};
const precedes=(a:Entry,b:Entry)=>a.f<b.f||(a.f===b.f&&a.g>b.g);
class Heap {
 private entries:Entry[]=[];
 get size(){return this.entries.length;}
 push(e:Entry){let i=this.entries.length;this.entries.push(e);while(i){const p=(i-1)>>1;if(!precedes(e,this.entries[p]!))break;this.entries[i]=this.entries[p]!;i=p;}this.entries[i]=e;}
 pop(){const first=this.entries[0]!,last=this.entries.pop()!;if(this.entries.length){let i=0;while(i*2+1<this.entries.length){let c=i*2+1;if(c+1<this.entries.length&&precedes(this.entries[c+1]!,this.entries[c]!))c++;if(!precedes(this.entries[c]!,last))break;this.entries[i]=this.entries[c]!;i=c;}this.entries[i]=last;}return first;}
}
export function routeLength(path:readonly TravelCell[],world:{width:number;height:number}){
 let n=0;for(let i=1;i<path.length;i++)n+=Math.abs(spawnDelta(path[i]!.cellX,path[i-1]!.cellX,world.width))+Math.abs(spawnDelta(path[i]!.cellY,path[i-1]!.cellY,world.height));return n;
}
/** Pure bounded A*. Success is a swept witness; an incomplete lattice never proves no physical path. */
export function planRoute(field:RouteField,q:RouteQuery,now:()=>number=()=>performance.now()):RouteResult{
 if(q.worldId!==field.worldId||q.contextId!==field.contextId||q.traversalConstraintsId!==field.traversalConstraintsId
  ||q.policyVersion!==ROUTE_POLICY_VERSION||q.movementProfileId!=='pedestrian-v1'||!q.starts.length||!q.goals.length)return{kind:'context-unavailable',visited:0};
 if(q.limits.maxDurationMs<=0||q.limits.maxNodes<1)return{kind:'budget-exceeded',visited:0};
 const started=now(),w=field.width*8,h=field.height*8,queue=new Heap(),best=new Map<number,number>(),closed=new Set<number>();
 const point=(x:number,y:number):TravelCell=>({cellX:wrap(x,w)/8,cellY:wrap(y,h)/8});
 const walk=(a:TravelCell,b:TravelCell)=>canWalkSpawnSegment(field,{x:a.cellX,y:a.cellY},{x:b.cellX,y:b.cellY});
 const resolve=(end:RouteEndpoint):TravelCell[]|null=>{
  if(end.kind==='access'){const access=field.accesses.find(a=>a.id===end.accessId);return access&&field.connector(access)?access.path:null;}
  if(!Number.isFinite(end.cellX)||!Number.isFinite(end.cellY)||end.cellX<0||end.cellY<0||end.cellX>=field.width||end.cellY>=field.height)return null;
  const p={cellX:end.cellX,cellY:end.cellY};return walk(p,p)?[p]:null;
 };
 const goals=q.goals.flatMap(e=>{const path=resolve(e);return path?[path.slice().reverse()]:[];});
 const starts=q.starts.flatMap(e=>{const path=resolve(e);return path?[path]:[];});
 if(!goals.length||!starts.length)return{kind:'unreachable',reason:'endpoints',visited:0};
 const heuristic=(x:number,y:number)=>Math.min(...goals.map(p=>{const to=p[0]!;return (field.minimumCost??(field.cost?.7:1))*(Math.abs(spawnDelta(to.cellX,x/8,field.width))+Math.abs(spawnDelta(to.cellY,y/8,field.height)));}));
 const connect=(p:TravelCell)=>{const paths:TravelCell[][]=[];for(const x of new Set([Math.floor(p.cellX*8),Math.ceil(p.cellX*8)]))for(const y of new Set([Math.floor(p.cellY*8),Math.ceil(p.cellY*8)])){
  const end=point(x,y);for(const bend of [{cellX:p.cellX,cellY:end.cellY},{cellX:end.cellX,cellY:p.cellY}])if(walk(p,bend)&&walk(bend,end))paths.push([p,bend,end]);
 }return paths;};
 for(const prefix of starts)for(const link of connect(prefix.at(-1)!)){
  const p=link.at(-1)!,x=Math.round(p.cellX*8),y=Math.round(p.cellY*8),id=y*w+x,g=routeLength(prefix,field)+routeLength(link,field);
  if(g>=(best.get(id)??Infinity))continue;best.set(id,g);queue.push({id,x,y,g,f:g+heuristic(x,y),parent:null,prefix:[...prefix,...link.slice(1)]});
 }
 const exits=new Map<number,TravelCell[][]>();
 for(const path of goals)for(const link of connect(path[0]!)){const p=link.at(-1)!,id=Math.round(p.cellY*8)*w+Math.round(p.cellX*8),tail=[...link.slice().reverse(),...path.slice(1)],list=exits.get(id)??[];list.push(tail);exits.set(id,list);}
 let visited=0;
 while(queue.size){
  if(visited>=q.limits.maxNodes||now()-started>=q.limits.maxDurationMs)return{kind:'budget-exceeded',visited};
  const current=queue.pop();if(closed.has(current.id)||current.g!==best.get(current.id))continue;closed.add(current.id);visited++;
  const tails=exits.get(current.id);
  if(tails?.length){
   const nodes:TravelCell[]=[];let e:Entry|null=current;while(e?.parent){nodes.push(point(e.x,e.y));e=e.parent;}
   const tail=tails.reduce((a,b)=>routeLength(a,field)<=routeLength(b,field)?a:b);
   const path=[...e!.prefix,...nodes.reverse(),...tail.slice(1)].filter((p,i,a)=>!i||p.cellX!==a[i-1]!.cellX||p.cellY!==a[i-1]!.cellY);
   if(path.length>8192)return{kind:'budget-exceeded',visited};
   return{kind:'found',contextId:q.contextId,policyVersion:q.policyVersion,movementProfileId:q.movementProfileId,traversalConstraintsId:q.traversalConstraintsId,path,length:routeLength(path,field),cost:current.g+routeLength(tail,field),visited};
  }
  const a=point(current.x,current.y),centred=current.x%8===0&&current.y%8===0;
  for(const [dx,dy]of [[1,0],[0,1],[-1,0],[0,-1]] as const){
   const long=point(current.x+dx*8,current.y+dy*8);
   // Long edges accelerate the centre lattice; fine edges remain available for
   // off-centre destinations and side entrances even when a long edge is clear.
   for(const step of centred&&walk(a,long)?[8,1]:[1]){
   const x=wrap(current.x+dx*step,w),y=wrap(current.y+dy*step,h),id=y*w+x,b=point(x,y);
   if(closed.has(id)||!walk(a,b))continue;
   const cost=field.cost?.(a,b)??routeLength([a,b],field),g=current.g+cost;
   if(g>=(best.get(id)??Infinity))continue;best.set(id,g);queue.push({id,x,y,g,f:g+heuristic(x,y),parent:current,prefix:[]});
   }
  }
 }
 // A finite grid misses some off-grid passages; no physical impossibility claim.
 return{kind:'budget-exceeded',visited};
}
/** Expand actual travelled centre-lines into canonical visited cells, without revealing search nodes. */
export function travelledCells(path:readonly TravelCell[],world:{widthCells:number;heightCells:number}):TravelCell[]{
 const result:TravelCell[]=[],seen=new Set<string>();const add=(x:number,y:number)=>{const p={cellX:wrap(Math.floor(x+.5),world.widthCells),cellY:wrap(Math.floor(y+.5),world.heightCells)},k=p.cellX+':'+p.cellY;if(!seen.has(k)){seen.add(k);result.push(p);}};
 if(path[0])add(path[0].cellX,path[0].cellY);
 for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!,dx=spawnDelta(b.cellX,a.cellX,world.widthCells),dy=spawnDelta(b.cellY,a.cellY,world.heightCells),steps=Math.max(1,Math.ceil((Math.abs(dx)+Math.abs(dy))*8));for(let j=1;j<=steps;j++)add(a.cellX+dx*j/steps,a.cellY+dy*j/steps);}
 return result;
}
