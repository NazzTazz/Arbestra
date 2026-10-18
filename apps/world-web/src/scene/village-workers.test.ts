import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { VillageState } from '@arbestra/contracts';
import { expect, it } from 'vitest';
import { VillageWorkers, type WorkerHooks } from './village-workers';
import { gardenHarvestPoint, sampleWorkerPath, type TrafficActor } from './worker-motion';

const epoch=Date.parse('2026-10-02T12:00:00Z');
function gardenSnapshot():VillageState {
  const harvest={id:'tour',startedAt:new Date(epoch).toISOString(),completesAt:new Date(epoch+128000).toISOString(),transportMs:2000,
    path:[{cellX:0,cellY:0},{cellX:0,cellY:2}],
    stops:[{cellX:0,cellY:2,path:[{cellX:0,cellY:0},{cellX:0,cellY:2}],arrivesAfterMs:2000,workEndsAfterMs:62000,reservedCarrots:10},
      {cellX:0,cellY:5,path:[{cellX:0,cellY:2},{cellX:0,cellY:5}],arrivesAfterMs:65000,workEndsAfterMs:125000,reservedCarrots:20}],
    returnPath:[{cellX:0,cellY:5},{cellX:0,cellY:0}]};
  return {world:{id:'world'},village:{id:'village',worksites:[],extractions:[]},cells:[{building:{garden:{plots:harvest.stops.map(s=>({...s,harvest}))}}}]} as unknown as VillageState;
}
function snapshot(id='lot-1',start=epoch,count=10):VillageState {
  return {world:{id:'world'},village:{id:'village',worksites:[{id:'site',activeExtraction:{id}}],
    extractions:[{id,resourceCode:'stone',workerCount:count,featureId:'deposit',cellX:0,cellY:8,
      path:[{cellX:0,cellY:0},{cellX:0,cellY:1},{cellX:0,cellY:3},{cellX:0,cellY:5},{cellX:0,cellY:8}],
      startedAt:new Date(start).toISOString(),completesAt:new Date(start+80_000).toISOString(),transportMs:8000}]},cells:[] } as unknown as VillageState;
}
function fixture(free:WorkerHooks['free']=()=>true){
  const engine=new NullEngine(),scene=new Scene(engine),material=new StandardMaterial('shared',scene);
  let shift=0,ground:number|null=0;
  const view=new VillageWorkers(scene,{skin:[material,material,material],clothes:Array(5).fill(material),hair:Array(3).fill(material),pants:material,timber:material,stone:material},
    {path:p=>p.map(c=>new Vector3(c.cellX-shift,0,c.cellY)),project:p=>({x:p.cellX-shift,z:p.cellY}),ground:()=>ground,
      leisurePath:(_id,p)=>p.map(c=>new Vector3(c.cellX-shift,0,c.cellY)),
      free,key:p=>`${p.x+shift}:${p.z}`,detailed:()=>true});
  return {scene,material,view,setGround:(value:number|null)=>{ground=value;},rebase:(x:number)=>{shift=x;view.shift(x,0);},dispose:()=>{view.dispose();scene.dispose();engine.dispose();}};
}

it('takes three leveling inhabitants through the fine doorstep connector without a permanent queue',()=>{
  const f=fixture();try {
    const path=[[59,194.584],[59,194.125],[59.125,194.125],[59.25,194.125],[59.375,194.125],[59.5,194.125],[60,194.125],[60,194],[60,195],[60,196],[60,197],[59.375,197],[59.25,197],[59.125,197],[59,197]].map(([cellX,cellY])=>({cellX:cellX!,cellY:cellY!}));
    const state={world:{id:'world'},village:{id:'village',worksites:[],extractions:[],levelingJobs:[{
      id:'leveling',featureId:'site',buildingType:'university',cells:[{cellX:59,cellY:198}],height:.25,workerCount:3,
      path,transportMs:7000,startedAt:new Date(epoch).toISOString(),completesAt:new Date(epoch+80000).toISOString(),
    }]},cells:[]} as unknown as VillageState;
    f.view.sync(state,epoch);
    for(let t=0;t<50000;t+=33)f.view.animate(epoch+t,true);
    expect(f.view.metrics.layouts[0]!.phases,JSON.stringify(f.view.figures.map(p=>p.root.position.asArray()))).toEqual(['work','work','work']);
  }finally{f.dispose();}
});

