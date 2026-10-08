import { periodicClimateNoise, wrapClimate } from './world-climate.js';
import type { WorldGeography, WorldGeoSample } from './world-geography.js';

/** Preview stratigraphy, in cell widths. No resource quantity or extraction permission. */
export interface WorldGeologySample {
  elevation:number; bedrockElevation:number; soilDepth:number; exposure:number;
  slope:number; ridge:number; breakOfSlope:number; downhillX:number; downhillY:number;
}
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(v:number)=>{v=clamp(v);return v*v*(3-2*v);};
/** A periodic geographic analysis lattice, independent of occupancy and chunk load order.
 * This is immutable base stratigraphy. Future excavation must clip it with an edit
 * surface, never recompute/lower the substrate from an already excavated surface.
 */
export function createGeologySampler(g:Pick<WorldGeography,'width'|'height'|'seed'>,topography:(x:number,y:number)=>WorldGeoSample){
 const {width:w,height:h,seed}=g,step=2,cache=new Map<number,{dx:number;dy:number;ridge:number;bend:number}>();
 const node=(ix:number,iy:number)=>{
  ix=wrapClimate(ix,w/step);iy=wrapClimate(iy,h/step);const key=iy*(w/step)+ix,old=cache.get(key);if(old)return old;
  const x=ix*step,y=iy*step,sx=(2.4+Math.cos(y/h*Math.PI*2+Math.PI))*h/w;
  const z=topography(x,y).elevation,left=topography(x-step,y).elevation,right=topography(x+step,y).elevation;
  const up=topography(x,y-step).elevation,down=topography(x,y+step).elevation;
  const xx=(2*z-left-right)/(step*sx),yy=(2*z-up-down)/step;
  const value={dx:(right-left)/(2*step*sx),dy:(down-up)/(2*step),ridge:Math.max(0,xx,yy),bend:Math.max(Math.abs(xx),Math.abs(yy))};
  cache.set(key,value);return value;
 };
 return (x:number,y:number):WorldGeologySample=>{
  x=wrapClimate(x,w);y=wrapClimate(y,h);const ix=Math.floor(x/step),iy=Math.floor(y/step),fx=x/step-ix,fy=y/step-iy;
  const a=node(ix,iy),b=node(ix+1,iy),c=node(ix,iy+1),d=node(ix+1,iy+1);
  const mix=(key:keyof typeof a)=>(a[key]*(1-fx)+b[key]*fx)*(1-fy)+(c[key]*(1-fx)+d[key]*fx)*fy;
  const dx=mix('dx'),dy=mix('dy'),slope=Math.hypot(dx,dy),ridge=mix('ridge'),breakOfSlope=mix('bend');
  const s=topography(x,y),province=periodicClimateNoise(x/w,y/h,7,seed+9187);
  // Soil accumulates on gentle interiors, thins on steep faces and convex shoulders.
  const soilDepth=Math.max(0,.24+province*.22-slope*1.15-ridge*.95-breakOfSlope*.25);
  const dry=smooth((s.elevation-s.surface)/.18),exposure=(1-smooth(soilDepth/.13))*dry;
  const joints=periodicClimateNoise(x/w,y/h,Math.max(16,Math.round(h/2)),seed+7717);
  // Cut fractures into the one terrain surface, never add a pedestal over it.
  const strata=periodicClimateNoise(x/w,y/h,Math.max(8,Math.round(h/6)),seed+17191);
  const incision=Math.min(Math.max(0,s.elevation-s.surface)*.65,
    exposure*(.28*Math.pow(1-Math.abs(strata*2-1),2)+.10*Math.pow(1-Math.abs(joints*2-1),3))*dry);
  const elevation=s.elevation-incision;
  return {elevation,bedrockElevation:elevation-soilDepth,soilDepth,exposure,slope,ridge,breakOfSlope,
   downhillX:slope?-dx/slope:0,downhillY:slope?-dy/slope:0};
 };
}
/** Material query reserved for future volumetric excavation accounting, not economic credit. */
export function geologyMaterialAt(sample:WorldGeologySample,elevation:number):'air'|'soil'|'bedrock'{
 return elevation>sample.elevation?'air':elevation<=sample.bedrockElevation?'bedrock':'soil';
}
