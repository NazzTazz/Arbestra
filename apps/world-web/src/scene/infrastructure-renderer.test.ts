import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {emptyInfrastructure,infrastructurePlanSurface,infrastructureSidewalkSurface,type BuildingAccess} from '@arbestra/contracts';
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
    expect(Math.max(...z)-Math.min(...z)).toBeCloseTo(2.5,1); // perimeter grout retained
    expect(Math.max(...y)).toBeCloseTo(.064);
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
   expect(Math.max(...v)-Math.min(...v)).toBeLessThan(.65);
  }
  expect(positions.filter((_,i)=>i%3===1).every(y=>Math.abs(y-2.04)<.00001)).toBe(true);
  // The width includes two quarter-cell sidewalks beside the half-cell road.
  const x=positions.filter((_,i)=>i%3===0);expect(Math.max(...x)-Math.min(...x)).toBeGreaterThan(2);
 }finally{renderer.dispose();scene.dispose();engine.dispose();}
});


it('reduces preview triangles while preserving every fine edge pixel and the total footprint',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),renderer=new InfrastructureRenderer(scene);
 try{
  const plan=emptyInfrastructure();plan.roads=[{id:'edge',operation:'paint',material:'stone-1',width:3,border:true,points:[{x:81,y:81},{x:96,y:81},{x:96,y:90}]}];
  const space=new WorldSpace(512,256,{cellX:10,cellY:10}),surface=infrastructurePlanSurface(plan,{widthCells:512,heightCells:256});
  const pixels=new Map([...surface].filter(([,p])=>p.manual));for(const [k,p]of infrastructureSidewalkSurface(surface,{widthCells:512,heightCells:256}))pixels.set(k,{...p,material:'none',border:false,manual:true,axes:0});
  renderer.update(plan,space,(x,y)=>2+x*.1+y*.2,true,0,undefined,false,[],{followTerrain:true});
  const mesh=renderer.meshes[0]!,p=mesh.getVerticesData('position')!,indices=mesh.getIndices()!;let area=0;
  const coverage=new Map<string,number>();
  for(let i=0;i<indices.length;i+=6){
    const vertices=[indices[i]!,indices[i+1]!,indices[i+2]!,indices[i+5]!].map(j=>space.inverse(p[j*3]!,p[j*3+2]!));
    const xs=vertices.map(v=>Math.round(v.cellX*16)),ys=vertices.map(v=>Math.round(v.cellY*16));
    const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);area+=(x1-x0)*(y1-y0);
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const key=x+':'+y;coverage.set(key,(coverage.get(key)??0)+1);}
  }
  expect(area).toBe(pixels.size);expect([...coverage.keys()].sort()).toEqual([...pixels.keys()].sort());expect([...coverage.values()].every(n=>n===1)).toBe(true);
  expect(indices.length/3).toBeLessThan(pixels.size); // fine raster would have two triangles per pixel
 }finally{renderer.dispose();scene.dispose();engine.dispose();}
});


it('updates only the changed road material and retains unrelated paving and sidewalks',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),renderer=new InfrastructureRenderer(scene);
 try{
  const plan=emptyInfrastructure(),space=new WorldSpace(512,256,{cellX:10,cellY:10});
  plan.roads=[{id:'earth',operation:'paint',material:'earth',width:4,border:false,points:[{x:80,y:80},{x:96,y:80}]},
    {id:'stone',operation:'paint',material:'stone-1',width:4,border:true,points:[{x:160,y:80},{x:176,y:80}]}];
  renderer.update(plan,space,()=>0,false,0,undefined,false,[],{followTerrain:true});
  const earth=renderer.meshes.filter(m=>m.name==='infrastructure-earth'),paving=renderer.meshes.filter(m=>m.name==='infrastructure-stone-1'),sidewalks=renderer.meshes.filter(m=>m.name==='infrastructure-border');
  expect(earth).toHaveLength(1);expect(paving.length).toBeGreaterThan(0);expect(sidewalks.length).toBeGreaterThan(0);
  plan.roads.push({id:'new-earth',operation:'paint',material:'earth',width:4,border:false,points:[{x:80,y:88},{x:96,y:88}]});plan.revision++;
  renderer.update(plan,space,()=>0,false,1,undefined,false,[],{followTerrain:true});
  expect(earth.every(m=>m.isDisposed())).toBe(true);
  expect(renderer.meshes.filter(m=>m.name==='infrastructure-stone-1')).toEqual(paving);expect(renderer.meshes.filter(m=>m.name==='infrastructure-border')).toEqual(sidewalks);
  const added=renderer.meshes.find(m=>m.name==='infrastructure-earth')!;
  renderer.update(plan,space,(x)=>x<15?.2:0,false,2,undefined,false,[],{followTerrain:true});
  expect(added.isDisposed()).toBe(true);expect(renderer.meshes.filter(m=>m.name==='infrastructure-stone-1')).toEqual(paving);expect(renderer.meshes.filter(m=>m.name==='infrastructure-border')).toEqual(sidewalks);
 }finally{renderer.dispose();scene.dispose();engine.dispose();}
});

it('keeps only exposed earth side walls across the RC1 corner seam',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),renderer=new InfrastructureRenderer(scene);
 try{
  const plan=emptyInfrastructure(),world={widthCells:512,heightCells:256};plan.roads=[{id:'earth-seam',operation:'paint',material:'earth',width:4,border:false,points:[{x:4095,y:2047},{x:1,y:2047},{x:1,y:1}]}];
  const surface=infrastructurePlanSurface(plan,world),pixels=new Map([...surface].filter(([,p])=>p.manual));let edges=0;
  for(const p of pixels.values())for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])if(!pixels.has(((p.x+dx!+8192)%8192)+':'+((p.y+dy!+4096)%4096)))edges++;
  renderer.update(plan,new WorldSpace(512,256,{cellX:0,cellY:0}),()=>2,false,0,undefined,false,[],{followTerrain:true});
  expect(renderer.meshes).toHaveLength(1);const mesh=renderer.meshes[0]!,normals=mesh.getVerticesData('normal')!;
  expect(normals.filter((_,i)=>i%3===1).filter(n=>Math.abs(n)<1e-6)).toHaveLength(edges*4);
  const positions=mesh.getVerticesData('position')!,indices=mesh.getIndices()!;
  for(let i=0;i<indices.length;i+=3)for(const axis of [0,2]){const vs=[positions[indices[i]!*3+axis]!,positions[indices[i+1]!*3+axis]!,positions[indices[i+2]!*3+axis]!];expect(Math.max(...vs)-Math.min(...vs)).toBeLessThan(.65);}
 }finally{renderer.dispose();scene.dispose();engine.dispose();}
});
