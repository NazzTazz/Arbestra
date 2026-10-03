import { describe,expect,it } from 'vitest';
import { WorkerTraffic,workerRoles,workerAppearance,sweptWorkerDistance,WORKER_STEP,WORKER_CLEARANCE,gardenHarvestPoint,
  type TrafficActor,type WorkerPoint } from './worker-motion';
import { worksiteLayout,worksiteConnector } from './worksite-layout';

it('sweeps three crop rows in alternating directions and stays inside the plot',()=>{
  const centre={x:17,z:-9},rows=[-.64,0,.64],directions:number[][]=[[],[],[]];
  let previous=gardenHarvestPoint(centre,0);
  for(let i=1;i<=1000;i++){
    const p=gardenHarvestPoint(centre,i/1000);
    expect(Math.abs(p.x-centre.x)).toBeLessThanOrEqual(1.021);
    expect(Math.abs(p.z-centre.z)).toBeLessThanOrEqual(.641);
    rows.forEach((z,row)=>{if(Math.abs(p.z-centre.z-z)<1e-6&&Math.abs(previous.z-centre.z-z)<1e-6&&Math.abs(p.x-centre.x)<.65)directions[row]!.push(Math.sign(p.x-previous.x));});
    expect(Math.hypot(p.x-previous.x,p.z-previous.z)).toBeLessThan(.01);previous=p;
  }
  expect(directions.map(d=>[...new Set(d)])).toEqual([[1],[-1],[1]]);
  expect(gardenHarvestPoint(centre,0)).toEqual(centre);
  expect(gardenHarvestPoint(centre,1).x).toBeCloseTo(centre.x,10);
  expect(gardenHarvestPoint(centre,1).z).toBeCloseTo(centre.z,10);
});

const actor=(id:string,path:WorkerPoint[],extras:Partial<TrafficActor>={}):TrafficActor=>({id,mission:id,rank:0,
  direction:1,path,distance:0,speed:1.5,position:{...path[0]!},visible:false,waitingSince:null,startAt:0,done:false,...extras});
