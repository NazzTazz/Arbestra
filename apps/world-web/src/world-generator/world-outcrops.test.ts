import {expect,it} from 'vitest';
import {generateGeographicLandscape,DEFAULT_GEOGRAPHY_PARAMETERS} from '@arbestra/contracts/world-geography';
import {buildWorldGeometry,createRenderedGroundSampler} from './world-geography-mesh';
import {buildWorldOutcrops,createWorldOutcropField} from './world-outcrops';
const data=generateGeographicLandscape(42,64,64,DEFAULT_GEOGRAPHY_PARAMETERS,8);
const rock={x:.2,y:32,elevation:0,width:3,depth:2,height:1.5,rotation:.3,shade:1};
const fixture={...data,geography:{...data.geography!,cutoff:-10,scale:1,positiveScale:1,negativeScale:1,rivers:[],lakeDepth:data.geography!.lakeDepth.map(()=>0)},stoneSites:[{id:0,x:.2,y:32,rocks:[rock,{...rock,x:1.5,height:2}]}]};
const point=(x:number,y:number,z:number)=>[x,z/4,y];
it('anchors to the exact rendered triangle planes, including the periodic seam',()=>{
 for(const local of [true,false]){
  const mesh=buildWorldGeometry(data,local,{x:16,y:16},'terrain',point),sample=createRenderedGroundSampler(data,local);
  for(let i=0;i<mesh.positions.length;i+=9*19){
   const a=mesh.positions.slice(i,i+3),b=mesh.positions.slice(i+3,i+6),c=mesh.positions.slice(i+6,i+9);
   const x=(a[0]!+b[0]!+c[0]!)/3,y=(a[2]!+b[2]!+c[2]!)/3,z=(a[1]!+b[1]!+c[1]!)/3;
   expect(sample(x,y).height).toBeCloseTo(z,9);
  }
  for(const [x,y]of [[-.1,32],[0,63.9],[32,32]])expect(sample(x!,y!).height).toBeCloseTo(sample(x!+64,y!-64).height,9);
 }
});
it('uses continuous periodic outcrop heights and leaves all saved r8 geography untouched',()=>{
 const before=JSON.stringify(fixture),a=createWorldOutcropField(fixture,true),b=createWorldOutcropField(fixture,true);
 expect(a.sample(.2,32).rise).toBeGreaterThan(.5);
 for(let y=28;y<=35;y+=.2){expect(a.sample(-.01,y).height).toBeCloseTo(a.sample(63.99,y).height,9);expect(a.sample(.01,y)).toEqual(b.sample(.01,y));}
 const distant=a.sample(24,24);expect(distant.rise).toBe(0);expect(distant.height).toBeLessThan(distant.base);
 expect(JSON.stringify(fixture)).toBe(before);
});
it('merges irregular rock triangles into one bounded mesh and reproduces them after re-entry',()=>{
 const site=data.stoneSites![0]!,center={x:site.x,y:site.y};
 const a=buildWorldOutcrops(data,true,center,point),b=buildWorldOutcrops(data,true,center,point);
 expect(a).toEqual(b);expect(a.indices.length).toBeGreaterThan(100);expect(a.positions.every(Number.isFinite)).toBe(true);
 const far=buildWorldOutcrops(data,false,{x:0,y:0},point);expect(far.indices.length).toBeGreaterThan(0);
 expect(far.indices.length).toBeLessThan(200000);
});

it('joins visible outcrops across the torus without a mesh rim or order dependence',()=>{
 const left=buildWorldOutcrops(fixture,true,{x:16,y:16},point),right=buildWorldOutcrops(fixture,true,{x:80,y:16},point);
 expect(left.indices.length).toBeGreaterThan(0);expect(left.indices).toEqual(right.indices);expect(left.colors).toEqual(right.colors);
 expect(left.positions.map(v=>v.toFixed(6))).toEqual(right.positions.map((v,i)=>(i%3===0?v-64:v).toFixed(6)));
});