it('shows the assigned leveling inhabitants working and removes them on the authoritative completion',()=>{
  const f=fixture();try {
    const state={world:{id:'world'},village:{id:'village',worksites:[],extractions:[],levelingJobs:[{
      id:'leveling',featureId:'site',buildingType:'university',cells:[{cellX:0,cellY:9}],height:.25,workerCount:2,
      path:[{cellX:0,cellY:0},{cellX:0,cellY:8}],transportMs:8000,
      startedAt:new Date(epoch).toISOString(),completesAt:new Date(epoch+80000).toISOString(),
    }]},cells:[]} as unknown as VillageState;
    f.view.sync(state,epoch+20000);f.view.animate(epoch+20000,true);f.view.animate(epoch+20016,true);
    expect(f.view.figures).toHaveLength(2);
    expect(f.view.figures.every(p=>p.root.isEnabled())).toBe(true);
    expect(f.view.metrics.layouts[0]).toMatchObject({resource:'leveling',phases:['work','work']});
    f.view.sync({...state,village:{...state.village,levelingJobs:[]}},epoch+80000);
    for(let t=80000;t<92000;t+=33)f.view.animate(epoch+t,true);
    expect(f.view.figures.filter(p=>p.root.isEnabled())).toHaveLength(0);
  }finally{f.dispose();}
});

it('shows every trade porter on both legs after reload and removes them at the authoritative return',()=>{
  const f=fixture();try {
    const state={world:{id:'world'},village:{id:'village',worksites:[],extractions:[],market:{journeys:[{
      id:'trade',villageId:'village',destinationVillageId:'other',workerCount:2,
      path:[{cellX:0,cellY:0},{cellX:0,cellY:10}],startedAt:new Date(epoch).toISOString(),
      arrivesAt:new Date(epoch+10000).toISOString(),returnsAt:new Date(epoch+20000).toISOString(),
    }]}},cells:[]} as unknown as VillageState;
    f.view.sync(state,epoch+4000);f.view.animate(epoch+4000,true);f.view.animate(epoch+4016,true);
    expect(f.view.figures).toHaveLength(2);
    expect(f.view.figures.every(p=>p.root.isEnabled())).toBe(true);
    expect(f.view.figures[0]!.root.position.z).toBeGreaterThan(f.view.figures[1]!.root.position.z);
    expect(f.view.figures[0]!.root.position.z).toBeCloseTo(4,0);
    f.view.dispose();
    f.view.sync(state,epoch+14000);f.view.animate(epoch+14000,true);f.view.animate(epoch+14016,true);
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['inbound','inbound']);
    expect(f.view.figures[0]!.root.position.z).toBeCloseTo(6,0);
    for(let t=14032;t<=20100;t+=32)f.view.animate(epoch+t,true);
    expect(f.view.figures).toHaveLength(0);
  }finally{f.dispose();}
});

it('keeps the inspected representative moving while its authoritative information stays attached',()=>{
  const f=fixture();try{
    const state=snapshot('pair',epoch,2);
    state.village.population={total:2,housingCapacity:30,available:0,working:2,resting:0,energyCounts:[],
      cohorts:[{id:'cohort',memberCount:2,activity:'working',restBuildingId:null,restingSince:null,energy:8,assignmentId:'pair',cartographer:true}]};
    f.view.sync(state,epoch);for(let t=0;t<2000;t+=16)f.view.animate(epoch+t,true);
    const id='pair:0',before=f.view.representativePose(id)!;
    expect(before).not.toBeNull();
    const info=f.view.representativeInfo(id)!;
    expect(info.energy).toBe(8);expect(info.qualifications).toEqual(['Cartographe']);expect(info.cohortSize).toBe(2);
    f.view.selectRepresentative(id);
    const other=f.view.representativePose('pair:1')!.position.clone();
    for(let t=2000;t<5000;t+=16)f.view.animate(epoch+t,true);
    expect(f.view.representativePose(id)!.position.equals(before.position)).toBe(false);
    expect(f.view.representativePose('pair:1')!.position.equals(other)).toBe(false);
    f.view.sync(state,epoch+5000);expect(f.view.representativeInfo(id)!.name).toBe(info.name);
    f.view.selectRepresentative(null);f.view.animate(epoch+5016,true);
    expect(f.view.representativePose(id)!.position.equals(before.position)).toBe(false);
    expect(state.village.extractions[0]!.completesAt).toBe(new Date(epoch+80_000).toISOString());
  }finally{f.dispose();}
});

