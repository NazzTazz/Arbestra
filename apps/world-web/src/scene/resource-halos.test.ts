import {expect,it} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {Color3} from '@babylonjs/core/Maths/math.color';
import type {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {vertexSurface} from '@arbestra/contracts';
import type {VillageState} from '@arbestra/contracts';
import {ResourceHalos,RESOURCE_HALO_LIFT} from './resource-halos';
import {TerrainStore} from './terrain-store';
import {WorldSpace} from './world-space';

function fixture(){
  const engine=new NullEngine(),scene=new Scene(engine),halos=new ResourceHalos(scene);
  const cell={cellX:31,cellY:31},space=new WorldSpace(64,64,{cellX:30,cellY:30});
  const surface=vertexSurface({widthCells:64,heightCells:64},(x,y)=>5+Math.sin(x)*.4+Math.cos(y)*.3,[]);
  const state={world:{id:'test',widthCells:64,heightCells:64,chunkSize:32},cells:[],village:{worksites:[],extractions:[]},
    region:{originCellX:0,originCellY:0,width:64,height:64,terrainCodes:Array(4096).fill(1),elevations:Array(4096).fill(0),features:[],
      vertexHeights:Array.from({length:65*65},(_,i)=>surface.height(i%65,Math.floor(i/65)))}} as unknown as VillageState;
  const store=new TerrainStore(state,async()=>{throw Error('No network in halo test');});
  let time=0;
  const tick=(enabled=true)=>halos.update(time+=40,space,store,enabled,1);
  const at=(now:number)=>{time=now;halos.update(now,space,store,true,1);};
  const settle=()=>{for(let i=0;i<10;i++)tick();};
  const dispose=()=>{halos.dispose();store.dispose();scene.dispose();engine.dispose();};
  return {scene,halos,cell,space,store,state,surface,tick,at,settle,dispose};
}

it('anchors every selected footprint vertex above the elevated terrain, following its two triangles',()=>{
  const f=fixture();try{
    f.halos.setPending([f.cell]);f.tick();f.settle();
    const mesh=f.scene.getMeshByName('resource-halo-31:31')!;
    expect(mesh.position.x).toBe(2.5);expect(mesh.position.z).toBe(2.5);
    const positions=mesh.getVerticesData(VertexBuffer.PositionKind)!;
    for(let i=0;i<positions.length;i+=3){
      const expected=f.surface.sample(f.cell.cellX+positions[i]!/2.5,f.cell.cellY+positions[i+2]!/2.5)*2.5;
      expect(positions[i+1]).toBeCloseTo(expected+RESOURCE_HALO_LIFT,5);
      expect(positions[i+1]).toBeGreaterThan(10);
    }
    expect(mesh.isPickable).toBe(false);expect(mesh.renderingGroupId).toBe(0);
  }finally{f.dispose();}
});

it('retains selections during a swipe and completes the animation even when the receipt arrives early',()=>{
  const f=fixture();try{
    f.halos.setPending([f.cell]);f.tick();const mesh=f.scene.getMeshByName('resource-halo-31:31')!;
    expect(mesh.visibility).toBe(.65);
    f.halos.setPending([f.cell,{cellX:30,cellY:31}]);f.settle();
    expect(f.scene.getMeshByName(mesh.name)).toBe(mesh);expect(f.halos.pendingCount).toBe(2);
    f.halos.setPending([]);f.tick();expect(mesh.visibility).toBe(.65);
    f.at(1040);expect(mesh.visibility).toBeCloseTo(.325);
    f.at(1540);expect(mesh.isDisposed()).toBe(true);expect(f.halos.pendingCount).toBe(0);
  }finally{f.dispose();}
});

it('follows terrain revisions and a toric rebase, and hides smoothly outside exploitation',()=>{
  const f=fixture();try{
    f.halos.setPending([f.cell]);f.tick();f.settle();const mesh=f.scene.getMeshByName('resource-halo-31:31')!;
    const before=mesh.getVerticesData(VertexBuffer.PositionKind)![1]!;
    f.store.observe({...f.state,region:{...f.state.region,vertexHeights:f.state.region.vertexHeights!.map(h=>h+2)}});
    f.space.rebase({cellX:63,cellY:63},32);f.tick();
    expect(mesh.getVerticesData(VertexBuffer.PositionKind)![1]).toBeCloseTo(before+5,5);
    expect(mesh.position.x).toBe(-2.5);expect(mesh.position.z).toBe(-2.5);
    f.tick(false);expect(mesh.visibility).toBeGreaterThan(0);for(let i=0;i<10;i++)f.tick(false);
    expect(mesh.isEnabled()).toBe(false);
  }finally{f.dispose();}
});

it('waits for known terrain instead of displaying a selection at altitude zero',()=>{
  const f=fixture();try{
    f.halos.setPending([f.cell]);
    f.halos.update(0,f.space,{ground:()=>null,groundRevisionAt:()=>0},true,1);
    expect(f.scene.meshes).toHaveLength(0);
    f.tick();f.settle();expect(f.halos.pendingCount).toBe(1);
    f.halos.clear();expect(f.scene.meshes).toHaveLength(0);
  }finally{f.dispose();}
});

it('keeps garden halos above the raised, flat crop surface rather than burying them in the soil',()=>{
  const f=fixture();try{
    f.halos.setPending([{...f.cell,garden:true}]);f.tick();f.settle();
    const mesh=f.scene.getMeshByName('resource-halo-31:31')!;
    const expected=f.store.ground(31,31)!.height+.16+RESOURCE_HALO_LIFT;
    const positions=mesh.getVerticesData(VertexBuffer.PositionKind)!;
    for(let i=1;i<positions.length;i+=3)expect(positions[i]).toBeCloseTo(expected,5);
  }finally{f.dispose();}
});

it('uses brown, grey and orange for available wood, stone and carrots',()=>{
  const f=fixture();try{
    f.halos.setAvailable([{...f.cell,resource:'wood'},{cellX:30,cellY:31,resource:'stone'},{cellX:32,cellY:31,resource:'carrot',garden:true}]);
    f.tick();f.settle();
    for(const [key,hex] of [['31:31','#AC8056'],['30:31','#AEB3B8'],['32:31','#ED9645']]){
      const mesh=f.scene.getMeshByName(`resource-halo-${key}`)!;
      expect((mesh.material as StandardMaterial).emissiveColor.toHexString()).toBe(hex);expect(mesh.visibility).toBe(.65);
    }
  }finally{f.dispose();}
});

it('turns the same halo white in 500 ms, then fades in 1000 ms without replaying on updates',()=>{
  const f=fixture();try{
    const cell={...f.cell,resource:'stone' as const};f.halos.setAvailable([cell]);f.at(0);f.at(300);
    const mesh=f.scene.getMeshByName('resource-halo-31:31')!,sharedCount=f.scene.materials.length;
    const initial=(mesh.material as StandardMaterial).emissiveColor.clone();
    f.halos.setPending([{...f.cell,resource:undefined}]);f.at(300);expect(mesh.visibility).toBe(.65);
    f.at(550);expect((mesh.material as StandardMaterial).emissiveColor.equalsWithEpsilon(Color3.Lerp(initial,Color3.White(),.5))).toBe(true);
    f.halos.setAvailable([cell]);f.halos.setPending([cell]);f.at(800);
    expect(f.scene.getMeshByName(mesh.name)).toBe(mesh);expect((mesh.material as StandardMaterial).emissiveColor.toHexString()).toBe('#FFFFFF');
    expect(mesh.visibility).toBe(.65);
    f.at(1300);expect(mesh.visibility).toBeCloseTo(.325);
    f.at(1800);expect(mesh.visibility).toBe(0);expect(mesh.isEnabled()).toBe(false);
    expect(f.scene.materials).toHaveLength(sharedCount);
    f.halos.setPending([cell]);f.at(2500);expect(mesh.visibility).toBe(0);
  }finally{f.dispose();}
});
