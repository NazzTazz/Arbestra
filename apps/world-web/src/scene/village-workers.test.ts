import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { VillageState } from '@arbestra/contracts';
import { expect, it } from 'vitest';
import { VillageWorkers } from './village-workers';
import { gardenHarvestPoint } from './worker-motion';

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
function fixture(free:(p:{x:number;z:number})=>boolean=()=>true){
  const engine=new NullEngine(),scene=new Scene(engine),material=new StandardMaterial('shared',scene);
  let shift=0;
  const view=new VillageWorkers(scene,{skin:[material,material,material],clothes:Array(5).fill(material),hair:Array(3).fill(material),pants:material,timber:material,stone:material},
    {path:p=>p.map(c=>new Vector3(c.cellX-shift,0,c.cellY)),project:p=>({x:p.cellX-shift,z:p.cellY}),ground:()=>0,
      leisurePath:(_id,p)=>p.map(c=>new Vector3(c.cellX-shift,0,c.cellY)),
      free,key:p=>`${p.x+shift}:${p.z}`,detailed:()=>true});
  return {scene,material,view,rebase:(x:number)=>{shift=x;view.shift(x,0);},dispose:()=>{view.dispose();scene.dispose();engine.dispose();}};
}

it('freezes only the inspected representative while the team and its server assignment continue',()=>{
  const f=fixture();try{
    const state=snapshot('pair',epoch,2);
    state.village.population={total:2,housingCapacity:30,available:0,working:2,resting:0,energyCounts:[],
      cohorts:[{id:'cohort',memberCount:2,activity:'working',restBuildingId:null,restingSince:null,energy:8,assignmentId:'pair',cartographer:true}]};
    f.view.sync(state,epoch);for(let t=0;t<2000;t+=16)f.view.animate(epoch+t,true);
    const id='pair:0',before=f.view.representativePose(id)!;
    expect(before).not.toBeNull();
    const info=f.view.representativeInfo(id)!;
    expect(info.energy).toBe(8);expect(info.qualifications).toEqual(['Cartographe']);expect(info.cohortSize).toBe(2);
    f.view.freezeRepresentative(id);
    const other=f.view.representativePose('pair:1')!.position.clone();
    for(let t=2000;t<5000;t+=16)f.view.animate(epoch+t,true);
    expect(f.view.representativePose(id)!.position.equals(before.position)).toBe(true);
    expect(f.view.representativePose('pair:1')!.position.equals(other)).toBe(false);
    f.view.sync(state,epoch+5000);expect(f.view.representativeInfo(id)!.name).toBe(info.name);
    f.view.freezeRepresentative(null);f.view.animate(epoch+5016,true);
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

it('restores the same row progress after reload and rebasing without resetting the harvest',()=>{
  const f=fixture();try{
    const now=epoch+35000;
    f.view.sync(gardenSnapshot(),now);f.view.animate(now,true);
    const expected=gardenHarvestPoint({x:0,z:2},33/60),gardener=f.view.figures[0]!;
    expect(gardener.root.position.x).toBeCloseTo(expected.x,8);expect(gardener.root.position.z).toBeCloseTo(expected.z,8);
    f.view.animate(now+10,false);f.view.animate(now+1000,true);
    const resumed=gardenHarvestPoint({x:0,z:2},34/60);
    expect(gardener.root.position.x).toBeCloseTo(resumed.x,8);expect(gardener.root.position.z).toBeCloseTo(resumed.z,8);
    f.rebase(100);f.view.reproject();f.view.animate(now+1034,true);
    expect(gardener.root.position.x+100).toBeCloseTo(resumed.x,2);
    expect(gardener.root.position.z).toBeCloseTo(resumed.z,2);
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
