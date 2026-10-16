import { workerRoles, type WorkerPoint, type WorkerRole } from './worker-motion';

export interface WorkStation extends WorkerPoint { role:WorkerRole; facing:number; pair:number; workAt?:WorkerPoint; slot?:string; }
export interface WorksiteLayout { stations:WorkStation[]; approach:WorkerPoint; variant:'front'|'side'|'compact'|'blocked'; }

/** Small bounded presentation connectors, never a replacement for the server path. */
export function worksiteConnector(from:WorkerPoint,to:WorkerPoint,target:WorkerPoint,free:(p:WorkerPoint,r:number)=>boolean,posts:readonly WorkerPoint[]=[]):WorkerPoint[]|null {
  const candidates:WorkerPoint[][]=[[from,to]];
  for(const side of [-1,1]){
    candidates.push([from,{x:target.x+side*1.6,z:from.z},{x:target.x+side*1.6,z:to.z},to]);
    candidates.push([from,{x:from.x,z:target.z+side*1.6},{x:to.x,z:target.z+side*1.6},to]);
  }
  for(const side of [-1,1])for(const end of [-1,1]){
    const x=target.x+side*2.8,z=target.z+end*1.6;
    candidates.push([from,{x,z:from.z},{x,z},{x:to.x,z},to]);
  }
  const clear=(a:WorkerPoint,b:WorkerPoint)=>{
    const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.2));
    for(let n=1;n<=steps;n++){const t=n/steps;
      if(!free({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t},.2))return false;}
    return true;
  };
  for(const path of candidates)if(path.every((p,i)=>i===0||clear(path[i-1]!,p)))return path;
  if(!posts.length)return null;
  // Only a local fallback around the reserved posts, never a world pathfinder.
  // Inflated post boundaries expose narrow aisles that the fixed bends miss.
  const xs=[...new Set([from.x,to.x,target.x-.8,target.x+.8,...posts.flatMap(p=>[p.x-.46,p.x+.46])])].sort((a,b)=>a-b);
  const zs=[...new Set([from.z,to.z,target.z-.8,target.z+.8,...posts.flatMap(p=>[p.z-.46,p.z+.46])])].sort((a,b)=>a-b);
  if(xs.length*zs.length>2048)return null;
  const points:WorkerPoint[]=[];const point=(id:number)=>points[id]??(points[id]={x:xs[id%xs.length]!,z:zs[Math.floor(id/xs.length)]!});
  const start=xs.indexOf(from.x)+zs.indexOf(from.z)*xs.length,goal=xs.indexOf(to.x)+zs.indexOf(to.z)*xs.length;
  const queue=[start],previous=new Map<number,number>([[start,-1]]),costs=new Map([[start,0]]),closed=new Set<number>();
  const estimate=(id:number)=>{const p=point(id);return costs.get(id)!+Math.abs(p.x-to.x)+Math.abs(p.z-to.z);};
  while(queue.length){
    let best=0;for(let i=1;i<queue.length;i++)if(estimate(queue[i]!)<estimate(queue[best]!))best=i;
    const id=queue.splice(best,1)[0]!,x=id%xs.length,z=Math.floor(id/xs.length);closed.add(id);
    if(id===goal){
      const path:WorkerPoint[]=[];for(let next=id;next!==-1;next=previous.get(next)!)path.push(point(next));path.reverse();
      const simplified:WorkerPoint[]=[];
      for(const p of path){const a=simplified.at(-2),b=simplified.at(-1);
        if(a&&b&&(a.x===b.x&&b.x===p.x||a.z===b.z&&b.z===p.z))simplified.pop();simplified.push(p);}
      return simplified;
    }
    for(const next of [x>0?id-1:-1,x+1<xs.length?id+1:-1,z>0?id-xs.length:-1,z+1<zs.length?id+xs.length:-1]){
      if(next<0||closed.has(next))continue;
      const a=point(id),b=point(next),cost=costs.get(id)!+Math.abs(a.x-b.x)+Math.abs(a.z-b.z);
      if(cost>=(costs.get(next)??Infinity)||!clear(a,b))continue;
      previous.set(next,id);costs.set(next,cost);if(!queue.includes(next))queue.push(next);
    }
  }
  return null;
}

