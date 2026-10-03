export interface WorkerPoint { x: number; z: number; width?: number; key?: string }
export type WorkerRole = 'axe' | 'saw' | 'wood-chop' | 'pick' | 'break' | 'carry' | 'garden' | 'walk';
export const WORKER_RADIUS = .18;
export const WORKER_GAP = .08;
export const WORKER_CLEARANCE = WORKER_RADIUS * 2 + WORKER_GAP;
export const WORKER_STEP = 1 / 30;
export const WORKER_REBUILD_MS = 8_000;

export function workerAppearance(key: string, index: number) {
  let seed = 2166136261;
  for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  // 7 is coprime with 45: one team never repeats a combination.
  const combination = ((seed >>> 0) % 45 + index * 7) % 45;
  return { skin: combination % 3, clothes: Math.floor(combination / 3) % 5, hair: Math.floor(combination / 15) };
}

export function workerRoles(resource: 'wood' | 'stone' | 'garden', count: number): WorkerRole[] {
  if (resource === 'garden') return Array.from({ length: count }, () => 'garden');
  if (resource === 'wood') {
    if (count === 1) return ['axe'];
    const saws = [0, 0, 2, 2, 2, 4, 4, 4, 6, 6, 6][Math.min(10, count)]!;
    return Array.from({ length: count }, (_, i) => i < saws ? 'saw' : 'wood-chop');
  }
  const distribution:readonly (readonly [number,number])[]=[[0,0],[1,0],[1,1],[1,1],[2,1],[2,2],[3,2],[3,2],[4,2],[4,3],[5,3]];
  const [picks, breaks] = distribution[Math.min(10,count)]!;
  return Array.from({ length: count }, (_, i) => i < picks ? 'pick' : i < picks + breaks ? 'break' : 'carry');
}

export function pathLength(path: readonly WorkerPoint[]) {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i]!.x-path[i-1]!.x,path[i]!.z-path[i-1]!.z);
  return length;
}

// Three crop rows along X, joined by rounded headland turns. Entry and exit
// stay at the plot centre so the road/plot connectors remain continuous.
const gardenSweep:WorkerPoint[]=[{x:0,z:0},{x:-.7,z:-.64},{x:.7,z:-.64}];
for(let i=1;i<=12;i++){const a=-Math.PI/2+i*Math.PI/12;gardenSweep.push({x:.7+Math.cos(a)*.32,z:-.32+Math.sin(a)*.32});}
gardenSweep.push({x:-.7,z:0});
for(let i=1;i<=12;i++){const a=-Math.PI/2-i*Math.PI/12;gardenSweep.push({x:-.7+Math.cos(a)*.32,z:.32+Math.sin(a)*.32});}
gardenSweep.push({x:.7,z:.64},{x:0,z:0});
const gardenSweepLength=pathLength(gardenSweep);
/** Pure visual progress on one plot; server work and credit times are unchanged. */
export function gardenHarvestPoint(centre:WorkerPoint,progress:number):WorkerPoint {
  const p=sampleWorkerPath(gardenSweep,Math.max(0,Math.min(1,progress))*gardenSweepLength);
  return {x:centre.x+p.x,z:centre.z+p.z};
}

function cycleKey(path:readonly WorkerPoint[]):string|null {
  if(path.length<4)return null;
  const key=(p:WorkerPoint)=>p.key??`${p.x.toFixed(3)}:${p.z.toFixed(3)}`;
  if(key(path[0]!)!==key(path[path.length-1]!))return null;
  const keys=path.slice(0,-1).map(key),first=keys.indexOf([...keys].sort()[0]!);
  return [...keys.slice(first),...keys.slice(0,first)].join('>');
}

