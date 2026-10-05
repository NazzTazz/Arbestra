import {describe,it,expect} from 'vitest';
import {emptyInfrastructure,infrastructurePlanSurface,infrastructureBorders,infrastructureBlockedPixels,infrastructureBarrierAt,prepareInfrastructureEdit,type RoadStroke} from './infrastructure.js';
import {automaticBraziers} from './automatic-braziers.js';
import {buildingAccesses} from './building-access.js';
import {refineTravelRoute,travelDuration,buildTravelNetwork,coarseTravelPath,type TravelRoute} from './travel-paths.js';
import {pathIntersectsBox} from './path-obstacles.js';
import type {VillageState} from './villages.js';
const world={widthCells:64,heightCells:64};
const state=()=>({world,village:{anchorCellX:10,anchorCellY:10},region:{originCellX:0,originCellY:0,width:64,height:64,terrainCodes:Array(4096).fill(1),features:[]},cells:[{cellX:10,cellY:10,footprint:{buildingId:'hall',state:'active'},building:{id:'hall',type:'town-hall',quarterTurns:0}}],travelRoutes:[],infrastructure:emptyInfrastructure()}) as unknown as VillageState;
const road=(points:RoadStroke['points'],width=4,border=false):RoadStroke=>({id:'r',points,width,border,operation:'paint',material:'stone-1'});
describe('infrastructure spatial guarantees',()=>{
  it('uses the authoritative hall identity even when neither anchor nor footprint contains the village anchor',()=>{
    const s=state();s.village.anchorCellX=12;s.village.townHallBuildingId='hall';
    s.cells.unshift({cellX:12,cellY:10,footprint:{buildingId:'neighbor',state:'active'},building:{id:'neighbor',type:'town-hall'}} as VillageState['cells'][number]);
    const r:TravelRoute={id:'rock',kind:'stone',destination:{cellX:14,cellY:10},cells:[{cellX:12,cellY:10},{cellX:14,cellY:10}]};
    expect(refineTravelRoute(s,r)?.cells[0]).toEqual(buildingAccesses(s,'hall')[0]!.position);
  });
  it('keeps the established corridor for nearby destinations when adding fine door connections',()=>{
    const s=state();
    for(const [i,p]of [[16,8],[16,12],[20,8],[20,12]].entries())s.cells.push({cellX:p[0],cellY:p[1],footprint:{buildingId:`house-${i}`,state:'active'},building:{id:`house-${i}`,type:'dwelling'}} as VillageState['cells'][number]);
    const routes=buildTravelNetwork(s);expect(routes).toHaveLength(4);
    for(const id of ['house-1','house-3']){
      const cells=coarseTravelPath(routes.find(r=>r.id===id)!.cells,s.world);
      for(let x=12;x<=15;x++)expect(cells).toContainEqual({cellX:x,cellY:10});
    }
  });
  it('finds the local multi-cell hall through the village anchor footprint',()=>{
    const s=state();s.village.anchorCellX=11;
    s.cells.push({cellX:11,cellY:10,footprint:{buildingId:'hall',state:'active'},building:null} as VillageState['cells'][number]);
    s.cells.unshift({cellX:3,cellY:3,footprint:{buildingId:'neighbor',state:'active'},building:{id:'neighbor',type:'town-hall'}} as VillageState['cells'][number]);
    const r:TravelRoute={id:'rock',kind:'stone',destination:{cellX:14,cellY:10},cells:[{cellX:11,cellY:10},{cellX:14,cellY:10}]};
    const result=refineTravelRoute(s,r)!;
    expect(result.version).toBe(2);expect(result.cells[0]).toEqual(buildingAccesses(s,'hall')[0]!.position);
  });
  it('does not light a phantom corner leading into an occupied building',()=>{
    const s=state();s.cells.push({cellX:12,cellY:11,footprint:{buildingId:'house',state:'active'}} as VillageState['cells'][number]);
    s.travelRoutes=[{id:'house',kind:'building',destination:{cellX:12,cellY:11},cells:[{cellX:11,cellY:12},{cellX:12,cellY:12},{cellX:12,cellY:11}]}];
    expect(automaticBraziers(s)).toEqual([]);
  });
  it('retracts a replaced width without destroying a crossing and removes internal curbs',()=>{
    const wide=road([{x:80,y:80},{x:112,y:80}],8,true),cross=road([{x:96,y:64},{x:96,y:96}],4,true),narrow={...wide,width:2};
    const s=infrastructurePlanSurface({...emptyInfrastructure(),roads:[wide,cross,narrow]},world);
    expect(s.get('168:156')?.manual).toBe(false);expect(s.get('192:148')?.manual).toBe(true);
    const edges=infrastructureBorders(s,world);expect([...edges.values()].some(e=>e.x===191&&e.y===159)).toBe(false);
  });
  it('edits automatic paving without charging its unchanged inherited surface',()=>{
    const s=state();s.travelRoutes=[{id:'house',kind:'building',destination:{cellX:14,cellY:12},cells:[{cellX:12,cellY:12},{cellX:13,cellY:12},{cellX:14,cellY:12}]}];
    const result=prepareInfrastructureEdit(s,{kind:'road',stroke:road([{x:104,y:96},{x:108,y:96}],3,true)},'edit');
    expect(result.next.inheritedCells).toContain('13:12');expect(result.quote.stoneUnits).toBeGreaterThan(0);
    s.infrastructure=result.next;const same=prepareInfrastructureEdit(s,{kind:'road',stroke:road([{x:104,y:96},{x:108,y:96}],3,true)},'same');
    expect(same.next).toBe(s.infrastructure);expect(same.quote.stoneUnits).toBe(0);
  });
  it('does not recreate automatic fires from removed historical arms',()=>{
    const s=state(),corner=road([{x:96,y:96},{x:128,y:96},{x:128,y:128}]);s.infrastructure!.roads=[corner];
    expect(automaticBraziers(s).length).toBeGreaterThan(0);
    s.infrastructure!.roads.push({...corner,operation:'remove'});expect(automaticBraziers(s)).toEqual([]);
  });
  it('includes the real legacy door and uses one second per physical cell, not per vertex',()=>{
    const s=state(),r:TravelRoute={id:'rock',kind:'stone',destination:{cellX:14,cellY:10},cells:[{cellX:10,cellY:10},{cellX:14,cellY:10}]};
    const fine=refineTravelRoute(s,r)!;expect(fine.version).toBe(2);expect(fine.cells[0]!.cellX).toBe(10);expect(fine.cells[0]!.cellY).toBeCloseTo(9.584);
    expect(travelDuration([{cellX:0,cellY:0},{cellX:.125,cellY:0},{cellX:1,cellY:0}],world)).toBe(1000);
    expect(travelDuration([{cellX:63.875,cellY:0},{cellX:0,cellY:0}],world)).toBe(125);
    expect(travelDuration(fine.cells,world)).toBeLessThan((fine.cells.length-1)*1000);
  });
  it('selects among multiple rotated accesses by physical route length',()=>{
    const s=state();s.cells.push({cellX:15,cellY:10,footprint:{buildingId:'house',state:'active'},building:{id:'house',type:'dwelling',quarterTurns:0,accesses:[{id:'left',x:-.336,y:0,dx:-1,dy:0,width:.25,principal:true},{id:'right',x:.336,y:0,dx:1,dy:0,width:.25,principal:false}]}} as VillageState['cells'][number]);
    const r:TravelRoute={id:'house',kind:'building',destination:{cellX:15,cellY:10},cells:[{cellX:10,cellY:10},{cellX:15,cellY:10}]};
    expect(refineTravelRoute(s,r)!.cells.at(-1)!.cellX).toBeCloseTo(14.664);expect(refineTravelRoute(s,r)!.cells.at(-1)!.cellY).toBe(10);
    s.cells[1]!.building!.quarterTurns=1;expect(buildingAccesses(s,'house')[0]!.normal).toEqual({x:0,y:1});
  });
  it('keeps cached navigation isolated and invalidates it when a physical obstacle changes',()=>{
    const s=state();s.region.features.push({id:'rock',type:'stone_outcrop',cellX:14,cellY:10,deposit:{state:'available',blocksCell:true}} as VillageState['region']['features'][number]);
    const first=buildTravelNetwork(s);expect(first).toHaveLength(1);first[0]!.cells[0]!.cellX=42;
    expect(buildTravelNetwork(s)[0]!.cells[0]!.cellX).toBe(10);
    s.infrastructure!.equipment.push({id:'barrier',x:96,y:72,quarterTurns:0,version:1});
    const next=buildTravelNetwork(s)[0]!;expect(next.cells.some(p=>p.cellX===12&&p.cellY===9)).toBe(false);
  });
  it('rejects an obstacle between the real threshold and the first fine-grid node',()=>{
    const s=state(),r:TravelRoute={id:'rock',kind:'stone',destination:{cellX:14,cellY:10},cells:[{cellX:10,cellY:10},{cellX:14,cellY:10}]};
    expect(refineTravelRoute(s,r)).not.toBeNull();
    s.infrastructure!.equipment.push({id:'blocks-door',x:80,y:74,quarterTurns:0,version:1});
    expect(refineTravelRoute(s,r)).toBeNull();
  });
  it('starts at this village hall even when the spatial snapshot lists a neighboring hall first',()=>{
    const s=state();s.cells.unshift({cellX:3,cellY:3,footprint:{buildingId:'neighbor',state:'active'},building:{id:'neighbor',type:'town-hall'}} as VillageState['cells'][number]);
    const r:TravelRoute={id:'rock',kind:'stone',destination:{cellX:14,cellY:10},cells:[{cellX:10,cellY:10},{cellX:14,cellY:10}]};
    const path=refineTravelRoute(s,r)!.cells;expect(path[0]!.cellX).toBe(10);expect(path[0]!.cellY).toBeCloseTo(9.584);
  });
  it('crosses a sidewalk without detouring or blocking a journey',()=>{
    const s=state(),r:TravelRoute={id:'rock',kind:'stone',destination:{cellX:24,cellY:10},cells:Array.from({length:15},(_,i)=>({cellX:10+i,cellY:10}))};
    const simple=refineTravelRoute(s,r)!;
    expect(simple.cells.some((p,i)=>i>0&&Math.abs(p.cellX-simple.cells[i-1]!.cellX)>=1)).toBe(true);
    expect(travelDuration(simple.cells,world)).toBeLessThan(16_000);
    s.infrastructure!.roads=[road([{x:96,y:64},{x:96,y:96}],4,true)];
    const detour=refineTravelRoute(s,r)!;expect(detour).not.toBeNull();
    expect(detour.cells.every(p=>p.cellY>=8&&p.cellY<=12)).toBe(true);
    const barriers=infrastructureBlockedPixels(s.infrastructure!,world);
    for(let i=1;i<detour.cells.length;i++){
      const a=detour.cells[i-1]!,b=detour.cells[i]!,steps=Math.ceil((Math.abs(b.cellX-a.cellX)+Math.abs(b.cellY-a.cellY))*32);
      for(let j=0;j<=steps;j++)expect(infrastructureBarrierAt(barriers,{cellX:a.cellX+(b.cellX-a.cellX)*j/steps,cellY:a.cellY+(b.cellY-a.cellY)*j/steps},world)).toBe(false);
    }
    expect(barriers.size).toBe(0);
    expect(travelDuration(detour.cells,world)).toBeLessThan(16_000);
  });
  it('expands long legs and the torus seam for inherited paving without changing transport',()=>{
    expect(coarseTravelPath([{cellX:62.875,cellY:10},{cellX:1.125,cellY:10}],world)).toEqual([{cellX:63,cellY:10},{cellX:0,cellY:10},{cellX:1,cellY:10}]);
    const s=state();s.travelRoutes=[{id:'house',kind:'building',destination:{cellX:16,cellY:12},cells:[{cellX:10,cellY:12},{cellX:16,cellY:12}]}];
    const edit=prepareInfrastructureEdit(s,{kind:'road',stroke:road([{x:104,y:96},{x:108,y:96}],3,true)},'edit');
    expect(edit.next.inheritedRoads!.some(r=>r.id.startsWith('inherited:13:12:'))).toBe(true);
  });
  it('detects a swept obstacle across an unsampled segment and across the torus seam',()=>{
    expect(pathIntersectsBox([{cellX:1,cellY:1},{cellX:5,cellY:1}],{cellX:3,cellY:1},.1,.1,world)).toBe(true);
    expect(pathIntersectsBox([{cellX:63.875,cellY:1},{cellX:.125,cellY:1}],{cellX:0,cellY:1},.04,.04,world)).toBe(true);
  });
});