it('reconstructs current work after reload and keeps all ten roles through snapshot and LOD changes',()=>{
  const f=fixture();try{
    f.view.sync(snapshot(),epoch+20_000);f.view.animate(epoch+20_000,true);
    const figures=f.view.figures;
    expect(figures).toHaveLength(10);expect(f.view.metrics.layouts[0]?.roles).toEqual(['pick','pick','pick','pick','pick','break','break','break','carry','carry']);
    expect(f.view.metrics.layouts[0]?.phases.every(p=>p==='work')).toBe(true);
    f.view.sync(snapshot(),epoch+21_000);expect(f.view.figures).toEqual(figures);
    f.view.animate(epoch+21_000,false);expect(figures.every(p=>!p.root.isEnabled())).toBe(true);
    f.view.animate(epoch+22_000,true);expect(f.view.figures).toEqual(figures);
    expect(f.view.metrics.layouts[0]?.phases.every(p=>p==='work')).toBe(true);
  }finally{f.dispose();}
});

it('deploys an actual snapshot team into a pair after leaving the doorway',()=>{
  const f=fixture();try{
    f.view.sync(snapshot('pair',epoch,2),epoch);f.view.animate(epoch,true);
    let spread=0;
    for(let t=0;t<7000;t+=16){f.view.animate(epoch+t,true);
      const [a,b]=f.view.figures;
      if(a?.root.isEnabled()&&b?.root.isEnabled())spread=Math.max(spread,Math.abs(a.root.position.x-b.root.position.x));
    }
    expect(spread).toBeGreaterThan(.3);
  }finally{f.dispose();}
});

it('keeps ten participants with rotating compact posts rather than stacking five miners',()=>{
  const f=fixture(p=>Math.abs(p.x)>2.5||p.z-8<-1.5||p.z-8>=1.1||p.z-8<=-.4&&Math.abs(p.x)<.75||p.x>=1.2&&p.z-8>=.2&&p.z-8<=.6);
  try{
    f.view.sync(snapshot(),epoch+20_000);f.view.animate(epoch+20_000,true);
    expect(f.view.metrics.layouts[0]?.variant).toBe('compact');
    let miningSeen=false,min=Infinity;
    for(let time=20_000;time<38_000;time+=33){
      f.view.animate(epoch+time,true);expect(f.view.figures).toHaveLength(10);
      const figures=f.view.figures;
      for(let i=0;i<figures.length;i++)for(let j=i+1;j<figures.length;j++)
        min=Math.min(min,Math.hypot(figures[i]!.root.position.x-figures[j]!.root.position.x,figures[i]!.root.position.z-figures[j]!.root.position.z));
      miningSeen ||= figures.slice(0,5).some(p=>Math.abs(p.root.position.z-7.1)<.05);
    }
    expect(min).toBeGreaterThan(.43);expect(miningSeen).toBe(true);
  }finally{f.dispose();}
});

it('retains a returning team before admitting the next lot and ignores stale snapshots after completion',()=>{
  const f=fixture();try{
    f.view.sync(snapshot(),epoch+75_000);f.view.animate(epoch+75_000,true);
    f.view.sync(snapshot('lot-2',epoch+80_000),epoch+80_000);
    expect(f.view.figures).toHaveLength(10);expect(f.view.metrics.pending).toBe(1);
    for(let t=80_000;t<92_000;t+=33)f.view.animate(epoch+t,true);
    expect(f.view.figures).toHaveLength(10);expect(f.view.metrics.layouts[0]?.id).toBe('lot-2');
    f.view.animate(epoch+170_000,true);
    expect(f.view.figures).toHaveLength(0);
    f.view.sync(snapshot('lot-2',epoch+80_000),epoch+171_000);
    expect(f.view.figures).toHaveLength(0);
  }finally{f.dispose();}
});

it('releases meshes and nodes over repeated lots while retaining shared materials',()=>{
  const f=fixture();try{
    for(let i=0;i<12;i++){
      const t=epoch+i*100_000;
      f.view.sync(snapshot(`lot-${i}`,t),t+20_000);f.view.animate(t+20_000,true);
      expect(f.scene.meshes.length).toBeLessThan(150);
      f.view.animate(t+90_000,true);
      expect(f.scene.meshes.filter(m=>m.isEnabled())).toHaveLength(0);expect(f.scene.meshes).toHaveLength(1);expect(f.scene.transformNodes).toHaveLength(0);
      expect(f.scene.materials).toEqual([f.material]);
    }
  }finally{f.dispose();}
});

