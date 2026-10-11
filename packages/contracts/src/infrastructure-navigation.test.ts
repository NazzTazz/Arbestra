import {describe,it,expect,vi} from 'vitest';
import * as infrastructureModule from './infrastructure.js';
import {emptyInfrastructure,infrastructurePlanSurface,infrastructureBorders,infrastructureBlockedPixels,infrastructureBarrierAt,prepareInfrastructureEdit,type RoadStroke} from './infrastructure.js';
import {automaticBraziers} from './automatic-braziers.js';
import {buildingAccesses} from './building-access.js';
import * as buildingAccessModule from './building-access.js';
import {refineTravelRoute,travelDuration,buildTravelNetwork,coarseTravelPath,type TravelRoute} from './travel-paths.js';
import {pathIntersectsBox} from './path-obstacles.js';
import type {VillageState} from './villages.js';
const world={widthCells:64,heightCells:64};
const state=()=>({world,village:{anchorCellX:10,anchorCellY:10},region:{originCellX:0,originCellY:0,width:64,height:64,terrainCodes:Array(4096).fill(1),features:[]},cells:[{cellX:10,cellY:10,footprint:{buildingId:'hall',state:'active'},building:{id:'hall',type:'town-hall',quarterTurns:0}}],travelRoutes:[],infrastructure:emptyInfrastructure()}) as unknown as VillageState;
const road=(points:RoadStroke['points'],width=4,border=false):RoadStroke=>({id:'r',points,width,border,operation:'paint',material:'stone-1'});
describe('infrastructure spatial guarantees',()=>{
  it('does not discard a reachable multi-cell building because its anchor is enclosed by its own footprint',()=>{
    const s=state();s.world={...s.world,id:'enclosed-building',widthCells:512,heightCells:256};
    for(let y=9;y<=11;y++)for(let x=13;x<=15;x++)s.cells.push({cellX:x,cellY:y,footprint:{buildingId:'campus',state:'active'},building:x===14&&y===10?{id:'campus',type:'university',quarterTurns:0}:null} as VillageState['cells'][number]);
    const seed:TravelRoute={id:'campus',kind:'building',destination:{cellX:14,cellY:10},cells:[{cellX:10,cellY:10},{cellX:14,cellY:10}]};
    expect(refineTravelRoute(s,seed)).not.toBeNull();
    const route=buildTravelNetwork(s).find(r=>r.id==='campus');
    expect(route,'real door refinement must not depend on reaching the occupied anchor').toBeDefined();
    expect(route!.cells[0]).toEqual(buildingAccesses(s,'hall')[0]!.position);
    expect(route!.cells.at(-1)).toEqual(buildingAccesses(s,'campus')[0]!.position);
  });

  it('connects the real hall door to a garden on the village anchor even when the coarse route has one point',()=>{
    const s=state();s.cells[0]!.cellX=9;s.village.townHallBuildingId='hall';
    const route:TravelRoute={id:'garden',kind:'garden',destination:{cellX:10,cellY:10},cells:[{cellX:10,cellY:10}]};
    const refined=refineTravelRoute(s,route)!;
    expect(refined.version).toBe(2);
    expect(refined.cells[0]).toEqual(buildingAccesses(s,'hall')[0]!.position);
    expect(refined.cells.at(-1)).toEqual(route.destination);
  });
  it('reuses the same navigation when database rows arrive in a different order',()=>{
    const s=state();s.world.id='cache-row-order';
    s.region.features.push(...[14,15].map((cellX,index)=>({id:`rock-${index}`,type:'stone_outcrop',cellX,cellY:10,deposit:{state:'available',blocksCell:true}} as VillageState['region']['features'][number])));
    const surface=vi.spyOn(infrastructureModule,'infrastructurePlanSurface');
    try {
      const routes=buildTravelNetwork(s);expect(routes.length).toBeGreaterThan(0);
      surface.mockClear();s.region.features.reverse();s.cells.reverse();
      expect(buildTravelNetwork(s)).toEqual(routes.map(route=>({...route,destination:{cellX:route.destination.cellX,cellY:route.destination.cellY}})));
      expect(surface).not.toHaveBeenCalled();surface.mockClear();
      s.region.features[0]!.deposit!.remainingAmount=17;
      s.region.features[0]!.deposit!.reservedAmount=3;
      s.region.features[0]!.deposit!.revision=42;
      buildTravelNetwork(s);expect(surface).not.toHaveBeenCalled();surface.mockClear();
      s.infrastructure!.roads.push(road([{x:80,y:80},{x:112,y:80}]));
      buildTravelNetwork(s);expect(surface).toHaveBeenCalled();
    } finally {surface.mockRestore();}
  });
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
    expect(result.surface).toEqual(infrastructurePlanSurface(result.next,world));
    expect(same.surface).toEqual(infrastructurePlanSurface(same.next,world));
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


it('returns only geometric destinations identically before and after warming the route cache',()=>{
 const s=state();s.world.id='destination-dto-regression';
 s.cells.push({cellX:14,cellY:10,building:{id:'target',type:'dwelling',quarterTurns:0},footprint:{buildingId:'target',state:'active'}} as VillageState['cells'][number]);
 const cold=buildTravelNetwork(s),warm=buildTravelNetwork(s);expect(cold.length).toBeGreaterThan(0);
 expect(cold).toEqual(warm);for(const route of cold)expect(Object.keys(route.destination).sort()).toEqual(['cellX','cellY']);
});


it('reuses fine passages for an identical repaint and invalidates changed navigation geometry',()=>{
 const s=state();s.world.id='effective-road-navigation';
 s.region.features.push({id:'stone',type:'stone_outcrop',cellX:14,cellY:10,deposit:{state:'available',blocksCell:true}} as VillageState['region']['features'][number]);
 const sample=vi.fn(()=>({elevation:1,dry:true,blocked:false}));
 let ground={width:64,height:64,revision:'terrain-one',sample};
 s.infrastructure!.roads=[{...road([{x:80,y:74},{x:112,y:74}],4),id:'earth',material:'earth'}];
 const first=buildTravelNetwork(s,[],ground);expect(first).toHaveLength(1);expect(sample).toHaveBeenCalled();
 sample.mockClear();
 s.infrastructure!.roads.push({...s.infrastructure!.roads[0]!,id:'stone-repaint',material:'stone-1'});s.infrastructure!.revision++;
 const surface=vi.spyOn(infrastructureModule,'infrastructurePlanSurface');
 try{
  expect(buildTravelNetwork(s,[],ground)).toEqual(first);expect(sample.mock.calls.length).toBe(0);expect(surface).toHaveBeenCalledTimes(1);
  surface.mockClear();expect(buildTravelNetwork(s,[],ground)).toEqual(first);expect(surface).not.toHaveBeenCalled();
 }finally{surface.mockRestore();}
 sample.mockClear();
 s.infrastructure!.roads.push({...s.infrastructure!.roads[0]!,id:'wider',width:8});
 const accesses=vi.spyOn(buildingAccessModule,'buildingAccesses');let wider:TravelRoute[];
 try{wider=buildTravelNetwork(s,[],ground);expect(accesses.mock.calls.length).toBeGreaterThan(1);}finally{accesses.mockRestore();}
 // A fresh scope is an uncached witness using the exact same path rules.
 const uncached={...s,world:{...s.world,id:'effective-road-navigation-wider-oracle'}};
 expect(wider).toEqual(buildTravelNetwork(uncached,[],ground));
 s.infrastructure!.equipment.push({id:'blocks-door',x:80,y:74,quarterTurns:0,version:1});
 expect(buildTravelNetwork(s,[],ground)).toEqual([]);
 s.infrastructure!.equipment=[];sample.mockClear();ground={...ground,revision:'terrain-two'};
 sample.mockImplementation(()=>({elevation:1,dry:false,blocked:false}));
 expect(buildTravelNetwork(s,[],ground)).toEqual([]);expect(sample.mock.calls.length).toBeGreaterThan(0);
 sample.mockImplementation(()=>({elevation:1,dry:true,blocked:false}));
 sample.mockClear();s.world.id='effective-road-navigation-other-world';
 expect(buildTravelNetwork(s,[],ground)).toEqual(wider);expect(sample).toHaveBeenCalled();
});


it('keeps exact passage keys across four orientations, rectangular seams and continuous doors',()=>{
 for(const [seam,anchor,target]of [['x',[511,40],[2,40]],['y',[200,255],[200,2]],['corner',[511,255],[2,2]]] as const)for(const quarterTurns of [0,1,2,3] as const){
  const s=state();s.world={...s.world,id:'numeric-passages-'+seam+'-'+quarterTurns,widthCells:512,heightCells:256};
  s.village={...s.village,anchorCellX:anchor[0],anchorCellY:anchor[1],townHallBuildingId:'hall'};
  s.region={...s.region,originCellX:(anchor[0]-32+512)%512,originCellY:(anchor[1]-32+256)%256};
  s.cells=[{cellX:anchor[0],cellY:anchor[1],building:{id:'hall',type:'town-hall',quarterTurns},footprint:{buildingId:'hall',state:'active'}},{cellX:target[0],cellY:target[1],building:{id:'target',type:'dwelling',quarterTurns},footprint:{buildingId:'target',state:'active'}}] as VillageState['cells'];
  s.infrastructure!.roads=[{...road([{x:anchor[0]*8,y:anchor[1]*8},{x:target[0]*8,y:anchor[1]*8},{x:target[0]*8,y:target[1]*8}]),material:'earth'}];
  const sample=vi.fn(()=>({elevation:1,dry:true,blocked:false})),ground={width:512,height:256,revision:'rectangular-dry',sample};
  const cold=buildTravelNetwork(s,[],ground);expect(cold).toHaveLength(1);expect(cold[0]!.cells[0]).toEqual(buildingAccesses(s,'hall')[0]!.position);expect(cold[0]!.cells.at(-1)).toEqual(buildingAccesses(s,'target')[0]!.position);
  sample.mockClear();expect(buildTravelNetwork(s,[],ground)).toEqual(cold);expect(sample).not.toHaveBeenCalled();
  const fresh={...s,world:{...s.world,id:s.world.id+'-uncached'}};expect(buildTravelNetwork(fresh,[],ground)).toEqual(cold);
  sample.mockImplementation(()=>({elevation:1,dry:false,blocked:true}));sample.mockClear();expect(buildTravelNetwork(s,[],{...ground,revision:'rectangular-blocked'})).toEqual([]);expect(sample).toHaveBeenCalled();
 }
 // These close continuous thresholds share an outside lattice node, but have
 // different terrain decisions. Their cache keys must never be rounded together.
 const continuous=state();continuous.world.id='numeric-passages-continuous';
 continuous.cells[0]!.building!.accesses=[{id:'door',x:.36,y:0,dx:1,dy:0,width:.25,principal:true}];
 const route:TravelRoute={id:'resource',kind:'stone',destination:{cellX:14,cellY:10},cells:[{cellX:10,cellY:10},{cellX:14,cellY:10}]};
 const ground={width:64,height:64,revision:'same-continuous-field',sample:(x:number)=>({elevation:1,dry:Math.abs(x-10.37)>.00001,blocked:false})};
 expect(refineTravelRoute(continuous,route,new Set(),undefined,ground)).not.toBeNull();
 continuous.cells[0]!.building!.accesses[0]!.x=.37;
 expect(refineTravelRoute(continuous,route,new Set(),undefined,ground)).toBeNull();
});
