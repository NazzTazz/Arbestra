import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { TravelCell, VillageState, GardenHarvestStop } from '@arbestra/contracts';
import { WorkerTraffic, WORKER_STEP, WORKER_REBUILD_MS, pathLength, sampleWorkerPath, workerAppearance, gardenHarvestPoint,
  type TrafficActor, type WorkerPoint, type WorkerRole } from './worker-motion';
import { worksiteLayout, worksiteConnector, type WorksiteLayout } from './worksite-layout';
import {idleTour,idleTourPhase,type IdleLeg,type IdleVisit} from './idle-tour';

interface Materials { skin:StandardMaterial[]; clothes:StandardMaterial[]; hair:StandardMaterial[]; pants:StandardMaterial; timber:StandardMaterial; stone:StandardMaterial; }
export interface WorkerHooks {
  path:(path:TravelCell[])=>Vector3[];
  project:(point:TravelCell)=>WorkerPoint;
  ground:(point:WorkerPoint)=>number|null;
  free:(point:WorkerPoint,radius:number,featureId:string|null)=>boolean;
  key:(point:WorkerPoint)=>string;
  detailed:(point:WorkerPoint)=>boolean;
  width?:(point:WorkerPoint)=>number;
  localPath?:(path:TravelCell[])=>Vector3[];
  leisurePath?:(buildingId:string,path:TravelCell[])=>Vector3[];
}
interface Mission { id:string; key:string; resource:'wood'|'stone'|'garden'|'idle'; count:number;
  featureId:string|null; path:TravelCell[]; target:TravelCell; startedAt:number; completesAt:number; transportMs:number;
  stops?:GardenHarvestStop[];returnPath?:TravelCell[];leisure?:IdleLeg[]; }
type Phase='outbound'|'install'|'rotate'|'work'|'load'|'inbound'|'inside'|'done';
export interface VillageWorkerFigure {root:TransformNode; dispose:()=>void;}
interface Person extends VillageWorkerFigure {actor:TrafficActor; index:number; role:WorkerRole; phase:Phase;
  phaseAt:number; arrivedAt:number; limbs:TransformNode[]; tool:TransformNode; cargo:TransformNode;
  meshes:Mesh[]; angle:number; fade:number; visible:boolean; walk:number; last:WorkerPoint; previous:WorkerPoint; working:boolean; connectorRetry:number; }
interface Group {mission:Mission; people:Person[]; route:WorkerPoint[]; layout:WorksiteLayout;
  root:TransformNode; saws:Mesh[]; blocks:Mesh[]; retired:boolean; createdAt:number; rebuildAt:number|null;stop:number; }

