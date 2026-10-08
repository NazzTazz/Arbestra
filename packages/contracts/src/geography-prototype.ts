import clipping from 'polygon-clipping';
import { climateHash, periodicClimateNoise, wrapClimate } from './world-climate.js';

export type GeoPoint = [number, number];
export type GeoPolygon = GeoPoint[][];
export type GeoMultiPolygon = GeoPolygon[];
export interface GeographyOptions { seed:number; amplitude:number; riverWidth:number; bankRoughness:number }
export interface GeographyDescriptor {
  version:1; revision:0; kind:'prototype-fixture'; width:128; height:64;
  options:GeographyOptions; water:GeoMultiPolygon;
  reaches:{id:string; downstream:string|null; axis:GeoPoint[]}[];
}
export interface GeographySample {
  elevation:number; uncarvedElevation:number; waterLevel:number|null; depth:number;
  shoreDistance:number; rock:number; flow:GeoPoint;
}
export const DEFAULT_GEOGRAPHY:GeographyOptions={seed:42,amplitude:1,riverWidth:6.5,bankRoughness:.35};
export const geoWrap=wrapClimate;
export const geoHash=climateHash;
export const geoRound=(n:number)=>Math.round(n*1e6)/1e6;
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(a:number,b:number,n:number)=>{const t=clamp((n-a)/(b-a));return t*t*(3-2*t);};
const delta=(a:number,b:number,period:number)=>wrapClimate(a-b+period/2,period)-period/2;
const noise=(d:GeographyDescriptor,x:number,y:number,f:number,s=0)=>periodicClimateNoise(x/d.width,y/d.height,f,d.options.seed+s);

export function segmentDistance(p:GeoPoint,a:GeoPoint,b:GeoPoint){
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
  const t=length===0?0:clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length);
  return {distance:Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy),t};
}
export function insideRing(p:GeoPoint,ring:GeoPoint[]){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i]!,b=ring[j]!;
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function insideWater(p:GeoPoint,water:GeoMultiPolygon){
  return water.some(polygon=>insideRing(p,polygon[0]!)&&!polygon.slice(1).some(ring=>insideRing(p,ring)));
}
/** Unwrapped coordinates keep the fixture continuous through the world's x seam. */
export function localGeographyPoint(d:GeographyDescriptor,x:number,y:number):GeoPoint{
  return [24+delta(x,24,d.width),16+delta(y,16,d.height)];
}
export function waterProfile(x:number){return .15+.012*Math.max(0,44-x);}
function bankDistance(p:GeoPoint,water:GeoMultiPolygon){
  let distance=Infinity;
  for(const polygon of water)for(const ring of polygon)for(let i=1;i<ring.length;i++)
    distance=Math.min(distance,segmentDistance(p,ring[i-1]!,ring[i]!).distance);
  return distance;
}
/** Pure geographic query. No scene, cell, loading order, camera or render density. */
export function sampleGeography(d:GeographyDescriptor,x:number,y:number):GeographySample{
  x=wrapClimate(x,d.width);y=wrapClimate(y,d.height);
  const p=localGeographyPoint(d,x,y),bank=bankDistance(p,d.water);
  const wet=insideWater(p,d.water)||bank<1e-7;
  const ridge=(cx:number,cy:number,rx:number,ry:number)=>Math.hypot(delta(x,cx,d.width)/rx,delta(y,cy,d.height)/ry);
  const plateauA=1-smooth(.55,1.15,ridge(10,27,10,7));
  const plateauB=1-smooth(.55,1.15,ridge(42,27,10,7));
  let rock=0,rockRise=0;
  for(const [cx,cy,rx,ry,rise] of [[12,5,6,3.2,1.1],[19,7,4.2,3.4,1.35],[25,3,4.5,2.6,.85]]){
    const dx=delta(x,cx!,d.width),dy=delta(y,cy!,d.height),u=(dx+.28*dy)/rx!,v=(dy-.15*dx)/ry!;
    const radius=Math.max(Math.abs(u)*.8+Math.abs(v)*.4,Math.abs(v)*.85+Math.abs(u)*.25);
    const shape=1-smooth(.5,1.10,radius+(noise(d,x,y,42)-.5)*.18);
    rock=Math.max(rock,shape);
    rockRise=Math.max(rockRise,shape*(rise!*(.94+.13*u-.09*v)+.18*(noise(d,x,y,68)-.5)));
  }
  let base=.72+.18*noise(d,x,y,7)+.025*(noise(d,x,y,54)-.5);
  base=base*(1-plateauA)+.98*plateauA;
  base=base*(1-plateauB)+1.52*plateauB;
  // A broad, smooth connection; flat installation areas remain on both ends.
  const passage=(1-smooth(.35,1,Math.abs(delta(y,28,d.height))/3))*smooth(14,18,p[0])*(1-smooth(35,39,p[0]));
  base=base*(1-passage)+(.98+.54*smooth(14,39,p[0]))*passage;
  base+=rockRise;
  base*=d.options.amplitude;
  const water=waterProfile(p[0]);
  // Polygon distance is shared by the bed, visible shore and water mask.
  const carved=wet?water-.015-.46*smooth(0,1.6,bank):
    (water-.015)*(1-smooth(0,1.6,bank))+Math.max(base,water+.08)*smooth(0,1.6,bank);
  const elevation=bank<1.6||wet?carved:base;
  let flow:GeoPoint=[0,0],nearest=Infinity;
  if(wet)for(const reach of d.reaches)for(let i=1;i<reach.axis.length;i++){
    const a=reach.axis[i-1]!,b=reach.axis[i]!,dist=segmentDistance(p,a,b).distance;
    if(dist<nearest){nearest=dist;const length=Math.hypot(b[0]-a[0],b[1]-a[1]);flow=[(b[0]-a[0])/length,(b[1]-a[1])/length];}
  }
  return {elevation,uncarvedElevation:base,waterLevel:wet?water:null,depth:wet?water-elevation:0,
    shoreDistance:wet?-bank:bank,rock:rock*(wet?0:smooth(.2,2,bank)),flow};
}
/** Facts only: no invented walking/building policy. Future terrain revisions must
 * invalidate these facts and routing together on the server, never via a mesh. */