it('cleans old incarnations and queues on changing world',()=>{
  const f=fixture();try{
    f.view.sync(snapshot(),epoch+20_000);const old=f.view.figures;
    const next=snapshot();next.world.id='other-world';
    f.view.sync(next,epoch+20_000);
    expect(old.every(p=>p.root.isDisposed())).toBe(true);expect(f.view.figures).toHaveLength(10);
    expect(f.view.figures.every(p=>!old.includes(p))).toBe(true);expect(f.view.metrics.pending).toBe(0);
    expect(f.scene.materials).toEqual([f.material]);
  }finally{f.dispose();}
});

it('rebases once without moving workers relative to their posts',()=>{
  const f=fixture(),reference=fixture();try{
    for(const v of [f.view,reference.view]){v.sync(snapshot(),epoch+20_000);v.animate(epoch+20_000,true);}
    f.rebase(100);
    for(const time of [20_033,20_066,20_099]){
      f.view.reproject();f.view.animate(epoch+time,true);reference.view.animate(epoch+time,true);
      for(let i=0;i<10;i++)expect(f.view.figures[i]!.root.position.x+100).toBeCloseTo(reference.view.figures[i]!.root.position.x,8);
    }
  }finally{f.dispose();reference.dispose();}
});

it('animates one gardener across two plots without returning home between them',()=>{
  const f=fixture();try{
    f.view.sync(gardenSnapshot(),epoch);f.view.animate(epoch,true);const gardener=f.view.figures[0]!;
    for(let t=0;t<68000;t+=33)f.view.animate(epoch+t,true);
    expect(f.view.figures).toEqual([gardener]);expect(f.view.metrics.layouts[0]?.phases).toEqual(['work']);
    expect(gardener.root.position.z).toBeGreaterThan(4);
    for(let t=68000;t<132000;t+=33)f.view.animate(epoch+t,true);
    expect(f.view.figures).toHaveLength(0);
  }finally{f.dispose();}
});
it('reconstructs a tour at its second plot and final return after reload or LOD changes',()=>{
  const f=fixture();try{
    f.view.sync(gardenSnapshot(),epoch+70000);f.view.animate(epoch+70000,true);
    expect(f.view.figures).toHaveLength(1);expect(f.view.figures[0]!.root.position.z).toBeGreaterThan(4);
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['work']);
    f.view.animate(epoch+125000,false);f.view.animate(epoch+126000,true);
    f.view.animate(epoch+126034,true);
    expect(f.view.figures).toHaveLength(1);expect(f.view.metrics.layouts[0]?.phases).toEqual(['inbound']);
    expect(f.view.figures[0]!.root.position.z).toBeLessThan(5);
    expect(f.view.figures[0]!.root.position.z).toBeGreaterThan(0);
  }finally{f.dispose();}
});

it('restores initial crop progress and preserves the row through short suspension and rebasing',()=>{
  const f=fixture();try{
    const now=epoch+35000;
    f.view.sync(gardenSnapshot(),now);f.view.animate(now,true);
    const expected=gardenHarvestPoint({x:0,z:2},33/60),gardener=f.view.figures[0]!;
    expect(gardener.root.position.x).toBeCloseTo(expected.x,8);expect(gardener.root.position.z).toBeCloseTo(expected.z,8);
    f.view.animate(now+10,false);f.view.animate(now+1000,true);
    const resumed=gardener.root.position.clone();
    expect(Math.hypot(resumed.x-expected.x,resumed.z-expected.z)).toBeLessThan(.05);
    f.rebase(100);f.view.reproject();f.view.animate(now+1034,true);
    expect(Math.hypot(gardener.root.position.x+100-resumed.x,gardener.root.position.z-resumed.z)).toBeLessThan(.05);
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['work']);expect(f.view.figures).toEqual([gardener]);
  }finally{f.dispose();}
});