/** All positions and short visual tails live here; no economic writes or timers. */
export class VillageWorkers {
  readonly #groups=new Map<string,Group>();
  readonly #latest=new Map<string,Mission>();
  readonly #traffic=new WorkerTraffic();
  #lastNow:number|null=null;
  #accumulator=0;
  #graphDirty=true;
  #lastAnimation=0;
  #boxSource:Mesh|null=null;
  readonly #costs:number[]=[];
  readonly #finished=new Set<string>();
  readonly #pending=new Set<string>();
  #identity:string|null=null;
  constructor(readonly scene:Scene,readonly materials:Materials,readonly hooks:WorkerHooks){}
  get figures():VillageWorkerFigure[]{return [...this.#groups.values()].flatMap(g=>g.people);}
  get metrics(){return {figures:this.figures.length,idleRepresentatives:[...this.#groups.values()].filter(g=>g.mission.resource==='idle').length,blocked:this.#traffic.blocked,pending:this.#pending.size,
    updateMs:this.#costs.length?this.#costs.reduce((a,b)=>a+b,0)/this.#costs.length:0,
    maxUpdateMs:Math.max(0,...this.#costs),
    layouts:[...this.#groups.values()].map(g=>({id:g.mission.id,resource:g.mission.resource,variant:g.layout.variant,roles:g.people.map(p=>p.role),phases:g.people.map(p=>p.phase)}))};}

  sync(state:VillageState,now:number) {
    const identity=`${state.world.id}:${state.village.id}`;
    if(this.#identity!==null&&this.#identity!==identity){
      for(const g of this.#groups.values())this.#disposeGroup(g);
      this.#groups.clear();this.#latest.clear();this.#finished.clear();this.#pending.clear();this.#traffic.reset();
      this.#lastNow=null;this.#accumulator=0;this.#graphDirty=true;
    }this.#identity=identity;
    const sites=new Map(state.village.worksites.flatMap(s=>s.activeExtraction?[[s.activeExtraction.id,s.id] as const]:[]));
    const missions:Mission[]=state.village.extractions.map(e=>({id:e.id,key:`${state.world.id}:${state.village.id}:${sites.get(e.id)??e.id}`,
      resource:e.resourceCode==='wood'?'wood':'stone',count:e.workerCount,featureId:e.featureId,path:e.path,target:e,
      startedAt:Date.parse(e.startedAt),completesAt:Date.parse(e.completesAt),transportMs:e.transportMs}));
    for(const cell of state.cells)for(const plot of cell.building?.garden?.plots??[])if(plot.harvest){const h=plot.harvest;
      missions.push({id:h.id,key:`${state.world.id}:${state.village.id}:${h.id}`,resource:'garden',count:1,featureId:null,
        path:h.path,target:h.stops?.[0]??plot,startedAt:Date.parse(h.startedAt),completesAt:Date.parse(h.completesAt),transportMs:h.transportMs,
        ...(h.stops?.length?{stops:h.stops,returnPath:h.returnPath??[]}: {})});}
    missions.push(...this.#idleMissions(state));
    this.#latest.clear();for(const m of missions)this.#latest.set(m.key,m);
    for(const key of this.#pending)if(!this.#latest.has(key))this.#pending.delete(key);
    for(const id of this.#finished)if(!missions.some(m=>m.id===id))this.#finished.delete(id);
    for(const [key,g]of this.#groups){g.retired=this.#latest.get(key)?.id!==g.mission.id;
      if(g.mission.resource==='idle'){
        const next=this.#latest.get(key);if(!next){this.#disposeGroup(g);this.#groups.delete(key);this.#graphDirty=true;continue;}
        if(JSON.stringify(next.leisure)!==JSON.stringify(g.mission.leisure)){g.mission=next;this.#reconstructPerson(g.people[0]!,g,now);this.#graphDirty=true;}
      }
    }
    this.#admit(now);
  }
  #idleMissions(state:VillageState):Mission[]{
    if(!this.hooks.leisurePath)return [];
    const homes=state.cells.filter(c=>c.building?.status==='completed'&&['dwelling','town-hall'].includes(c.building.type));
    const visits:IdleVisit[]=homes.flatMap(c=>{
      const route=state.travelRoutes.find(r=>r.kind==='building'&&r.destination.cellX===c.cellX&&r.destination.cellY===c.cellY);
      const path=c.building!.type==='town-hall'?[c]:route?.cells;
      if(!path)return [];const points=this.hooks.leisurePath!(c.building!.id,path);
      return points.length?[{buildingId:c.building!.id,path:points.map((v,i)=>this.#point(v,i===0||i===points.length-1?.5:this.hooks.width?.(v)??.8))}]:[];
    }).sort((a,b)=>a.buildingId.localeCompare(b.buildingId));
    const result:Mission[]=[];let left=Math.min(8,Math.ceil((state.village.population?.available??0)/15));
    const cohorts=(state.village.population?.cohorts??[]).filter(c=>c.activity==='idle').sort((a,b)=>b.memberCount-a.memberCount||a.id.localeCompare(b.id));
    for(const cohort of cohorts){
      const count=Math.min(left,Math.ceil(cohort.memberCount/15));
      for(let i=0;i<count;i++){
        const key=`${state.world.id}:${state.village.id}:idle:${cohort.id}:${i}`,leisure=idleTour(visits,key);if(!leisure.length)continue;
        result.push({id:key,key,resource:'idle',count:1,featureId:null,path:[],target:{cellX:0,cellY:0},startedAt:0,completesAt:Infinity,transportMs:0,leisure});
      }left-=count;if(left<=0)break;
    }return result;
  }
  #admit(now:number){
    for(const [key,mission]of this.#latest) {
      if(this.#finished.has(mission.id))continue;
      const old=this.#groups.get(key);
      if(old){if(old.mission.id!==mission.id)this.#pending.add(key);continue;}
      this.#pending.delete(key);this.#groups.set(key,this.#create(mission,now));this.#graphDirty=true;
    }
  }
  #point(p:WorkerPoint,width=.8):WorkerPoint{return {x:p.x,z:p.z,width,key:this.hooks.key(p)};}
  #route(m:Mission,stop=0){if(m.leisure)return m.leisure[stop]!.path.map(p=>this.#point(p,p.width));
    const path=m.stops?.[stop]?.path??m.path;
    const vectors=stop>0?(this.hooks.localPath??this.hooks.path)(path):this.hooks.path(path);
    const p=vectors.map((v,i)=>this.#point(v,stop===0&&i<2?.5:this.hooks.width?.(v)??.8));
    if(!p.length)p.push(this.#point(this.hooks.project(m.target)));
    if(m.resource!=='garden'&&p.length>1){const a=p[p.length-2]!,b=p[p.length-1]!,length=Math.hypot(b.x-a.x,b.z-a.z);
      if(length>.95){b.x-=(b.x-a.x)/length*.95;b.z-=(b.z-a.z)/length*.95;b.key=this.hooks.key(b);}}
    return p;
  }
  #layout(m:Mission,route:WorkerPoint[],stop=0){if(m.resource==='idle'){const end=route[route.length-1]!;return {stations:[{...end,role:'walk' as const,facing:0,pair:-1}],approach:end,variant:'front' as const};}
    const target=this.hooks.project(m.stops?.[stop]??m.target),last=route[Math.max(0,route.length-2)]??target;
    return worksiteLayout(m.resource,m.count,target,last,(p,r)=>this.hooks.free(p,r,m.featureId)
      &&![...this.#groups.values()].some(g=>g.mission.id!==m.id&&g.layout.stations.some(s=>Math.hypot(p.x-s.x,p.z-s.z)<r+.27)));}
  #create(mission:Mission,now:number):Group {
    const stop=mission.stops?Math.max(0,mission.stops.findIndex(s=>now<mission.startedAt+s.workEndsAfterMs)):0;
    const route=this.#route(mission,stop),layout=this.#layout(mission,route,stop),root=new TransformNode(`worksite-${mission.id}`,this.scene);
    const group:Group={mission,route,layout,root,people:[],saws:[],blocks:[],retired:false,createdAt:now,rebuildAt:null,stop};
    for(let i=0;i<mission.count;i++)group.people.push(this.#person(group,i,now));
    this.#props(group);return group;
  }
  #box(name:string,w:number,h:number,d:number,x:number,y:number,z:number,material:StandardMaterial,parent:TransformNode) {
    this.#boxSource??=MeshBuilder.CreateBox('worker-box-geometry',{size:1},this.scene);
    this.#boxSource.setEnabled(false);
    const mesh=this.#boxSource.clone(name,parent)!;mesh.setEnabled(true);mesh.scaling.set(w,h,d);
    mesh.position.set(x,y,z);mesh.material=material;mesh.isPickable=false;return mesh;
  }
  #person(group:Group,index:number,now:number):Person {
    const m=group.mission,appearance=workerAppearance(m.key,index),root=new TransformNode(`worker-${m.id}-${index}`,this.scene);
    const meshes:Mesh[]=[],skin=this.materials.skin[appearance.skin]!,clothes=this.materials.clothes[appearance.clothes]!,hair=this.materials.hair[appearance.hair]!;
    const box=(name:string,w:number,h:number,d:number,x:number,y:number,z:number,mat:StandardMaterial,parent=root)=>{const mesh=this.#box(`${root.name}-${name}`,w,h,d,x,y,z,mat,parent);meshes.push(mesh);return mesh;};
    box('body',.24,.27,.15,0,.15,0,clothes);box('head',.15,.15,.15,0,.36,0,skin);
    box('hair',.16,.045,.16,0,.45,0,hair);box('face',.055,.035,.012,0,.34,.08,hair);
    const limbs:TransformNode[]=[];
    for(const side of [-1,1]){const arm=new TransformNode(`${root.name}-arm`,this.scene);arm.parent=root;arm.position.set(side*.16,.27,0);box('arm',.075,.22,.075,0,-.11,0,clothes,arm);limbs.push(arm);}
    for(const side of [-1,1]){const leg=new TransformNode(`${root.name}-leg`,this.scene);leg.parent=root;leg.position.set(side*.065,.015,0);box('leg',.085,.21,.09,0,-.105,0,this.materials.pants,leg);limbs.push(leg);}
    const role=group.layout.stations[index]!.role,tool=new TransformNode(`${root.name}-tool`,this.scene);tool.parent=limbs[1]!;
    box('handle',.035,.32,.035,0,-.18,.03,this.materials.timber,tool);
    box('tool-head',role==='pick'?.3:.15,.07,.05,.04,-.33,.03,this.materials.stone,tool);
    const cargo=new TransformNode(`${root.name}-cargo`,this.scene);cargo.parent=root;
    if(m.resource==='wood') {const log=MeshBuilder.CreateCylinder(`${root.name}-log`,{height:.42,diameter:.12,tessellation:6},this.scene);
      log.parent=cargo;log.rotation.x=Math.PI/2;log.position.set(.17,.24,0);log.material=this.materials.timber;log.isPickable=false;meshes.push(log);}
    else box('basket',.22,.2,.2,.18,.19,.02,this.materials.timber,cargo);
    tool.setEnabled(false);cargo.setEnabled(false);root.setEnabled(false);
    const startAt=m.startedAt+Math.floor(index/2)*.23*1000,actor:TrafficActor={id:root.name,mission:m.id,rank:Math.floor(index/2),member:index%2,formation:0,direction:1,
      path:group.route,distance:0,speed:Math.max(.8,pathLength(group.route)/Math.max(.5,m.transportMs/1000)),position:{...group.route[0]!},visible:false,
      waitingSince:null,startAt,done:false};
    const person:Person={root,dispose:()=>root.dispose(false,false),actor,index,role,phase:'outbound',phaseAt:startAt,arrivedAt:0,
      limbs,tool,cargo,meshes,angle:0,fade:0,visible:false,walk:index*.9,last:{...actor.position},previous:{...actor.position},working:false,connectorRetry:0};
    this.#reconstructPerson(person,group,now);return person;
  }
  #reconstructPerson(p:Person,g:Group,now:number) {
    const m=g.mission,outEnd=m.startedAt+m.transportMs,backStart=m.completesAt-m.transportMs;
    p.actor.waitingSince=null;p.actor.done=false;p.actor.visible=false;p.actor.member=p.index%2;p.actor.formation=0;p.visible=false;p.fade=0;
    if(m.leisure){const current=idleTourPhase(m.leisure,now,m.key);g.stop=current.leg;g.route=this.#route(m,g.stop);g.layout=this.#layout(m,g.route,g.stop);
      p.phase=current.inside?'inside':'outbound';p.phaseAt=current.nextAt;p.working=false;p.actor.path=g.route;p.actor.speed=.75;p.actor.direction=1;
      p.actor.distance=pathLength(g.route)*current.progress;p.actor.position=sampleWorkerPath(g.route,p.actor.distance);p.actor.done=current.inside;
      p.actor.startAt=now;p.actor.visible=!current.inside;p.last={...p.actor.position};p.previous={...p.actor.position};return;}
    if(now>=m.completesAt+WORKER_REBUILD_MS){p.phase='done';return;}
    if(m.stops?.length){
      const last=m.stops[m.stops.length-1]!;
      if(now>=m.startedAt+last.workEndsAfterMs){p.phase='inbound';p.actor.direction=-1;p.actor.path=this.#backRoute(g);
        const duration=Math.max(1,m.completesAt-m.startedAt-last.workEndsAfterMs);p.actor.speed=pathLength(p.actor.path)/(duration/1000);
        p.actor.distance=Math.min(pathLength(p.actor.path),p.actor.speed*(now-m.startedAt-last.workEndsAfterMs)/1000);p.actor.startAt=now;
      }else {
        g.stop=m.stops.findIndex(s=>now<m.startedAt+s.workEndsAfterMs);const stop=m.stops[g.stop]!;
        g.route=this.#route(m,g.stop);g.layout=this.#layout(m,g.route,g.stop);
        const legStart=m.stops[g.stop-1]?.workEndsAfterMs??0,legMs=Math.max(1,stop.arrivesAfterMs-legStart);
        p.arrivedAt=m.startedAt+stop.arrivesAfterMs;p.actor.direction=1;p.actor.member=0;p.actor.rank=0;p.actor.startAt=now;
        if(now<m.startedAt+stop.arrivesAfterMs){p.phase='outbound';p.actor.path=g.route;p.actor.speed=pathLength(g.route)/(legMs/1000);
          p.actor.distance=Math.max(0,p.actor.speed*(now-m.startedAt-legStart)/1000);}
        else{p.phase='work';p.actor.position={...this.#post(p,g,now)};p.actor.done=true;p.actor.visible=true;p.working=true;}
      }
      if(p.phase!=='work')p.actor.position=sampleWorkerPath(p.actor.path,p.actor.distance);
      p.last={...p.actor.position};p.previous={...p.actor.position};return;
    }
    if(now>=backStart){p.phase='inbound';p.actor.direction=-1;p.actor.path=[...g.route].reverse();p.actor.distance=Math.max(0,Math.min(pathLength(g.route),p.actor.speed*(now-backStart)/1000-Math.floor(p.index/2)*.52));p.actor.startAt=now;}
    else if(now>=outEnd){p.phase='work';p.phaseAt=now;p.arrivedAt=outEnd;p.actor.position={...this.#post(p,g,now)};p.actor.visible=true;p.actor.member=0;p.actor.done=true;}
    else {p.phase='outbound';p.actor.path=g.route;p.actor.direction=1;p.actor.distance=Math.max(0,p.actor.speed*(now-m.startedAt)/1000-Math.floor(p.index/2)*.52);p.actor.startAt=Math.max(now,m.startedAt+Math.floor(p.index/2)*230);}
    if(p.phase==='outbound'||p.phase==='inbound')p.actor.position=sampleWorkerPath(p.actor.path,p.actor.distance);
    p.last={...p.actor.position};p.previous={...p.actor.position};
  }
  #backRoute(g:Group):WorkerPoint[]{
    if(g.mission.returnPath?.length)return this.hooks.path([...g.mission.returnPath].reverse()).reverse().map(v=>this.#point(v));
    return [...g.route].reverse();
  }
  #post(p:Person,g:Group,now:number):WorkerPoint {
    if(g.mission.resource==='garden'){
      const stop=g.mission.stops?.[g.stop],start=g.mission.startedAt+(stop?.arrivesAfterMs??g.mission.transportMs);
      const end=stop?g.mission.startedAt+stop.workEndsAfterMs:g.mission.completesAt-g.mission.transportMs;
      p.working=true;return gardenHarvestPoint(g.layout.stations[p.index]!, (now-start)/Math.max(1,end-start));
    }
    const station=g.layout.stations[p.index]!;
    if(!station.workAt||!station.slot){p.working=g.layout.variant!=='blocked';return station;}
    const peers=g.people.filter(v=>g.layout.stations[v.index]!.slot===station.slot);
    // Two seconds empty between turns gives the outgoing worker room to leave.
    const elapsed=Math.max(0,now-g.mission.startedAt-g.mission.transportMs),turn=Math.floor(elapsed/12_000);
    p.working=elapsed%12_000>=2_000&&peers[turn%Math.max(1,peers.length)]?.index===p.index;
    return p.working?station.workAt:station;
  }
  #props(g:Group){
    const m=g.mission;
    if(m.resource==='garden'||m.resource==='idle')return;
    const sawPairs=new Map<number,WorkerPoint[]>();
    for(const s of g.layout.stations)if(s.role==='saw'&&(g.layout.variant!=='compact'||s.pair===0)){const points=sawPairs.get(s.pair)??[];points.push(s.workAt??s);sawPairs.set(s.pair,points);}
    for(const [pair,points]of sawPairs){if(points.length<2)continue;const a=points[0]!,b=points[1]!,x=(a.x+b.x)/2,z=(a.z+b.z)/2;
      const saw=this.#box(`saw-${m.id}-${pair}`,Math.hypot(a.x-b.x,a.z-b.z)+.06,.05,.018,x,.58,z,this.materials.stone,g.root);
      saw.rotation.y=-Math.atan2(b.z-a.z,b.x-a.x);saw.metadata={x,z,pair};g.saws.push(saw);
      const trunk=MeshBuilder.CreateCylinder(`work-trunk-${m.id}-${pair}`,{height:.9,diameter:.19,tessellation:6},this.scene);
      trunk.parent=g.root;trunk.rotation.x=Math.PI/2;trunk.position.set(x,.28,z);trunk.material=this.materials.timber;trunk.isPickable=false;g.blocks.push(trunk);
    }
    const owned=new Set<string>();
    for(const [i,s]of g.layout.stations.entries())if((['wood-chop','break','carry'].includes(s.role)||m.resource==='wood'&&m.count<=2&&i===0||m.resource==='stone'&&m.count===1)&&(!s.slot||!owned.has(s.slot))){
      if(s.slot)owned.add(s.slot);const at=s.workAt??s;
      const block=this.#box(`work-block-${m.id}-${i}`,.23,.15,.25,at.x+Math.sin(s.facing)*.32,.12,at.z+Math.cos(s.facing)*.32,
        m.resource==='wood'?this.materials.timber:this.materials.stone,g.root);block.metadata={station:i};g.blocks.push(block);
    }
    g.root.setEnabled(false);
  }

  reproject(){
    for(const g of this.#groups.values()){
      if(g.mission.leisure)continue; // Canonical spokes are refreshed by sync; shift translates live paths.
      const prior=g.route[0]!,route=this.#route(g.mission,g.stop),shift={x:prior.x-route[0]!.x,z:prior.z-route[0]!.z};
      for(const p of g.people){p.actor.position.x-=shift.x;p.actor.position.z-=shift.z;p.last.x-=shift.x;p.last.z-=shift.z;p.previous.x-=shift.x;p.previous.z-=shift.z;}
      const routeChanged=JSON.stringify(g.route)!==JSON.stringify(route);
      g.route=route;const oldLayout=g.layout;g.layout=this.#layout(g.mission,route,g.stop);
      if(routeChanged)for(const p of g.people){if(p.phase==='outbound')p.actor.path=route;else if(p.phase==='inbound')p.actor.path=this.#backRoute(g);}
      // Props retain their local template; translate only on coordinate rebasing.
      g.root.position.x-=shift.x;g.root.position.z-=shift.z;
      if(JSON.stringify(oldLayout.stations)!==JSON.stringify(g.layout.stations)){
        for(const mesh of g.root.getChildMeshes())mesh.dispose(false,false);g.saws=[];g.blocks=[];g.root.position.setAll(0);this.#props(g);
        for(const p of g.people){p.fade=0;if(p.phase==='work'){
          p.actor.position={...this.#post(p,g,this.#lastNow??g.createdAt)};p.actor.done=true;p.last={...p.actor.position};p.previous={...p.actor.position};
        }}
      }
    }this.#graphDirty=true;
  }
  shift(x:number,z:number){for(const g of this.#groups.values()){
    // Connector endpoints can alias route points or stations; translate once.
    const points=new Set<WorkerPoint>([...g.route,...g.layout.stations,g.layout.approach,...(g.mission.leisure?.flatMap(l=>l.path)??[]),...g.people.flatMap(p=>p.actor.path),
      ...g.layout.stations.flatMap(s=>s.workAt?[s.workAt]:[])]);
    for(const q of points){q.x-=x;q.z-=z;}g.root.position.x-=x;g.root.position.z-=z;
    for(const p of g.people){p.actor.position.x-=x;p.actor.position.z-=z;p.last.x-=x;p.last.z-=z;p.previous.x-=x;p.previous.z-=z;p.root.position.x-=x;p.root.position.z-=z;
      }}
    this.#graphDirty=true;
  }

  #transition(p:Person,g:Group,now:number){
    const station=g.layout.stations[p.index]!,m=g.mission;
    if(m.leisure){
      if(p.phase==='outbound'&&p.actor.done){p.phase='inside';p.phaseAt=Math.max(now+4000,p.phaseAt);p.actor.visible=false;}
      if(p.phase==='inside'&&now>=p.phaseAt){this.#reconstructPerson(p,g,now);this.#graphDirty=true;}
      return;
    }
    if(p.phase==='outbound'&&p.actor.done&&now>=p.connectorRetry){
      const from={...p.actor.position},target=this.hooks.project(m.target);
      const connector=m.resource==='garden'?[from,station]:worksiteConnector(from,station,target,(q,r)=>this.hooks.free(q,r,m.featureId));
      if(!connector){p.connectorRetry=now+1000;p.actor.waitingSince??=now;return;}
      p.phase='install';p.phaseAt=now;p.arrivedAt=now;p.actor.waitingSince=null;p.actor.path=connector;
      p.actor.distance=0;p.actor.done=false;p.actor.member=0;p.actor.formation=0;p.actor.startAt=now;p.actor.rank=100+p.index;p.actor.speed=1.6;}
    else if((p.phase==='install'||p.phase==='rotate')&&p.actor.done){p.phase='work';p.phaseAt=now;}
    if(p.phase==='work'&&m.resource==='garden'){
      p.actor.position=this.#post(p,g,now);p.actor.visible=true;
    }else if(p.phase==='work'&&g.layout.variant==='compact'){
      const destination=this.#post(p,g,now);
      if(Math.hypot(destination.x-p.actor.position.x,destination.z-p.actor.position.z)>.05&&now>=p.connectorRetry){
        const connector=worksiteConnector(p.actor.position,destination,this.hooks.project(m.target),(q,r)=>this.hooks.free(q,r,m.featureId));
        if(!connector){p.connectorRetry=now+1000;p.working=false;p.actor.waitingSince??=now;return;}
        p.phase='rotate';p.actor.path=connector;p.actor.distance=0;p.actor.done=false;
        p.actor.startAt=now;p.actor.member=0;p.actor.speed=1;p.actor.rank=100+p.index;
      }
    }else if(p.phase==='work')p.working=g.layout.variant!=='blocked';
    if(p.phase==='work'&&p.role==='carry'&&p.actor.done&&p.working&&g.layout.variant!=='compact'){
      const fx=Math.sin(station.facing),fz=Math.cos(station.facing),from={...p.actor.position},target=this.hooks.project(m.target);
      const side=(station.x-target.x)*Math.cos(station.facing)-(station.z-target.z)*Math.sin(station.facing)<0?-1:1;
      // Carry outside the processing line instead of walking through its workers.
      const lane={x:station.x+Math.cos(station.facing)*side*1.2,z:station.z-Math.sin(station.facing)*side*1.2};
      const back={x:lane.x-fx*.8,z:lane.z-fz*.8},forward={x:lane.x+fx*.65,z:lane.z+fz*.65};
      if(now>=p.connectorRetry){
        const route:WorkerPoint[]=[from];
        for(const stop of [lane,back,forward,lane,station]){
          const connector=worksiteConnector(route[route.length-1]!,stop,target,(q,r)=>this.hooks.free(q,r,m.featureId));
          if(!connector){route.length=0;break;}route.push(...connector.slice(1));
        }
        if(route.length){p.actor.path=route;p.actor.distance=0;p.actor.done=false;p.actor.visible=true;p.actor.member=0;
          p.actor.startAt=now;p.actor.speed=1;p.actor.rank=100+p.index;}
        else {p.working=false;p.actor.waitingSince??=now;p.connectorRetry=now+1000;}
      }else p.working=false;
    }
    if(p.phase==='work'&&m.stops?.length&&g.stop<m.stops.length-1&&now>=Math.max(m.startedAt+m.stops[g.stop]!.workEndsAfterMs,p.arrivedAt+600)){
      g.stop++;g.route=this.#route(m,g.stop);g.layout=this.#layout(m,g.route,g.stop);this.#graphDirty=true;
      const stop=m.stops[g.stop]!,legMs=stop.arrivesAfterMs-m.stops[g.stop-1]!.workEndsAfterMs;
      p.phase='outbound';p.actor.path=g.route;p.actor.distance=0;p.actor.done=false;p.actor.startAt=now;p.actor.member=0;
      p.actor.speed=pathLength(g.route)/Math.max(.5,legMs/1000);p.actor.direction=1;p.actor.rank=0;return;
    }
    const returnAt=m.stops?.length?m.startedAt+m.stops[m.stops.length-1]!.workEndsAfterMs:m.completesAt-m.transportMs;
    if((p.phase==='work'||p.phase==='rotate')&&now>=Math.max(returnAt,p.arrivedAt+600)){p.phase='load';p.phaseAt=now;}
    if(p.phase==='load'&&now-p.phaseAt>=450&&now>=p.connectorRetry){
      const back=this.#backRoute(g),connector=m.resource==='garden'?[{...p.actor.position},back[0]!]:worksiteConnector(p.actor.position,back[0]!,this.hooks.project(m.target),(q,r)=>this.hooks.free(q,r,m.featureId));
      if(!connector){p.connectorRetry=now+1000;p.actor.waitingSince??=now;return;}
      p.phase='inbound';p.phaseAt=now;p.actor.path=[...connector,...back.slice(1)];
      p.actor.distance=0;p.actor.done=false;p.actor.member=p.index%2;p.actor.formation=0;p.actor.startAt=now+Math.floor(p.index/2)*120;p.actor.direction=-1;p.actor.rank=Math.floor(p.index/2);
      p.actor.speed=Math.max(.8,pathLength(back)/Math.max(.5,(m.stops?.length?m.completesAt-returnAt:m.transportMs)/1000));}
    if(p.phase==='inbound'&&p.actor.done){p.phase='done';p.root.setEnabled(false);p.actor.visible=false;}
  }
  animate(now:number,enabled:boolean){
    const start=performance.now();this.#animate(now,enabled);
    if(enabled){this.#costs.push(performance.now()-start);if(this.#costs.length>120)this.#costs.shift();}
  }
  #animate(now:number,enabled:boolean){
    if(!enabled){for(const g of this.#groups.values()){g.root.setEnabled(false);for(const p of g.people)p.root.setEnabled(false);}this.#lastNow=null;return;}
    const elapsed=this.#lastNow===null?0:Math.max(0,(now-this.#lastNow)/1000);
    const resumed=this.#lastNow===null||elapsed>1;
    this.#lastNow=now;
    if(resumed){this.#traffic.reset();for(const g of this.#groups.values())for(const p of g.people)this.#reconstructPerson(p,g,now);this.#graphDirty=true;}
    this.#accumulator+=Math.min(elapsed,.133);
    if(this.#graphDirty){this.#traffic.rebuild([...this.#groups.values()].flatMap(g=>g.mission.stops?.length
      ? [...g.mission.stops.map((_,i)=>this.#route(g.mission,i)),this.#backRoute(g)] : g.mission.leisure?.map(l=>l.path)??[g.route]));this.#graphDirty=false;}
    for(const g of this.#groups.values()) {
      const late=g.people.some(p=>p.phase!=='done'&&((p.actor.waitingSince!==null&&now-p.actor.waitingSince>WORKER_REBUILD_MS)||(g.retired&&now-g.mission.completesAt>WORKER_REBUILD_MS)));
      if(late&&g.rebuildAt===null)g.rebuildAt=now;
      if(g.rebuildAt!==null&&now-g.rebuildAt>350){for(const p of g.people)this.#reconstructPerson(p,g,now);g.rebuildAt=null;this.#traffic.reset();this.#graphDirty=true;}
    }
    let steps=0;
    while(this.#accumulator>=WORKER_STEP&&steps++<4){
      const actors:TrafficActor[]=[],stationary:WorkerPoint[]=[];
      for(const g of this.#groups.values())for(const p of g.people){p.previous={...p.actor.position};this.#transition(p,g,now);if(['outbound','install','rotate','inbound'].includes(p.phase)||p.phase==='work'&&p.role==='carry'&&g.layout.variant!=='blocked'&&g.layout.variant!=='compact')actors.push(p.actor);else if(p.phase==='work'||p.phase==='load')stationary.push(p.actor.position);}
      this.#traffic.step(actors,now,WORKER_STEP,stationary);this.#accumulator-=WORKER_STEP;
    }
    for(const [key,g]of this.#groups){
      if(g.people.every(p=>p.phase==='done')){this.#finished.add(g.mission.id);this.#disposeGroup(g);this.#groups.delete(key);this.#graphDirty=true;if(this.#latest.get(key)?.id===g.mission.id)this.#latest.delete(key);continue;}
      const working=g.people.some(p=>p.phase==='work'||p.phase==='load');g.root.setEnabled(working&&g.layout.variant!=='blocked');
      const detailed=this.hooks.detailed(g.layout.approach),animateLimbs=detailed||now-this.#lastAnimation>120;
      for(const p of g.people)this.#renderPerson(p,g,now,animateLimbs);
      for(const saw of g.saws){const meta=saw.metadata as {x:number;z:number;pair:number};const station=g.layout.stations.find(s=>s.role==='saw'&&s.pair===meta.pair)!;
        saw.setEnabled(g.people.some(p=>p.role==='saw'&&p.working&&p.phase==='work')&&(g.mission.count!==2||(now-g.mission.startedAt)%12_000<8_000));
        const height=this.hooks.ground(station);saw.isVisible=height!==null;saw.position.y=(height??0)+.43;
        saw.position.x=meta.x+Math.cos(station.facing+Math.PI/2)*Math.sin(now*.005+meta.pair)*.12;
        saw.position.z=meta.z+Math.sin(station.facing+Math.PI/2)*Math.sin(now*.005+meta.pair)*.12;}
      for(const block of g.blocks){const point={x:block.position.x+g.root.position.x,z:block.position.z+g.root.position.z},height=this.hooks.ground(point);
        block.isVisible=height!==null;block.position.y=(height??0)+.12;
        const index=(block.metadata as {station?:number}|null)?.station;
        if(index!==undefined&&g.people[index]?.role==='carry') {const p=g.people[index]!;block.position.x=p.actor.position.x-g.root.position.x+Math.sin(p.angle)*.29;block.position.z=p.actor.position.z-g.root.position.z+Math.cos(p.angle)*.29;}}
    }
    if(now-this.#lastAnimation>120)this.#lastAnimation=now;
    this.#admit(now);
  }
  #renderPerson(p:Person,g:Group,now:number,animateLimbs:boolean){
    if(p.phase==='done'||p.phase==='inside'){p.root.setEnabled(false);return;}
    const gardening=p.phase==='work'&&g.mission.resource==='garden';
    const travelling=gardening||['outbound','install','rotate','inbound'].includes(p.phase)||p.phase==='work'&&p.role==='carry'&&!p.actor.done;
    const alpha=travelling?Math.min(1,this.#accumulator/WORKER_STEP):1;
    const point={x:p.previous.x+(p.actor.position.x-p.previous.x)*alpha,z:p.previous.z+(p.actor.position.z-p.previous.z)*alpha},height=this.hooks.ground(point);
    p.visible=p.actor.visible&&height!==null;
    p.root.setEnabled(p.visible);if(!p.visible)return;
    const dx=point.x-p.last.x,dz=point.z-p.last.z,movement=Math.hypot(dx,dz);
    const moving=gardening||travelling&&!p.actor.done&&p.actor.waitingSince===null;
    if(movement>.00001)p.angle=Math.atan2(dx,dz);else if(!moving&&(p.phase==='work'||p.phase==='load'))p.angle=g.layout.stations[p.index]!.facing;
    const angleDelta=Math.atan2(Math.sin(p.angle-p.root.rotation.y),Math.cos(p.angle-p.root.rotation.y));p.root.rotation.y+=angleDelta*.22;
    p.root.position.set(point.x,(height??0)+.215,point.z);p.walk+=movement*6.3;
    p.last={...point};p.fade=Math.min(1,p.fade+.08);
    const opacity=g.rebuildAt!==null?Math.max(0,1-(now-g.rebuildAt)/350):p.fade;
    for(const mesh of p.meshes)mesh.visibility=opacity;
    const working=p.phase==='work'&&p.working&&g.layout.variant!=='blocked';
    const cycle=(now-g.mission.startedAt)%12_000;
    let role=p.role;
    if(working&&g.mission.resource==='stone'){
      if(g.mission.count===1)role=cycle<6_000?'pick':cycle<10_000?'break':'carry';
      else if(g.mission.count===2&&p.role==='break')role=cycle<8_000?'break':'carry';
    }else if(working&&g.mission.resource==='wood'&&g.mission.count<=2&&cycle>=8_000)role='wood-chop';
    const loaded=p.phase==='load'||p.phase==='inbound'||g.stop>0&&g.mission.resource==='garden'||working&&role==='carry'&&(p.role!=='carry'||p.actor.distance>1.25);
    p.cargo.setEnabled(loaded);p.tool.setEnabled(working&&role!=='saw'&&role!=='carry');
    if(!animateLimbs)return;
    const [left,right,legL,legR]=p.limbs;
    const swing=moving?Math.sin(p.walk)*.55:0;left!.rotation.set(swing,0,0);right!.rotation.set(-swing,0,0);
    legL!.rotation.x=-swing;legR!.rotation.x=swing;
    if(loaded){right!.rotation.x=-.9;left!.rotation.x=-.3;}
    if(working){const cadence=role==='break'?.0065:role==='wood-chop'?.0055:role==='garden'?.0035:.004;
      const phase=now*cadence+p.index*1.7;
      if(role==='saw'){const pair=g.layout.variant==='compact'?0:g.layout.stations[p.index]!.pair,v=Math.sin(now*.005+pair)*(p.index%2?-1:1);left!.rotation.x=-1.15+v*.2;right!.rotation.x=-1.15+v*.2;}
      else if(role==='carry'){left!.rotation.x=-.8;right!.rotation.x=-.8;}
      else {const strike=Math.pow((Math.sin(phase)+1)/2,2),arc=role==='break'?1.15:role==='garden'?.65:2.1;
        right!.rotation.x=-.2-strike*arc;left!.rotation.x=-.25-strike*arc*.43;}}
  }
  setVisibility(blend:number){for(const g of this.#groups.values()){for(const p of g.people)for(const mesh of p.meshes)mesh.visibility*=blend;for(const mesh of g.root.getChildMeshes())mesh.visibility=blend;}}
  #disposeGroup(g:Group){for(const p of g.people)p.dispose();g.root.dispose(false,false);}
  dispose(){for(const g of this.#groups.values())this.#disposeGroup(g);this.#boxSource?.dispose(false,false);this.#boxSource=null;this.#groups.clear();this.#latest.clear();this.#pending.clear();this.#finished.clear();this.#traffic.reset();}
}