export function projectGeographyCell(d:GeographyDescriptor,x:number,y:number,samples=8){
  if(!Number.isInteger(samples)||samples<2||samples>32)throw new Error('Invalid integration resolution');
  let wet=0,min=Infinity,max=-Infinity,maxSlope=0;
  for(let j=0;j<samples;j++)for(let i=0;i<samples;i++){
    const px=x+(i+.5)/samples,py=y+(j+.5)/samples,s=sampleGeography(d,px,py);
    wet+=s.waterLevel===null?0:1;min=Math.min(min,s.elevation);max=Math.max(max,s.elevation);
    const dx=(sampleGeography(d,px+.02,py).elevation-sampleGeography(d,px-.02,py).elevation)/.04;
    const dy=(sampleGeography(d,px,py+.02).elevation-sampleGeography(d,px,py-.02).elevation)/.04;
    maxSlope=Math.max(maxSlope,Math.hypot(dx,dy));
  }
  return {wetFraction:wet/(samples*samples),minElevation:min,maxElevation:max,maxSlope,samples,revision:d.revision};
}
function corridor(axis:GeoPoint[],width:(i:number)=>number):GeoPolygon{
  const left:GeoPoint[]=[],right:GeoPoint[]=[];
  for(let i=0;i<axis.length;i++){
    const a=axis[Math.max(0,i-1)]!,b=axis[Math.min(axis.length-1,i+1)]!,p=axis[i]!;
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]),r=width(i)/2;
    left.push([geoRound(p[0]-(b[1]-a[1])/length*r),geoRound(p[1]+(b[0]-a[0])/length*r)]);
    right.push([geoRound(p[0]+(b[1]-a[1])/length*r),geoRound(p[1]-(b[0]-a[0])/length*r)]);
  }
  const ring=[...left,...right.reverse()];ring.push(ring[0]!);return [ring];
}
/** Bounded geographic fixture, NOT the world basin generator. No per-cell paths. */
export function createGeographyFixture(options:GeographyOptions):GeographyDescriptor{
  if(!Number.isSafeInteger(options.seed)||options.seed<0||options.seed>2147483647||
    !Number.isFinite(options.amplitude)||options.amplitude<.5||options.amplitude>1.5||
    !Number.isFinite(options.riverWidth)||options.riverWidth<5||options.riverWidth>8||
    !Number.isFinite(options.bankRoughness)||options.bankRoughness<0||options.bankRoughness>1)
    throw new Error('Invalid geography options');
  const phase=climateHash(options.seed,0,0,51)*Math.PI*2;
  const riverY=(x:number)=>15+4.2*Math.sin((x+6)/11+phase*.35)+.8*Math.sin(x/4+phase);
  const axis:GeoPoint[]=Array.from({length:97},(_,i)=>{const x=-12+i*64/96;return [x,riverY(x)];});
  const mouthX=30,mouthY=riverY(mouthX);
  const tributary:GeoPoint[]=Array.from({length:41},(_,i)=>{const t=i/40;return [18+12*t+1.2*Math.sin(t*Math.PI*2),2+(mouthY-2)*t];});
  const bankWidth=(i:number)=>Math.max(5,Math.min(8,options.riverWidth+options.bankRoughness*(.65*Math.sin(i*.23+phase)+.35*Math.sin(i*.59))));
  const lake:GeoPoint[]=Array.from({length:65},(_,i)=>{const a=i/64*Math.PI*2,r=1+.06*Math.sin(5*a+phase);return [54+8*Math.cos(a)*r,riverY(52)+6*Math.sin(a)*r];});
  lake[lake.length-1]=lake[0]!;
  const source:GeoPoint[]=Array.from({length:33},(_,i)=>{const a=i/32*Math.PI*2,r=bankWidth(0)/2;return [axis[0]![0]+r*Math.cos(a),axis[0]![1]+r*Math.sin(a)];});
  source[source.length-1]=source[0]!;
  const water=clipping.union(corridor(axis,bankWidth),corridor(tributary,i=>5+.4*Math.sin(i/9)),[lake],[source]);
  return {version:1,revision:0,kind:'prototype-fixture',width:128,height:64,options:{...options},water,
    reaches:[{id:'river',downstream:'lake',axis},{id:'tributary',downstream:'river',axis:tributary},{id:'lake',downstream:null,axis:[]} ]};
}
/** Canonical constraints are clipped once per patch; no neighbour is required. */
export function clipGeographyWater(d:GeographyDescriptor,x:number,y:number,size:number):GeoMultiPolygon{
  const bounds:GeoPolygon=[[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]];
  const copies:GeoMultiPolygon=[];
  const bx=Math.floor((x-24)/d.width),by=Math.floor((y-16)/d.height);
  for(let j=by;j<=by+2;j++)for(let i=bx;i<=bx+2;i++)
    for(const polygon of d.water)copies.push(polygon.map(ring=>ring.map(p=>[p[0]+i*d.width,p[1]+j*d.height])));
  return clipping.intersection(copies,bounds).map(polygon=>polygon.map(ring=>ring.map(p=>[geoRound(p[0]),geoRound(p[1])])));
}