function idleSnapshot(available=120):VillageState{
  const state=snapshot();state.village.extractions=[];state.village.worksites=[];
  state.village.population={total:120,housingCapacity:130,available,working:120-available,resting:0,energyCounts:[],cohorts:[{id:'idle-cohort',memberCount:available,activity:'idle',restBuildingId:null,restingSince:null}]};
  state.cells=[{cellX:0,cellY:0,building:{id:'hall',type:'town-hall',status:'completed'}},{cellX:0,cellY:4,building:{id:'house',type:'dwelling',status:'completed'}}] as unknown as VillageState['cells'];
  state.travelRoutes=[{id:'house',kind:'building',destination:{cellX:0,cellY:4},cells:[{cellX:0,cellY:0},{cellX:0,cellY:1},{cellX:0,cellY:4}]}];return state;
}
it('bounds idle representatives, lets them enter houses and withdraws them when no residents remain available',()=>{
  const f=fixture();try{
    f.view.sync(idleSnapshot(),epoch);f.view.animate(epoch,true);expect(f.view.figures).toHaveLength(8);
    let inside=false,walking=false;
    for(let t=0;t<60000;t+=33){f.view.animate(epoch+t,true);inside ||=f.view.metrics.layouts.some(g=>g.phases.includes('inside'));walking ||=f.view.figures.some(p=>p.root.isEnabled());}
    expect(inside&&walking).toBe(true);const old=f.view.figures;
    f.view.sync(idleSnapshot(0),epoch+60000);expect(f.view.figures).toHaveLength(0);expect(old.every(p=>p.root.isDisposed())).toBe(true);
  }finally{f.dispose();}
});
it('preserves idle representatives through LOD and recentring and still renders the whole observed working team',()=>{
  const f=fixture();try{
    const state=idleSnapshot();state.village.extractions=snapshot().village.extractions;
    f.view.sync(state,epoch+20000);f.view.animate(epoch+20000,true);expect(f.view.figures).toHaveLength(18);
    const figures=f.view.figures;f.view.animate(epoch+21000,false);f.rebase(100);f.view.reproject();f.view.animate(epoch+22000,true);
    expect(f.view.figures).toEqual(figures);expect(f.view.figures.every(p=>p.root.position.x<10)).toBe(true);
    expect(f.view.metrics.layouts.find(g=>g.id==='lot-1')?.roles).toHaveLength(10);
    f.view.sync(state,epoch+23000);expect(f.view.figures).toEqual(figures);
  }finally{f.dispose();}
});

