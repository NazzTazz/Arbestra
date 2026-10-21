import {it,expect,vi} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import type {TerrainChunk,VillageState} from '@arbestra/contracts';
import {buildTerrainUnit} from './terrain-unit';
import {WorldSpace} from './world-space';
import {RegionalOverview} from './terrain-overview-view';
import {planForSite} from './building-plan';
import {VillageRoads} from './village-roads';
import {delta} from './world-space';

it('uses the existing grass atlas with different tiles over the actual RC1 mesh',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),material=new StandardMaterial('atlas',scene);
 try {
  const chunk:TerrainChunk={chunkX:0,chunkY:0,originCellX:0,originCellY:0,terrainCodes:Array(34**2).fill(1),elevations:Array(34**2).fill(100),features:[],occupiedCells:[],rc1:{stride:65,heights:Array(65**2).fill(1),water:Array(65**2).fill(0),terraces:[]}};
  const meshes=buildTerrainUnit(scene,chunk,0,0,new WorldSpace(512,256,{cellX:0,cellY:0}),material,material),ground=meshes[0]!;
  expect(ground.material).toBe(material);
  const uv=ground.getVerticesData('uv')!;expect(uv).not.toBeNull();
  const tiles=new Set(Array.from({length:uv.length/6},(_,i)=>Math.floor(uv[i*6]!*8)));
  expect(tiles.size).toBeGreaterThan(1);
  const positions=ground.getVerticesData('position')!;expect(positions.filter((_,i)=>i%3===1).every(y=>y===2.5)).toBe(true);
 }finally {scene.dispose();engine.dispose();}
});

it('anchors a factory to continuous streamed terrain instead of its rounded snapshot',()=>{
 const site={cellX:511,cellY:255,footprint:{buildingId:'hall'},building:{id:'hall',type:'town-hall',level:1,targetLevel:null,status:'completed',visualLayout:{recipe:'town-hall',quarterTurns:1,offset:[0,0],entranceFace:'+x'}}};
 const state={world:{widthCells:512,heightCells:256},cells:[site,{cellX:0,cellY:255,footprint:{buildingId:'hall'}}],region:{originCellX:511,originCellY:255,width:2,height:1,elevations:[100,100]}} as unknown as VillageState;
 const plan=planForSite(state,state.cells[0]!,()=>3.125);
 expect(plan!.origin.y).toBeCloseTo(3.145);
});

it('does not invent rectangular resource masses on RC1 regional zoom',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),view=new RegionalOverview(scene);
 try {
  const world={id:'world',generationVersion:3,widthCells:512,heightCells:256,chunkSize:32};
  view.set({world,gridWidth:1,gridHeight:1,waterCoverage:[0],rockCoverage:[255],meanElevations:[100]} as Parameters<RegionalOverview['set']>[0]);
  view.update(new WorldSpace(512,256,{cellX:0,cellY:0}),{cellX:0,cellY:0});
  expect(scene.getMeshByName('regional-forest-rock-masses')).toBeNull();
 }finally{view.dispose();scene.dispose();engine.dispose();}
});


it('renders automatic earth routes above continuous relief across both world seams and reuses unchanged meshes',()=>{
 vi.stubGlobal('OffscreenCanvas',class{width:number;height:number;constructor(w:number,h:number){this.width=w;this.height=h;}getContext(){return{fillRect(){},canvas:this};}});
 const engine=new NullEngine(),scene=new Scene(engine),roads=new VillageRoads(scene),space=new WorldSpace(512,256,{cellX:511,cellY:255});
 try {
  const a={cellX:511,cellY:255},b={cellX:0,cellY:255},c={cellX:0,cellY:0};
  const routes=[{id:'house',kind:'building' as const,cells:[a,b],destination:b},{id:'resource',kind:'stone' as const,cells:[a,b,c],destination:c}];
  const ground=(p:{cellX:number;cellY:number})=>({code:1,height:2+.3*delta(p.cellX,511,512)+.2*delta(p.cellY,255,256)});
  roads.update('1',routes,space,ground,true);
  const meshes=scene.meshes.filter(m=>m.name.startsWith('village-road-'));expect(meshes.length).toBeGreaterThan(0);
  for(const mesh of meshes) {
   expect(mesh.material!.name).toBe('infrastructure-earth');
   const positions=mesh.getVerticesData('position')!;
   let max=-Infinity,min=Infinity;
   for(let i=0;i<positions.length;i+=3){const h=ground(space.inverse(positions[i]!,positions[i+2]!)).height;max=Math.max(max,positions[i+1]!-h);min=Math.min(min,positions[i+1]!-h);}
   expect(max).toBeCloseTo(.015,4);
   expect(min).toBeCloseTo(-.01,4); // The shared renderer closes exposed edges below the ground.
  }
  roads.update('2',routes,space,ground,true);expect(scene.meshes.filter(m=>m.name.startsWith('village-road-'))).toEqual(meshes);
  roads.update('3',routes,space,p=>({...ground(p),height:ground(p).height+.5}),true);expect(meshes.every(m=>m.isDisposed())).toBe(true);
 }finally{roads.dispose();scene.dispose();engine.dispose();vi.unstubAllGlobals();}
});