/** Bounded templates, deliberately independent of economic access or quantities. */
export function worksiteLayout(resource:'wood'|'stone'|'garden',count:number,target:WorkerPoint,
  approach:WorkerPoint,free:(point:WorkerPoint,radius:number)=>boolean):WorksiteLayout {
  const roles=workerRoles(resource,count),angle=Math.atan2(target.x-approach.x,target.z-approach.z);
  if(resource==='garden')return {stations:roles.map(role=>({...target,role,facing:angle,pair:-1})),approach,variant:'front'};
  const templates=[{name:'front' as const,spread:.7,depth:.65},{name:'side' as const,spread:.62,depth:.75}];
  for(const template of templates)for(const rotation of [0,Math.PI/2,-Math.PI/2,Math.PI]) {
    const a=angle+rotation,dx=Math.cos(a),dz=-Math.sin(a),fx=Math.sin(a),fz=Math.cos(a);
    const stations:WorkStation[]=[],roleCounts=new Map<WorkerRole,number>();
    for(let i=0;i<count;i++) {
      const role=roles[i]!,index=roleCounts.get(role)??0;roleCounts.set(role,index+1);
      let side=0,depth=0,pair=-1,facing=a;
      if(role==='saw') {pair=Math.floor(index/2);side=(index%2?1:-1)*.49;depth=-.8-pair*template.depth;facing=a+(index%2?-Math.PI/2:Math.PI/2);}
      else if(role==='axe'||role==='pick') {side=(index-(roles.filter(r=>r===role).length-1)/2)*template.spread;depth=-.9;}
      else if(role==='wood-chop'||role==='break') {side=(index%3-1)*template.spread;depth=(resource==='wood'?1.65:1.05)+Math.floor(index/3)*template.depth;}
      else if(role==='carry') {side=(index%2?1:-1)*1.45;depth=.5;}
      else {side=0;depth=-.5;}
      // A side template puts processing next to the approach instead of behind it.
      if(template.name==='side'&&(role==='break'||role==='wood-chop')){side+=1.4;depth-=1;}
      stations.push({x:target.x+dx*side+fx*depth,z:target.z+dz*side+fz*depth,role,facing,pair});
    }
    const positionsValid=stations.every(p=>free(p,.27))&&stations.every((p,i)=>stations.slice(i+1).every(q=>Math.hypot(p.x-q.x,p.z-q.z)>=.44));
    if(!positionsValid)continue;
    // Tools need more clearance than a body; saw centres and processing benches.
    const tools=stations.filter((p,i)=>p.role!=='saw'||i%2===0);
    if(!tools.every(p=>free(p,.4)))continue;
    return {stations,approach,variant:template.name};
  }
  // Compact sites keep every participant, with a few shared posts and safe queues.
  for(const rotation of [0,Math.PI/2,-Math.PI/2,Math.PI]) {
    const a=angle+rotation,dx=Math.cos(a),dz=-Math.sin(a),fx=Math.sin(a),fz=Math.cos(a);
    const point=(side:number,depth:number)=>({x:target.x+dx*side+fx*depth,z:target.z+dz*side+fz*depth});
    const counters=new Map<WorkerRole,number>(),stations:WorkStation[]=[],posts=new Map<string,WorkerPoint>();
    for(const role of roles){const index=counters.get(role)??0;counters.set(role,index+1);
      let side=0,depth=0,slot=role as string,pair=-1,facing=a;
      if(role==='saw'){pair=Math.floor(index/2);side=index%2?.49:-.49;depth=-.65;slot=`saw-${index%2}`;facing+=index%2?-Math.PI/2:Math.PI/2;}
      else if(role==='pick'){side=index%2?.38:-.38;depth=-.9;slot=`pick-${index%2}`;}
      else if(role==='axe'){depth=-.9;}
      else if(role==='break'||role==='wood-chop'){depth=1.2;}
      else if(role==='carry'){side=1.4;depth=.4;}
      const workAt=point(side,depth);posts.set(slot,workAt);
      stations.push({...workAt,role,pair,facing,workAt,slot});
    }
    const occupied=[...posts.values()];
    if(!occupied.every(p=>free(p,.4)))continue;
    const queues=[-1.8,1.8,-2.4,2.4,0,-.6,.6].flatMap(side=>[2.4,3,3.6,-1.6,-2.2,4.2,4.8,-2.8,-3.4,-4].map(depth=>point(side,depth)));
    let valid=true;
    for(const station of stations){const wait=queues.find(p=>free(p,.27)&&occupied.every(q=>Math.hypot(p.x-q.x,p.z-q.z)>=.55));
      if(!wait){valid=false;break;}station.x=wait.x;station.z=wait.z;occupied.push(wait);}
    if(valid)return {stations,approach,variant:'compact'};
  }
  // Safe waiting is provided by the approach route; never put a figure inside an obstacle.
  const stations=roles.map((role,i)=>({x:approach.x-Math.sin(angle)*i*.52,z:approach.z-Math.cos(angle)*i*.52,role,facing:angle,pair:-1}));
  return {stations,approach,variant:'blocked'};
}