const actorOf=(figure:VillageWorkers['figures'][number])=>(figure as VillageWorkers['figures'][number]&{actor:TrafficActor}).actor;
it('deploys a compact wood team from the doorway through empty waiting places and starts the shared work posts',()=>{
  const physical=(p:{x:number;z:number},r:number)=>[[0,0],[-r,-r],[r,r],[-r,r],[r,-r]].every(([dx,dz])=>{
    const x=p.x+dx!,z=p.z+dz!;return Math.abs(x)<=1.15&&Math.abs(z)<=1.15||x>=.8&&Math.abs(z)<=.95;
  })&&Math.hypot(p.x,p.z)>=.42+r*.3;
  const f=fixture((p,r,_feature,allowRoads)=>allowRoads===true&&physical(p,r));
  try{
    const state=snapshot('narrow-wood',epoch,10),e=state.village.extractions[0]!;
    e.resourceCode='wood';e.cellX=0;e.cellY=0;e.transportMs=2802;
    e.path=[{cellX:3.75,cellY:1.38},{cellX:3.75,cellY:.9375},{cellX:3.4375,cellY:.9375},
      {cellX:2.5,cellY:.9375},{cellX:2.5,cellY:0},{cellX:2.5,cellY:.9375},
      {cellX:.9375,cellY:.9375},{cellX:.625,cellY:.9375},{cellX:.3125,cellY:.9375},
      {cellX:0,cellY:.9375},{cellX:0,cellY:.625},{cellX:0,cellY:.3125},{cellX:0,cellY:0}];
    f.view.sync(state,epoch);let saw=false,chopping=false;
    for(let t=0;t<50000;t+=33){f.view.animate(epoch+t,true);
      saw ||= f.scene.meshes.some(m=>m.name.startsWith('saw-')&&m.isEnabled());
      chopping ||= f.view.figures.slice(6).some(p=>p.root.getChildTransformNodes().some(n=>n.name.endsWith('-tool')&&n.isEnabled()&&Math.hypot(p.root.position.x,p.root.position.z)<1.5));
    }
    expect(f.view.metrics.layouts[0]?.variant).toBe('compact');
    expect(saw,JSON.stringify(f.view.figures.map(p=>({p:actorOf(p).position,path:actorOf(p).path,waiting:actorOf(p).waitingSince})))).toBe(true);expect(chopping).toBe(true);expect(f.view.figures).toHaveLength(10);
  }finally{f.dispose();}
});
it.each([false,true])('uses physically free road posts only when traffic reservations prevent the wood layout (physical clearance: %s)',physical=>{
  const f=fixture((_point,_radius,_feature,allowRoads)=>physical&&allowRoads===true);
  try{
    const state=snapshot('wood-road',epoch,10);state.village.extractions[0]!.resourceCode='wood';
    f.view.sync(state,epoch+20000);f.view.animate(epoch+20000,true);
    expect(f.view.metrics.layouts[0]?.variant==='blocked').toBe(!physical);
    expect(f.view.figures).toHaveLength(10);
    expect(f.scene.meshes.some(m=>m.name.startsWith('saw-')&&m.isEnabled())).toBe(physical);
  }finally{f.dispose();}
});
it('gets a ten-person wood team past a retraced access spur and into chopping work without changing the server route',()=>{
  const f=fixture();try{
    const state=snapshot('wood-spur',epoch,10),mission=state.village.extractions[0]!;
    mission.resourceCode='wood';mission.transportMs=2802;
    mission.path=[{cellX:0,cellY:0},{cellX:0,cellY:-.4425},{cellX:-.3125,cellY:-.4425},
      {cellX:-1.25,cellY:-.4425},{cellX:-1.25,cellY:-1.38},{cellX:-1.25,cellY:-.4425},
      {cellX:-2.8125,cellY:-.4425},{cellX:-3.125,cellY:-.4425},{cellX:-3.4375,cellY:-.4425},
      {cellX:-3.75,cellY:-.4425},{cellX:-3.75,cellY:-.755},{cellX:-3.75,cellY:-1.0675},{cellX:-3.75,cellY:-1.38}];
    mission.cellX=-3.75;mission.cellY=-1.38;
    const before=JSON.stringify(mission);
    f.view.sync(state,epoch);
    let separation=Infinity;
    for(let t=0;t<40000;t+=33){
      f.view.animate(epoch+t,true);
      const visible=f.view.figures.filter(p=>p.root.isEnabled());
      for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++)
        separation=Math.min(separation,Math.hypot(visible[i]!.root.position.x-visible[j]!.root.position.x,visible[i]!.root.position.z-visible[j]!.root.position.z));
    }
    expect(f.view.figures).toHaveLength(10);
    expect(f.view.metrics.layouts[0]?.phases.every(p=>p==='work'),JSON.stringify({layout:f.view.metrics.layouts[0],actors:f.view.figures.map(p=>({distance:actorOf(p).distance,position:actorOf(p).position,done:actorOf(p).done}))})).toBe(true);
    expect(f.view.figures.every(p=>Math.hypot(p.root.position.x,p.root.position.z)>1)).toBe(true);
    expect(f.scene.meshes.some(m=>m.name.startsWith('saw-')&&m.isEnabled())).toBe(true);
    expect(separation).toBeGreaterThan(.43);
    expect(JSON.stringify(mission)).toBe(before);
  }finally{f.dispose();}
});
it('keeps a valid actor and pose through ordinary sync, terrain reprojection and a two second frame stall',()=>{
  const f=fixture();try{
    f.view.sync(snapshot('one',epoch,1),epoch);for(let t=0;t<2000;t+=16)f.view.animate(epoch+t,true);
    const figure=f.view.figures[0]!,a=actorOf(figure),position=figure.root.position.clone(),distance=a.distance;
    f.view.sync(snapshot('one',epoch,1),epoch+2000);f.view.reproject();
    expect(f.view.figures[0]).toBe(figure);expect(a.distance).toBe(distance);expect(figure.root.position.equals(position)).toBe(true);
    f.view.animate(epoch+4000,true);expect(figure.root.isEnabled()).toBe(true);
    expect(figure.root.position.subtract(position).length()).toBeLessThan(.2);
  }finally{f.dispose();}
});
it('does not reconstruct an active waiting member or its moving colleague after eight seconds',()=>{
  const f=fixture();try{
    f.view.sync(snapshot('pair',epoch,2),epoch);for(let t=0;t<1500;t+=16)f.view.animate(epoch+t,true);
    const figures=f.view.figures,a=actorOf(figures[1]!);a.speed=0;a.waitingSince=epoch-9000;const distance=a.distance;
    for(let t=1500;t<2500;t+=16)f.view.animate(epoch+t,true);
    expect(a.distance).toBe(distance);expect(figures[1]!.root.isEnabled()).toBe(true);
    expect(figures[1]!.root.getChildMeshes()[0]!.visibility).toBeGreaterThan(.95);
    expect(actorOf(figures[0]!).distance).toBeGreaterThan(distance);
  }finally{f.dispose();}
});
it('leaves the actually reached door after a delayed idle arrival and keeps its info indoors',()=>{
  const f=fixture();try{
    const key='world:village:idle:idle-cohort:0',state=idleSnapshot(1);
    // Find an initial walking phase without coupling the assertion to the seed.
    let now=epoch;for(;now<epoch+120000;now+=1000){f.view.sync(state,now);f.view.animate(now,true);if(f.view.metrics.layouts[0]?.phases[0]==='outbound')break;f.view.dispose();}
    const figure=f.view.figures[0]!,a=actorOf(figure);a.speed=0;
    for(let t=33;t<15000;t+=33)f.view.animate(now+t,true);
    a.distance=a.path.reduce((n,p,i)=>i?n+Math.hypot(p.x-a.path[i-1]!.x,p.z-a.path[i-1]!.z):0,0);a.position={...a.path.at(-1)!};a.done=true;
    f.view.animate(now+15033,true);expect(f.view.metrics.layouts[0]?.phases[0]).toBe('inside');
    expect(f.view.representativeInfo(key+':0')).not.toBeNull();const door={...a.position};
    for(let t=15066;t<55000;t+=33){f.view.animate(now+t,true);if(f.view.metrics.layouts[0]?.phases[0]==='outbound'){
      expect(Math.hypot(a.position.x-door.x,a.position.z-door.z)).toBeLessThan(.05);return;
    }}throw new Error('No departure after the indoor dwell');
  }finally{f.dispose();}
});

