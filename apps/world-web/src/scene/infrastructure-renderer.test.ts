import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {emptyInfrastructure,type BuildingAccess} from '@arbestra/contracts';
import {InfrastructureRenderer} from './infrastructure-renderer';
import {WorldSpace} from './world-space';

it('retains road meshes for an unrelated chunk revision and rebuilds for local ground changes',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),renderer=new InfrastructureRenderer(scene);
  try{
    const plan=emptyInfrastructure();plan.roads=[{id:'road',operation:'paint',material:'stone-1',width:4,border:true,points:[{x:80,y:80},{x:96,y:80}]}];
    const space=new WorldSpace(64,64,{cellX:10,cellY:10});
    renderer.update(plan,space,()=>0,false,1);const first=[...renderer.meshes];expect(first.length).toBeGreaterThan(0);
    renderer.update(plan,space,()=>0,false,2);expect(renderer.meshes).toEqual(first);expect(first.every(m=>!m.isDisposed())).toBe(true);
    renderer.update(plan,space,()=>.2,false,3);expect(renderer.meshes[0]).not.toBe(first[0]);expect(first.every(m=>m.isDisposed())).toBe(true);
  }finally{renderer.dispose();scene.dispose();engine.dispose();}
});

it('renders wide flush sidewalks continuously across a building exit',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),renderer=new InfrastructureRenderer(scene);
  try{
    const plan=emptyInfrastructure();plan.roads=[{id:'road',operation:'paint',material:'stone-1',width:4,border:true,points:[{x:80,y:80},{x:96,y:80}]}];
    const space=new WorldSpace(64,64,{cellX:10,cellY:10});
    renderer.update(plan,space,()=>0);
    const mesh=renderer.meshes.find(m=>m.name==='infrastructure-border')!;
    const positions=mesh.getVerticesData('position')!;
    const z=positions.filter((_,i)=>i%3===2),y=positions.filter((_,i)=>i%3===1);
    // Four useful subdivisions plus two subdivisions of sidewalk on either side.
    expect(Math.max(...z)-Math.min(...z)).toBeCloseTo(2.5);
    expect(Math.max(...y)).toBeCloseTo(.004);
    const exit={position:{cellX:11,cellY:9.5},outside:{cellX:11,cellY:10.5},normal:{x:0,y:1},width:.5} as BuildingAccess;
    renderer.update(plan,space,()=>0,false,0,undefined,false,[exit]);
    expect(renderer.meshes.find(m=>m.name==='infrastructure-border')!.getVerticesData('position')).toEqual(positions);
  }finally{renderer.dispose();scene.dispose();engine.dispose();}
});