function simulate(traffic:WorkerTraffic,actors:TrafficActor[],seconds:number) {
  let min=Infinity;
  for(let n=0;n<seconds/WORKER_STEP;n++){
    const before=actors.map(a=>({...a.position}));traffic.step(actors,n*WORKER_STEP*1000);
    for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++)if(actors[i]!.visible&&actors[j]!.visible&&!actors[i]!.done&&!actors[j]!.done)
      min=Math.min(min,sweptWorkerDistance(before[i]!,before[j]!,actors[i]!.position,actors[j]!.position));
  }return min;
}
describe('local village circulation',()=>{
  it('keeps a following file apart instead of overlapping the leader',()=>{
    const path=[{x:0,z:0,width:.5},{x:0,z:8,width:.5}],t=new WorkerTraffic();t.rebuild([path]);
    const people=Array.from({length:5},(_,i)=>actor(`${i}`,path,{mission:'crew',rank:i,startAt:i*230}));
    expect(simulate(t,people,18)).toBeGreaterThanOrEqual(WORKER_CLEARANCE-.006);
    expect(people.every(p=>p.done)).toBe(true);
  });
  it('lets opposite files cross on the right without passing through each other',()=>{
    const path=[{x:0,z:0,width:.94},{x:0,z:8,width:.94}],t=new WorkerTraffic();t.rebuild([path,[...path].reverse()]);
    const people=[actor('out',path),actor('back',[...path].reverse(),{direction:-1})];
    expect(simulate(t,people,12)).toBeGreaterThanOrEqual(WORKER_CLEARANCE-.006);
    expect(people.every(p=>p.done)).toBe(true);
  });
  it('serializes crossing paths and releases the intersection for the waiting mission',()=>{
    const h=[{x:-4,z:0},{x:0,z:0},{x:4,z:0}],v=[{x:0,z:-4},{x:0,z:0},{x:0,z:4}];
    const t=new WorkerTraffic();t.rebuild([h,v]);const people=[actor('a',h),actor('b',v)];
    expect(simulate(t,people,18)).toBeGreaterThanOrEqual(WORKER_CLEARANCE-.006);
    expect(people.every(p=>p.done)).toBe(true);
  });
  it('admits only one opposing flow into a narrow corridor and then lets the other enter',()=>{
    const path=[{x:0,z:0,width:.5},{x:0,z:6,width:.5}],t=new WorkerTraffic();t.rebuild([path,[...path].reverse()]);
    const people=[actor('first',path),actor('second',[...path].reverse(),{direction:-1})];
    expect(simulate(t,people,20)).toBeGreaterThanOrEqual(WORKER_CLEARANCE-.006);
    expect(people.every(p=>p.done)).toBe(true);
  });
  it('forms a pair after the doorway and keeps both figures separated',()=>{
    const path=[{x:0,z:0,width:.5},{x:0,z:1,width:.8},{x:0,z:8,width:.8}];
    const t=new WorkerTraffic();t.rebuild([path]);const people=[actor('a',path,{mission:'pair',member:0}),actor('b',path,{mission:'pair',member:1})];
    let peak=0,min=Infinity;
    for(let n=0;n<360;n++){t.step(people,n*WORKER_STEP*1000);peak=Math.max(peak,...people.map(p=>p.formation??0));
      if(people.every(p=>p.visible&&!p.done))min=Math.min(min,Math.hypot(people[0]!.position.x-people[1]!.position.x,people[0]!.position.z-people[1]!.position.z));}
    expect(min).toBeGreaterThanOrEqual(WORKER_CLEARANCE-.006);
    expect(people.every(p=>p.done)).toBe(true);
    expect(peak).toBeGreaterThan(.5);
  });
  it('detects a collision between frames even when endpoints do not overlap',()=>{
    expect(sweptWorkerDistance({x:-1,z:0},{x:1,z:0},{x:1,z:0},{x:-1,z:0})).toBe(0);
  });
  it('merges nearby conflict nodes with no intermediate waiting capacity',()=>{
    const t=new WorkerTraffic();t.rebuild([[{x:-1,z:0},{x:0,z:0},{x:0,z:.5},{x:1,z:.5}]]);
    expect([...t.passages.values()].some(p=>p.points.length>=2)).toBe(true);
  });
  it('drains opposing queues without starving either direction',()=>{
    const path=[{x:0,z:0,width:.5},{x:0,z:4,width:.5}],t=new WorkerTraffic();t.rebuild([path]);
    const people=Array.from({length:8},(_,i)=>actor(`${i}`,i<4?path:[...path].reverse(),{direction:i<4?1:-1,startAt:(i%4)*230}));
    expect(simulate(t,people,40)).toBeGreaterThanOrEqual(WORKER_CLEARANCE-.006);
    expect(people.every(p=>p.done)).toBe(true);
  });
  it('keeps deterministic priorities after rebasing canonical conflict points',()=>{
    const path=[{x:0,z:0,key:'0:0'},{x:0,z:3,key:'0:3'},{x:3,z:3,key:'3:3'}],t=new WorkerTraffic();t.rebuild([path]);
    const people=[actor('out',path),actor('return',[...path].reverse(),{direction:-1})];
    for(let i=0;i<30;i++)t.step(people,i*WORKER_STEP*1000);
    const before=people.map(p=>p.waitingSince),keys=[...t.passages.keys()];
    for(const point of path){point.x-=1024;point.z-=512;}for(const person of people){person.position.x-=1024;person.position.z-=512;}
    t.rebuild([path]);expect([...t.passages.keys()]).toEqual(keys);expect(people.map(p=>p.waitingSince)).toEqual(before);
    expect(simulate(t,people,15)).toBeGreaterThanOrEqual(WORKER_CLEARANCE-.006);
    expect(people.every(p=>p.done)).toBe(true);
  });
  it('preserves a narrow passage lease through rebase and addition of the reverse route',()=>{
    const path=[{x:0,z:0,width:.5,key:'0:0'},{x:0,z:5,width:.5,key:'0:5'}],t=new WorkerTraffic();t.rebuild([path]);
    const person=actor('engaged',path);t.step([person],0);
    const keys=[...t.passages.keys()],owners=[...t.passages.values()].map(p=>[...p.owners]);
    expect(owners.flat()).toContain('engaged');
    for(const p of path){p.x-=1024;p.z-=512;}person.position.x-=1024;person.position.z-=512;
    t.rebuild([path,[...path].reverse()]);
    expect([...t.passages.keys()]).toEqual(keys);expect([...t.passages.values()].map(p=>[...p.owners])).toEqual(owners);
  });
  it('drains a populated loop without overlapping its neighboring conflict gates',()=>{
    const corners=[{x:0,z:0},{x:0,z:2},{x:2,z:2},{x:2,z:0}];
    const paths=corners.map((_,i)=>Array.from({length:5},(_,n)=>corners[(i+n)%4]!));
    const t=new WorkerTraffic();t.rebuild(paths);const people=paths.map((p,i)=>actor(`${i}`,p,{visible:true}));
    expect(simulate(t,people,30)).toBeGreaterThanOrEqual(WORKER_CLEARANCE-.006);
    expect(people.every(p=>p.done)).toBe(true);
  });
});
describe('worksite representation',()=>{
  it('preserves validated roles and ten distinct stable appearances',()=>{
    expect(workerRoles('wood',4)).toEqual(['saw','saw','wood-chop','wood-chop']);
    expect(workerRoles('wood',10).filter(r=>r==='saw')).toHaveLength(6);
    expect(workerRoles('stone',10)).toEqual(['pick','pick','pick','pick','pick','break','break','break','carry','carry']);
    const looks=Array.from({length:10},(_,i)=>workerAppearance('world:village:site',i));
    expect(new Set(looks.map(l=>JSON.stringify(l))).size).toBe(10);
    expect(workerAppearance('world:village:site',3)).toEqual(looks[3]);
  });
  it('places all ten workers without overlap and rejects obstacles rather than penetrating them',()=>{
    for(const resource of ['wood','stone'] as const){const layout=worksiteLayout(resource,10,{x:0,z:0},{x:0,z:-3},()=>true);
      expect(layout.variant).not.toBe('blocked');expect(layout.stations).toHaveLength(10);
      for(const [i,s]of layout.stations.entries())for(const q of layout.stations.slice(i+1))expect(Math.hypot(s.x-q.x,s.z-q.z)).toBeGreaterThanOrEqual(.44);}
    expect(worksiteLayout('stone',10,{x:0,z:0},{x:0,z:-3},()=>false).variant).toBe('blocked');
  });
  it('uses shared compact posts and distinct waiting places when the front cannot fit ten workers',()=>{
    const layout=worksiteLayout('stone',10,{x:0,z:0},{x:0,z:-3},p=>p.z>=1.1||p.z<=-.4&&Math.abs(p.x)<.75||p.x>=1.2&&p.z>=.2&&p.z<=.6);
    expect(layout.variant).toBe('compact');
    expect(layout.stations.filter(p=>p.role==='pick')).toHaveLength(5);
    expect(new Set(layout.stations.filter(p=>p.role==='pick').map(p=>p.slot)).size).toBe(2);
    for(const [i,s]of layout.stations.entries())for(const q of layout.stations.slice(i+1))expect(Math.hypot(s.x-q.x,s.z-q.z)).toBeGreaterThanOrEqual(.44);
  });
  it('routes installation outside a resource volume and refuses an enclosed station',()=>{
    const path=worksiteConnector({x:0,z:-1},{x:0,z:1},{x:0,z:0},p=>Math.hypot(p.x,p.z)>.55);
    expect(path).not.toBeNull();expect(path!.length).toBeGreaterThan(2);
    expect(worksiteConnector({x:0,z:-1},{x:0,z:1},{x:0,z:0},()=>false)).toBeNull();
  });
});