it('holds an unavailable ground position and resumes there when height data returns',()=>{
  const f=fixture();try{
    f.view.sync(snapshot('one',epoch,1),epoch);for(let t=0;t<2000;t+=16)f.view.animate(epoch+t,true);
    const figure=f.view.figures[0]!,a=actorOf(figure),position={...a.position},distance=a.distance;f.view.selectRepresentative('one:0');
    f.setGround(null);for(let t=2000;t<5000;t+=16)f.view.animate(epoch+t,true);
    expect(figure.root.isEnabled()).toBe(false);expect(a.distance).toBe(distance);expect(a.position).toEqual(position);
    expect(f.view.representativeInfo('one:0')?.presence).toBe('ground-unavailable');expect(f.view.selectedRepresentative).toBe('one:0');
    f.setGround(2);f.view.reproject();f.view.animate(epoch+5016,true);
    expect(figure.root.isEnabled()).toBe(true);expect(figure.root.position.y).toBeCloseTo(2.215);
    expect(Math.hypot(a.position.x-position.x,a.position.z-position.z)).toBeLessThan(.05);
  }finally{f.dispose();}
});
it('invalidates cohort replacement without silently selecting the equivalent visual index',()=>{
  const f=fixture();try{
    const state=idleSnapshot(1);f.view.sync(state,epoch);f.view.animate(epoch,true);const id='world:village:idle:idle-cohort:0:0';
    f.view.selectRepresentative(id);expect(f.view.selectedRepresentative).toBe(id);
    const next=idleSnapshot(1);next.village.population!.cohorts![0]!.id='split-cohort';
    f.view.sync(next,epoch+100);expect(f.view.selectedRepresentative).toBeNull();expect(f.view.representativeInfo(id)).toBeNull();
    expect(f.view.representativeInfo('world:village:idle:split-cohort:0:0')?.cohortId).toBe('split-cohort');
  }finally{f.dispose();}
});
it('cancels an obsolete-tail fade if the lot is current again and bounds a necessary retirement',()=>{
  for(const cancel of [true,false]){const f=fixture();try{
    const now=epoch+87000;f.view.sync(snapshot('old',epoch,2),now);f.view.animate(now,true);const figures=f.view.figures;
    for(const figure of figures){const a=actorOf(figure);a.speed=0;a.distance=2;a.position=sampleWorkerPath(a.path,2);a.visible=true;}
    f.view.sync(snapshot('next',epoch+80000,2),now);
    for(let t=33;t<=1200;t+=33)f.view.animate(now+t,true);
    if(cancel)f.view.sync(snapshot('old',epoch,2),now+1200);
    for(let t=1233;t<1600;t+=33)f.view.animate(now+t,true);
    if(cancel){expect(f.view.figures).toEqual(figures);expect(figures[0]!.root.isEnabled()).toBe(true);expect(figures[0]!.root.getChildMeshes()[0]!.visibility).toBeGreaterThan(.95);}
    else{expect(figures.every(p=>p.root.isDisposed())).toBe(true);expect(f.view.metrics.layouts[0]?.id).toBe('next');expect(f.view.figures).toHaveLength(2);}
  }finally{f.dispose();}}
});
it('defers a changed leisure itinerary until the reached door without moving on sync',()=>{
  const f=fixture();try{
    const state=idleSnapshot(1);f.view.sync(state,epoch);f.view.animate(epoch,true);const figure=f.view.figures[0]!,a=actorOf(figure),position={...a.position},path=a.path;
    const next=idleSnapshot(1);next.travelRoutes[0]!.cells=[{cellX:0,cellY:0},{cellX:0,cellY:1},{cellX:2,cellY:1},{cellX:2,cellY:4}];next.cells[1]!.cellX=2;next.travelRoutes[0]!.destination.cellX=2;
    f.view.sync(next,epoch+100);expect(f.view.figures[0]).toBe(figure);expect(a.position).toEqual(position);expect(a.path).toBe(path);
  }finally{f.dispose();}
});

