import type {WorldGeography} from './world-geography.js';
import {climateHash,periodicClimateNoise,wrapClimate} from './world-climate.js';
export interface StudyPlateaus {spacing:number;min:number;max:number;blend:number;warp:number}
/** Independent heights per jittered periodic region, never altitude contour quantization. */
export function studyPlateauHeight(g:WorldGeography,x:number,y:number):number{
 const p=g.study!.plateaus!,nx=g.width/p.spacing,ny=g.height/p.spacing;
 x=wrapClimate(x+(periodicClimateNoise(x/g.width,y/g.height,11,g.seed+5001)-.5)*p.warp*2,g.width);
 y=wrapClimate(y+(periodicClimateNoise(x/g.width,y/g.height,13,g.seed+5002)-.5)*p.warp*2,g.height);
 const ix=Math.floor(x/p.spacing),iy=Math.floor(y/p.spacing),near:{d:number;z:number}[]=[];let closest=Infinity;
 for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  const a=ix+dx,b=iy+dy,cx=wrapClimate(a,nx),cy=wrapClimate(b,ny);
  const sx=(a+.25+.5*climateHash(g.seed,cx,cy,5011))*p.spacing,sy=(b+.25+.5*climateHash(g.seed,cx,cy,5012))*p.spacing;
  const d=Math.hypot(x-sx,y-sy),level=Math.min(5,Math.floor(climateHash(g.seed,cx,cy,5013)*6));
  closest=Math.min(closest,d);near.push({d,z:p.min+(p.max-p.min)*level/5});
 }
 let total=0,height=0;
 for(const s of near){const t=Math.max(0,1-(s.d-closest)/p.blend),weight=t*t*(3-2*t);total+=weight;height+=weight*s.z;}
 return height/total;
}
