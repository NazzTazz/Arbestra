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


it('drapes confirmed and preview masonry onto continuous RC1 relief at every vertex',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),renderer=new InfrastructureRenderer(scene);
 try {
  const plan=emptyInfrastructure();plan.roads=[{id:'road',operation:'paint',material:'earth',width:4,border:false,points:[{x:80,y:80},{x:96,y:80}]}];
  const space=new WorldSpace(512,256,{cellX:5,cellY:5}),height=(x:number,y:number)=>2+x*.1+y*.2;
  for(const material of ['earth','rubble'] as const)for(const preview of [false,true]) {
   plan.roads[0]!.material=material;
   renderer.update(plan,space,height,preview,1,undefined,false,[],{followTerrain:true});renderer.setInvalid(false);
   expect(renderer.materials.preview!.alpha).toBe(.65);
   if(preview){expect(renderer.meshes).toHaveLength(1);expect(renderer.meshes[0]!.getTotalVertices()).toBeLessThan(renderer.meshes[0]!.getTotalIndices()/3);expect(renderer.meshes[0]!.getVerticesData('normal')!.filter((_,i)=>i%3===1).every(y=>y>0)).toBe(true);}
   for(const mesh of renderer.meshes){const p=mesh.getVerticesData('position')!;let min=Infinity,max=-Infinity;
    for(let i=0;i<p.length;i+=3){const c=space.inverse(p[i]!,p[i+2]!);const relative=p[i+1]!-height(c.cellX,c.cellY);min=Math.min(min,relative);max=Math.max(max,relative);}
    expect(max).toBeCloseTo(preview?.04:.015,4);expect(min).toBeCloseTo(preview?.04:-.01,4);
    expect(mesh.material?.name).toBe('infrastructure-'+(preview?'preview':material));
    if(material==='rubble'&&!preview)expect(renderer.materials.rubble!.diffuseColor.toHexString().toLowerCase()).toBe('#b7b8b2');
   }
  }
 }finally{renderer.dispose();scene.dispose();engine.dispose();}
});

it('keeps the continuous preview local across both RC1 seams and includes its sidewalk footprint',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),renderer=new InfrastructureRenderer(scene);
 try{
  const plan=emptyInfrastructure();plan.roads=[{id:'corner',operation:'paint',material:'stone-1',width:4,border:true,points:[{x:4095,y:2047},{x:1,y:2047},{x:1,y:1}]}];
  const space=new WorldSpace(512,256,{cellX:0,cellY:0});
  renderer.update(plan,space,()=>2,true,0,undefined,false,[],{followTerrain:true});renderer.setInvalid(true);
  expect(renderer.meshes).toHaveLength(1);const mesh=renderer.meshes[0]!,positions=mesh.getVerticesData('position')!,indices=mesh.getIndices()!;
  expect(mesh.isPickable).toBe(false);expect(renderer.materials.preview!.alpha).toBe(.65);
  for(let i=0;i<indices.length;i+=3)for(const axis of [0,2]){
   const v=[positions[indices[i]!*3+axis]!,positions[indices[i+1]!*3+axis]!,positions[indices[i+2]!*3+axis]!];
   expect(Math.max(...v)-Math.min(...v)).toBeLessThan(.2);
  }
  expect(positions.filter((_,i)=>i%3===1).every(y=>Math.abs(y-2.04)<.00001)).toBe(true);
  // The width includes two quarter-cell sidewalks beside the half-cell road.
  const x=positions.filter((_,i)=>i%3===0);expect(Math.max(...x)-Math.min(...x)).toBeGreaterThan(2);
 }finally{renderer.dispose();scene.dispose();engine.dispose();}
});