it('reconnects a changed survey route from the current actor through a shared road junction',()=>{
  const f=fixture();try{
    const state=snapshot();state.village.extractions=[];state.village.worksites=[];state.world.widthCells=2048;state.world.heightCells=1024;
    const path=[{cellX:0,cellY:0},{cellX:0,cellY:1},{cellX:0,cellY:3},{cellX:0,cellY:8}];
    state.science={activities:[{id:'survey',villageId:'village',kind:'survey',path:[...path,...path.slice().reverse()],startedAt:new Date(epoch).toISOString(),completesAt:new Date(epoch+80000).toISOString()}]} as unknown as NonNullable<VillageState['science']>;
    f.view.sync(state,epoch);for(let t=0;t<2000;t+=16)f.view.animate(epoch+t,true);const figure=f.view.figures[0]!,a=actorOf(figure),position={...a.position};
    const next=structuredClone(state),changed=[{cellX:0,cellY:0},{cellX:0,cellY:1},{cellX:0,cellY:3},{cellX:4,cellY:3}];
    next.science!.activities[0]!.path=[...changed,...changed.slice().reverse()];
    f.view.sync(next,epoch+2000);expect(a.position).toEqual(position);expect(a.path[0]).toEqual(position);
    expect(a.path).toContainEqual(expect.objectContaining({x:0,z:3}));expect(a.path.at(-1)).toEqual(expect.objectContaining({x:4,z:3}));
    let before=figure.root.position.clone();for(let t=2000;t<14000;t+=16){f.view.animate(epoch+t,true);expect(figure.root.position.subtract(before).length()).toBeLessThan(.1);before=figure.root.position.clone();}
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['work']);
  }finally{f.dispose();}
});

it('installs both actual teammates without a working post blocking the shared route endpoint',()=>{
  const f=fixture();try{
    f.view.sync(snapshot('pair',epoch,2),epoch);for(let t=0;t<20000;t+=16)f.view.animate(epoch+t,true);
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['work','work']);
    const [a,b]=f.view.figures;expect(a!.root.isEnabled()&&b!.root.isEnabled()).toBe(true);
    expect(a!.root.position.subtract(b!.root.position).length()).toBeGreaterThan(.43);
  }finally{f.dispose();}
});

it('keeps a gardener on its row across missing ground instead of advancing its absolute work clock',()=>{
  const f=fixture();try{
    f.view.sync(gardenSnapshot(),epoch+35000);f.view.animate(epoch+35000,true);const figure=f.view.figures[0]!,a=actorOf(figure),position={...a.position};
    f.setGround(null);for(let t=33;t<10000;t+=33)f.view.animate(epoch+35000+t,true);
    expect(a.position).toEqual(position);f.setGround(0);f.view.animate(epoch+45000,true);
    expect(Math.hypot(a.position.x-position.x,a.position.z-position.z)).toBeLessThan(.05);
  }finally{f.dispose();}
});

it('reaches both work posts after the actual corner even if the leader occupies the end gate first',()=>{
  const f=fixture();try{
    const state=snapshot('pair',epoch,2),m=state.village.extractions[0]!;m.cellX=3;m.cellY=6;m.path=[{cellX:0,cellY:0},{cellX:1,cellY:0},{cellX:3,cellY:0},{cellX:3,cellY:6}];m.transportMs=14000;
    f.view.sync(state,epoch);for(let t=0;t<25000;t+=16)f.view.animate(epoch+t,true);
    expect(f.view.metrics.layouts[0]?.phases).toEqual(['work','work']);expect(f.view.figures.every(f=>f.root.isEnabled())).toBe(true);
  }finally{f.dispose();}
});