export function sampleWorkerPath(path: readonly WorkerPoint[], distance: number, lateral = 0) {
  if (path.length < 2) return { ...(path[0] ?? {x:0,z:0}), dx:0, dz:1, corner:0 };
  let remaining = Math.max(0, distance);
  for (let i=1;i<path.length;i++) {
    const a=path[i-1]!, b=path[i]!, length=Math.hypot(b.x-a.x,b.z-a.z);
    if (length < .001) continue;
    if (remaining <= length || i === path.length-1) {
      const t=Math.min(1,remaining/length), dx=(b.x-a.x)/length, dz=(b.z-a.z)/length;
      const width=Math.min(a.width ?? .8,b.width ?? .8);
      const edge=Math.min(t*length,(1-t)*length);
      // Straight joins keep lanes; turns and doors narrow smoothly.
      const turnAt = (n:number) => {
        if (n===0 || n===path.length-1) return true;
        const p=path[n-1]!,q=path[n]!,r=path[n+1]!;
        return Math.abs((q.x-p.x)*(r.z-q.z)-(q.z-p.z)*(r.x-q.x))>.01;
      };
      const taper=Math.min(1,Math.min(turnAt(i-1)?t*length:1,turnAt(i)?(1-t)*length:1)/.7);
      const offset=Math.max(-width/2+WORKER_RADIUS,Math.min(width/2-WORKER_RADIUS,lateral))*taper;
      return {x:a.x+(b.x-a.x)*t+dz*offset,z:a.z+(b.z-a.z)*t-dx*offset,dx,dz,width,corner:edge};
    }
    remaining-=length;
  }
  return {...path[path.length-1]!,dx:0,dz:1,corner:0};
}

/** Minimum distance between synchronously moving discs, including between frames. */
export function sweptWorkerDistance(a:WorkerPoint,b:WorkerPoint,nextA:WorkerPoint,nextB:WorkerPoint) {
  const x=a.x-b.x,z=a.z-b.z,dx=nextA.x-a.x-(nextB.x-b.x),dz=nextA.z-a.z-(nextB.z-b.z);
  const d=dx*dx+dz*dz,t=d>1e-12?Math.max(0,Math.min(1,-(x*dx+z*dz)/d)):0;
  return Math.hypot(x+dx*t,z+dz*t);
}

export interface TrafficActor {
  id: string; mission: string; rank: number; direction: 1|-1;
  path: WorkerPoint[]; distance: number; speed: number;
  position: WorkerPoint; visible: boolean; waitingSince: number|null;
  startAt: number; done: boolean;
  member?:number; formation?:number;
}
interface Passage { id:string; points:WorkerPoint[]; owners:Set<string>; lastDirection:number; served:number; straight:boolean }

