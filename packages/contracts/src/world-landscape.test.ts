import { describe, expect, it } from 'vitest';
import { generateLandscape as generate, landscapeNeighbors, landscapeMetrics } from './world-landscape.js';
import { DEFAULT_GENERATOR_PARAMETERS, canTraverseLandscape, naturalStairPairs } from './world-generator.js';
import { buildExposureField, exposureAt, climateAt } from './world-climate.js';
const generateLandscape=(...args:Parameters<typeof generate>)=>generate(args[0],args[1],args[2],args[3],args[4]??2);
describe('exploratory natural landscape',()=>{
  it('reproduces terrain, climate, vegetation and routes independently of object identity',()=>{
    const a=generateLandscape(42,64,64,DEFAULT_GENERATOR_PARAMETERS);
    const b=generateLandscape(42,64,64,JSON.parse(JSON.stringify(DEFAULT_GENERATOR_PARAMETERS)));
    expect(a).toEqual(b);expect(a.altitudeCellRatio).toBe(.25);
    expect(Math.min(...a.elevations)).toBeGreaterThanOrEqual(-8);
    expect(Math.max(...a.elevations)).toBeLessThanOrEqual(8);
    expect(a.metrics.isolatedZones).toBe(0);
    expect(a.stairs.length).toBeGreaterThan(0);
  });
  it('never turns a cliff into a route and provides explicit bidirectional compact stairs',()=>{
    const data=generateLandscape(17,128,64,{...DEFAULT_GENERATOR_PARAMETERS,treePercent:10});
    const edges=new Set(data.stairs.flatMap(s=>naturalStairPairs(s,data.width,data.height).flatMap(([a,b])=>[a+':'+b,b+':'+a])));
    for(const s of data.stairs){
      expect(s.length).toBe(2);expect(s.width).toBe(4);expect(s.high-s.low).toBeLessThanOrEqual(1);
      expect(canTraverseLandscape(data,s.from,s.to)).toBe(true);
      expect(canTraverseLandscape(data,s.to,s.from)).toBe(true);
      const pairs=naturalStairPairs(s,data.width,data.height);
      for(const [a,b]of pairs){expect(canTraverseLandscape(data,a,b)).toBe(true);expect(canTraverseLandscape(data,b,a)).toBe(true);expect(data.woodland[a]!+data.woodland[b]!).toBe(0);}
      expect(canTraverseLandscape(data,pairs[0]![0],pairs[1]![0])).toBe(true);
      const edge=pairs[0]![0],lateral=s.direction===0?((Math.floor(edge/data.width)+data.height-1)%data.height)*data.width+edge%data.width:Math.floor(edge/data.width)*data.width+(edge%data.width+data.width-1)%data.width;
      expect(canTraverseLandscape(data,edge,lateral)).toBe(false);
    }
    let blocked=0;
    for(let i=0;i<data.width*data.height;i++)for(const j of landscapeNeighbors(i,data.width,data.height).slice(0,2)){
      if(data.elevations[i]!==data.elevations[j]&&!edges.has(i+':'+j)){
        expect(canTraverseLandscape(data,i,j)).toBe(false);blocked++;
      }
    }
    expect(blocked).toBeGreaterThan(0);expect(data.metrics.isolatedZones).toBe(0);
    expect(data.walkable.every((v,i)=>!v||data.elevations[i]!>=1)).toBe(true);
  });
  it('reports impossible coverage and relief targets without silently changing parameters',()=>{
    const params={...DEFAULT_GENERATOR_PARAMETERS,waterPercent:100,treePercent:100,meanElevation:8,amplitude:0};
    const data=generateLandscape(7,64,64,params);
    expect(data.metrics.waterPercent).toBeCloseTo(100);expect(data.walkable.some(Boolean)).toBe(false);
    expect(data.metrics.meanElevation).toBeLessThan(0);expect(data.metrics.warnings.length).toBeGreaterThan(1);
    expect(params.meanElevation).toBe(8);
  });
  it('has no climate seam and shares a bounded full-cycle exposure field',()=>{
    const field=buildExposureField();
    expect(exposureAt(field,0,.37)).toBeCloseTo(exposureAt(field,1,.37),12);
    expect(exposureAt(field,.2,0)).toBeCloseTo(exposureAt(field,.2,1),12);
    expect(climateAt(.1,.2,3)).toEqual(climateAt(1.1,1.2,3));
    expect(field.some(v=>v>0)).toBe(true);
  });
  it('counts disconnected walkable regions on each island, even when another island is entirely wooded',()=>{
    const d=generateLandscape(7,64,64,DEFAULT_GENERATOR_PARAMETERS);
    d.stairs=[];
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){
      const i=y*64+x,land=x<16||(x>=32&&x<48);
      d.terrainCodes[i]=land?1:2;d.elevations[i]=land?(x>=8&&x<16?2:1):-1;
      d.woodland[i]=x>=32&&x<48?1:0;d.walkable[i]=x<16?1:0;
    }
    expect(landscapeMetrics(d).isolatedZones).toBe(1);
  });
  it('creates local relief away from a technical eight-cell grid',()=>{
    const d=generateLandscape(42,256,128,DEFAULT_GENERATOR_PARAMETERS);let edges=0,offGrid=0;
    for(let y=0;y<d.height;y++)for(let x=0;x<d.width;x++){
      const i=y*d.width+x;
      if(d.elevations[i]!==d.elevations[y*d.width+(x+1)%d.width]){edges++;if((x+1)%8)offGrid++;}
      if(d.elevations[i]!==d.elevations[((y+1)%d.height)*d.width+x]){edges++;if((y+1)%8)offGrid++;}
    }
    expect(offGrid/edges).toBeGreaterThan(.6);
  });

  it.each([1,2,42].flatMap(seed=>[[64,64],[256,128],[512,256]].map(([w,h])=>({seed,w:w!,h:h!}))))('keeps useful local plateaus and connected dry land: $seed / $w x $h',({seed,w,h})=>{
    const d=generateLandscape(seed,w,h,DEFAULT_GENERATOR_PARAMETERS),q=d.metrics.quality!;
    expect(d.recipeRevision).toBe(2);expect(d.metrics.isolatedZones).toBe(0);expect(d.metrics.landsWithoutAccess).toBe(0);
    expect(q.unreachableDetours).toBe(0);expect(q.offGridBoundaryPercent).toBeGreaterThan(60);
    expect(Math.abs(d.metrics.treePercent-30)).toBeLessThan(1);
    if(w>=256){expect(q.plateauCount).toBeGreaterThan(20);expect(q.largestPlateauCells/(w*h)).toBeLessThan(.35);}
    for(const stair of d.stairs)for(const [a,b]of naturalStairPairs(stair,w,h))expect(canTraverseLandscape(d,a,b)).toBe(true);
  },60000);

});
