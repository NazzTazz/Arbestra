import { describe, it, expect } from 'vitest';
import { buildingPlan, entranceConnector, HALL_RECIPE, HOUSE_RECIPE, withBuildingAccesses, resolveMurets, transformPoint, type PlanInput } from './building-plan';
const input:PlanInput={id:'hall',anchor:{cellX:9,cellY:9},cells:[{cellX:9,cellY:9},{cellX:9,cellY:10}],world:{widthCells:32,heightCells:32},recipe:HALL_RECIPE};
describe('modular building factory',()=>{
  it('rebalances ground-floor windows for two entrances on any house facade without losing upstairs windows',()=>{
    const baseline=buildingPlan({...input,cells:[input.anchor],recipe:{...HOUSE_RECIPE,levels:2}});
    const upperWindows=baseline.openings.filter(o=>!o.door&&o.bottom>HOUSE_RECIPE.courses*HOUSE_RECIPE.module.height);
    for(const face of ['-x','+x','-z','+z'] as const){
      const recipe=withBuildingAccesses({...HOUSE_RECIPE,levels:2},face,true),plan=buildingPlan({...input,cells:[input.anchor],recipe});
      expect(plan.accesses).toHaveLength(2);expect(plan.openings.filter(o=>o.door)).toHaveLength(2);
      for(const door of plan.openings.filter(o=>o.door)){
        expect(plan.openings.some(o=>!o.door&&o.face===door.face&&o.bottom<door.top&&o.left<door.right&&o.right>door.left)).toBe(false);
      }
      // The odd storey turns 90 degrees; compare its actual openings, not the ground-floor faces.
      expect(plan.openings.filter(o=>!o.door&&o.bottom>HOUSE_RECIPE.courses*HOUSE_RECIPE.module.height)).toEqual(upperWindows);
    }
  });
  it('assembles a wrapped footprint, preserves exact modules and stone courses',()=>{
    const p=buildingPlan({...input,anchor:{cellX:9,cellY:31},cells:[{cellX:9,cellY:31},{cellX:9,cellY:0}]});
    expect(p.origin.z).toBe(1.25);expect(p.width).toBeCloseTo(2.24);expect(p.depth).toBeCloseTo(4.48);
    expect(p.stones.length).toBeGreaterThan(400);
    for(const s of p.stones){expect((s.length+.003)/.14).toBeCloseTo(Math.round((s.length+.003)/.14));expect(s.height).toBeCloseTo(.137);}
  });
  it('transforms a lateral door with the same quarter turn as the body',()=>{
    const p=buildingPlan({...input,cells:[input.anchor,{cellX:10,cellY:9}],quarterTurns:1});
    const door=transformPoint(p,p.entry.threshold);
    expect(door.x).toBeCloseTo(1.25);expect(door.z).toBeCloseTo(1.12);
    expect(p.rotation).toBe(Math.PI/2);
  });
  it('covers all four corners once on alternating courses',()=>{
    const p=buildingPlan(input);
    for(let row=0;row<4;row++)for(const sx of [-1,1])for(const sz of [-1,1]){
      const x=sx*(p.width/2-.07),z=sz*(p.depth/2-.07),y=(row+.5)*.14;
      const covers=p.stones.filter(s=>Math.abs(s.y-y)<1e-8&&Math.abs(x-s.x)<(s.axis==='x'?s.length/2:s.thickness/2)+.002&&Math.abs(z-s.z)<(s.axis==='z'?s.length/2:s.thickness/2)+.002);
      expect(covers).toHaveLength(1);
    }
  });
  it('rejects unsupported terrain, windows, footprint and boundary passage',()=>{
    expect(()=>buildingPlan({...input,heights:[0,.1]})).toThrow('uneven');
    expect(()=>buildingPlan({...input,recipe:{...HALL_RECIPE,windows:{'-x':[50]}}})).toThrow('windows');
    expect(()=>buildingPlan({...input,cells:[input.anchor,{cellX:11,cellY:10}]})).toThrow('rectangle');
    expect(()=>buildingPlan({...input,recipe:{...HALL_RECIPE,walls:{courses:3,gateWidth:.7}}})).toThrow('passage');
  });
  it('creates one continuous boundary gate even over the cell seam',()=>{
    const p=buildingPlan({...input,recipe:{...HALL_RECIPE,modules:[4,12],walls:{courses:3,gateWidth:.7}}});
    expect(p.murets).toHaveLength(5);expect(p.entry.gate.x).toBe(-1.25);
    const doorSegments=p.murets.filter(w=>w.key.includes(':-x:'));
    expect(doorSegments[0]!.b.z).toBeCloseTo(-.35);expect(doorSegments[1]!.a.z).toBeCloseTo(.35);
  });
  it('routes the visible connector around the building instead of through its walls',()=>{
    const p=buildingPlan(input),route=entranceConnector(p,{x:2.5,y:0,z:0});
    expect(route[0]).toEqual(p.entry.inside);expect(route.at(-1)).toEqual({x:2.5,y:0,z:0});
    for(let i=3;i<route.length;i++){const a=route[i-1]!,b=route[i]!;for(let t=0;t<=1;t+=.1){const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;expect(Math.abs(x)>=p.width/2||Math.abs(z)>=p.depth/2).toBe(true);}}
  });
  it('supports a second habitable level and a fixed works phase without changing its entry',()=>{
    const finished=buildingPlan({...input,cells:[input.anchor],recipe:{...HOUSE_RECIPE,levels:2}});
    const works=buildingPlan({...input,cells:[input.anchor],recipe:{...HOUSE_RECIPE,levels:2},phase:'works',sourceLevels:1});
    expect(works.entry).toEqual(finished.entry);expect(works.height).toBeCloseTo(2.85);expect(works.phase).toBe('works');
    expect(works.openings.some(o=>o.bottom>1.4)).toBe(true);
  });
  it('assigns a shared boundary once and preserves a neighbour gate',()=>{
    const recipe={...HOUSE_RECIPE,modules:[4,4] as [number,number],windows:{},entrance:{...HOUSE_RECIPE.entrance,face:'+x' as const},walls:{courses:3,gateWidth:.7}};
    const a=buildingPlan({...input,id:'a',cells:[input.anchor],recipe});
    const anchor={cellX:10,cellY:9},b=buildingPlan({...input,id:'b',anchor,cells:[anchor],recipe:{...recipe,entrance:{...recipe.entrance,face:'-z'}}});
    const walls=resolveMurets([{plan:b,anchor},{plan:a,anchor:input.anchor}],input.world);
    const sharedA=walls.get('a')!.filter(w=>Math.abs(w.a.x-1.18)<1e-6&&Math.abs(w.b.x-1.18)<1e-6);
    expect(sharedA).toHaveLength(2);expect(sharedA.every(w=>w.a.z>=.35-1e-8||w.b.z<=-.35+1e-8)).toBe(true);
    expect(walls.get('b')!.filter(w=>Math.abs(w.a.x+1.18)<1e-6&&Math.abs(w.b.x+1.18)<1e-6)).toEqual([]);
  });
  it('closes the storey joint with masonry on all four walls',()=>{
    const p=buildingPlan({...input,cells:[input.anchor],recipe:{...HOUSE_RECIPE,levels:2}});
    const y=HOUSE_RECIPE.courses*HOUSE_RECIPE.module.height+HOUSE_RECIPE.floorThickness/2;
    const band=p.stones.filter(s=>Math.abs(s.y-y)<1e-8);
    expect(band.length).toBeGreaterThan(0);
    for(const side of [-1,1])for(const axis of ['x','z'] as const){
      const fixed=side*((axis==='x'?p.depth:p.width)/2-HOUSE_RECIPE.module.thickness/2);
      expect(band.some(s=>s.axis===axis&&Math.abs((axis==='x'?s.z:s.x)-fixed)<1e-8)).toBe(true);
    }
    expect(band.every(s=>Math.abs(s.height-(HOUSE_RECIPE.floorThickness-HOUSE_RECIPE.module.joint))<1e-8)).toBe(true);
  });
});