/** Local right-of-way only. This class never knows resources or server credits. */
export class WorkerTraffic {
  readonly passages = new Map<string,Passage>();
  blocked = 0;
  #waitOrder = new Map<string,number>();
  rebuild(paths: readonly WorkerPoint[][]) {
    const nodes=new Map<string,{point:WorkerPoint; links:Set<string>; turn:boolean}>();
    for(const path of paths) for(let i=0;i<path.length;i++) {
      const p=path[i]!,key=p.key ?? `${p.x.toFixed(3)}:${p.z.toFixed(3)}`;
      const node=nodes.get(key) ?? {point:p,links:new Set<string>(),turn:i===0||i===path.length-1};
      for(const n of [path[i-1],path[i+1]]) if(n) node.links.add(n.key ?? `${n.x.toFixed(3)}:${n.z.toFixed(3)}`);
      if(i>0&&i<path.length-1) {
        const a=path[i-1]!,b=path[i+1]!;
        node.turn ||= Math.abs((p.x-a.x)*(b.z-p.z)-(p.z-a.z)*(b.x-p.x))>.01;
      }
      nodes.set(key,node);
    }
    const conflicts=[...nodes.entries()].filter(([,n])=>n.turn||n.links.size>2||((n.point.width??.8)<.8));
    // A narrow segment is one exclusive passage, not two unrelated end gates.
    for(const path of paths)for(let i=1;i<path.length;i++){
      const a=path[i-1]!,b=path[i]!;
      if(Math.min(a.width??.8,b.width??.8)>=.8)continue;
      const steps=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.6),edge=[a.key??`${a.x}:${a.z}`,b.key??`${b.x}:${b.z}`].sort().join('~');
      for(let n=1;n<steps;n++){const t=n/steps,point={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,width:.5};
        const forward=(a.key??`${a.x}:${a.z}`)<(b.key??`${b.x}:${b.z}`);
        conflicts.push([`${edge}:${forward?n:steps-n}/${steps}`,{point,links:new Set(),turn:true}]);}
    }
    const clusters:Array<{keys:string[];points:WorkerPoint[]}>=[];
    for(const [key,n] of new Map(conflicts)) {
      const touching=clusters.filter(c=>c.points.some(p=>Math.hypot(p.x-n.point.x,p.z-n.point.z)<1.1));
      const cluster=touching[0]??{keys:[],points:[]};
      if(!touching.length) clusters.push(cluster);
      cluster.keys.push(key);cluster.points.push(n.point);
      for(const other of touching.slice(1)){cluster.keys.push(...other.keys);cluster.points.push(...other.points);clusters.splice(clusters.indexOf(other),1);}
    }
    const next=new Map<string,Passage>();
    for(const c of clusters){const id=c.keys.sort().join('|');const prior=this.passages.get(id),a=c.points[0]!,b=c.points.find(p=>Math.hypot(p.x-a.x,p.z-a.z)>.1)??a;
      const straight=c.points.length>2&&c.points.every(p=>Math.abs((b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x))<.01);
      next.set(id,{id,points:c.points,owners:prior?.owners??new Set(),lastDirection:prior?.lastDirection??0,served:prior?.served??0,straight});}
    this.passages.clear();for(const [id,p]of next)this.passages.set(id,p);
  }
  shift(x:number,z:number){for(const passage of this.passages.values())for(const p of passage.points){p.x-=x;p.z-=z;}}
  reset(){this.passages.clear();this.#waitOrder.clear();}
  step(actors:TrafficActor[],now:number,dt=WORKER_STEP,stationary:readonly WorkerPoint[]=[]) {
    this.blocked=0;
    const live=new Set(actors.filter(a=>!a.done).map(a=>a.id));
    for(const p of this.passages.values())for(const id of p.owners)if(!live.has(id)||!actors.some(a=>a.id===id&&p.points.some(q=>Math.hypot(a.position.x-q.x,a.position.z-q.z)<1.3)))p.owners.delete(id);
    const ordered=actors.filter(a=>!a.done&&now>=a.startAt).sort((a,b)=>{
      const engaged=(v:TrafficActor)=>[...this.passages.values()].some(p=>p.owners.has(v.id))?0:1;
      return engaged(a)-engaged(b)||(a.waitingSince??this.#waitOrder.get(a.id)??a.startAt)-(b.waitingSince??this.#waitOrder.get(b.id)??b.startAt)||a.direction-b.direction||a.id.localeCompare(b.id);
    });
    const grid=new Map<string,Array<{position:WorkerPoint;actor:TrafficActor|undefined}>>();
    const add=(position:WorkerPoint,actor?:TrafficActor)=>{const key=`${Math.floor(position.x)}:${Math.floor(position.z)}`;const bucket=grid.get(key)??[];bucket.push({position,actor});grid.set(key,bucket);};
    for(const a of actors)if(a.visible&&!a.done)add(a.position,a);
    for(const p of stationary)add(p);
    const neighbours=(p:WorkerPoint)=>{const out:Array<{position:WorkerPoint;actor:TrafficActor|undefined}>=[];for(let x=Math.floor(p.x)-1;x<=Math.floor(p.x)+1;x++)for(let z=Math.floor(p.z)-1;z<=Math.floor(p.z)+1;z++)out.push(...(grid.get(`${x}:${z}`)??[]));return out;};
    const processed=new Set<string>();
    for(const actor of ordered) {
      if(processed.has(actor.id))continue;
      const length=pathLength(actor.path);
      const base=sampleWorkerPath(actor.path,actor.distance);
      const opposite=actors.some(other=>other.visible&&other.mission!==actor.mission&&Math.hypot(other.position.x-actor.position.x,other.position.z-actor.position.z)<3&&(()=>{const v=sampleWorkerPath(other.path,other.distance);return v.dx*base.dx+v.dz*base.dz<-.5;})());
      const nearPassage=[...this.passages.values()].some(p=>p.points.some(q=>Math.hypot(q.x-base.x,q.z-base.z)<1.6));
      const partner=ordered.find(a=>a.mission===actor.mission&&a.rank===actor.rank&&a.id!==actor.id&&!processed.has(a.id));
      const together=partner&&Math.abs(partner.distance-actor.distance)<.12&&Math.abs(pathLength(partner.path)-length)<.1
        &&Math.hypot(partner.path[0]!.x-actor.path[0]!.x,partner.path[0]!.z-actor.path[0]!.z)<.1;
      const paired=Boolean(!opposite&&!nearPassage&&(base.width??.8)>=.8&&together);
      const batch=together?[actor,partner]:[actor];
      const proposals=batch.map(a=>{
        const formation=Math.max(0,Math.min(1,(a.formation??0)+(paired?1:-1)*dt*4));
        const offset=(a.member??0)*.5*Math.cos(formation*Math.PI/2);
        const distance=Math.min(length+(a.member??0)*.5,a.distance+a.speed*dt);
        const lateral=opposite?.22:(a.member===1?.22:-.22)*Math.sin(formation*Math.PI/2);
        return {actor:a,distance,formation,visible:distance>=offset,point:sampleWorkerPath(a.path,Math.max(0,distance-offset),lateral)};
      });
      let denied=false;
      const leases:Passage[]=[];
      for(const proposal of proposals) {
        const a=proposal.actor,p=proposal.point;
        if(!proposal.visible)continue;
        for(const n of neighbours(p))if(n.actor!==a&&!batch.includes(n.actor!)&&sweptWorkerDistance(a.visible?a.position:p,n.actor?.position??n.position,p,n.actor?.position??n.position)<WORKER_CLEARANCE-.005){denied=true;break;}
        const other=proposals.find(v=>v.actor!==a&&v.visible);
        if(other&&sweptWorkerDistance(a.visible?a.position:p,other.actor.visible?other.actor.position:other.point,p,other.point)<WORKER_CLEARANCE-.005){denied=true;break;}
        for(const passage of this.passages.values())if(passage.points.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<1.15)) {
          const owners=[...passage.owners].filter(id=>!batch.some(a=>a.id===id));
          const compatible=owners.every(id=>{const owner=actors.find(v=>v.id===id);if(!owner)return true;
            const cycle=cycleKey(a.path);if(cycle!==null&&cycle===cycleKey(owner.path))return true;
            const tangent=sampleWorkerPath(owner.path,owner.distance);return passage.straight&&tangent.dx*p.dx+tangent.dz*p.dz>.98;});
          if(owners.length&&!compatible){denied=true;break;}
          if(!passage.owners.has(a.id)) {
            const exit=sampleWorkerPath(a.path,Math.min(length,proposal.distance+1));
            if(neighbours(exit).some(n=>n.actor!==a&&!batch.includes(n.actor!)&&Math.hypot(exit.x-n.position.x,exit.z-n.position.z)<WORKER_CLEARANCE)){denied=true;break;}
            const opposingWait=ordered.some(v=>v.direction!==a.direction&&v.waitingSince!==null&&passage.points.some(q=>Math.hypot(v.position.x-q.x,v.position.z-q.z)<1.6));
            if(passage.served>=2&&passage.lastDirection===a.direction&&opposingWait){denied=true;break;}
          }
          leases.push(passage);
        }
      }
      for(const a of batch)processed.add(a.id);
      if(denied){for(const a of batch){a.waitingSince??=now;this.#waitOrder.set(a.id,a.waitingSince);}this.blocked+=batch.length;continue;}
      for(const proposal of proposals){const a=proposal.actor;a.position=proposal.point;a.distance=proposal.distance;a.formation=proposal.formation;a.visible=proposal.visible;a.waitingSince=null;this.#waitOrder.delete(a.id);if(a.visible)add(a.position,a);if(a.distance>=length+(a.member??0)*.5-.001)a.done=true;}
      for(const lease of new Set(leases)) {
        if(!batch.some(a=>lease.owners.has(a.id))){lease.served=lease.lastDirection===actor.direction?lease.served+1:1;lease.lastDirection=actor.direction;}
        for(const a of batch)lease.owners.add(a.id);
      }
    }
  }
}
