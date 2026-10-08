import { TAU, illumination } from './cosmology.js';
export const CLIMATE_VERSION = 1;
export const CLIMATE_GRID_WIDTH = 32, CLIMATE_GRID_HEIGHT = 16, CLIMATE_SAMPLES = 96;
export const wrapClimate = (x:number,size:number) => ((x%size)+size)%size;
export function climateHash(seed:number,x:number,y:number,salt=0):number {
  let h=Math.imul(x+1,374761393)^Math.imul(y+1,668265263)^seed^salt;
  h=Math.imul(h^(h>>>13),1274126177);
  return ((h^(h>>>16))>>>0)/4294967295;
}
export function periodicClimateNoise(u:number,v:number,frequency:number,seed:number):number {
  const x=wrapClimate(u,1)*frequency, y=wrapClimate(v,1)*frequency;
  const ix=Math.floor(x), iy=Math.floor(y);
  const smooth=(t:number)=>t*t*(3-2*t), fx=smooth(x-ix), fy=smooth(y-iy);
  const at=(a:number,b:number)=>climateHash(seed,wrapClimate(a,frequency),wrapClimate(b,frequency));
  return (at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy;
}
/** Bounded full combined solar cycle, including torus occultation. */
export function buildExposureField():number[] {
  const result:number[]=[];
  for(let y=0;y<CLIMATE_GRID_HEIGHT;y++) for(let x=0;x<CLIMATE_GRID_WIDTH;x++) {
    let sum=0;
    for(let t=0;t<CLIMATE_SAMPLES;t++) sum+=illumination((x+.5)/CLIMATE_GRID_WIDTH*TAU,
      (y+.5)/CLIMATE_GRID_HEIGHT*TAU+Math.PI,t/CLIMATE_SAMPLES*TAU).direct;
    result.push(sum/CLIMATE_SAMPLES);
  }
  return result;
}
export function exposureAt(field:readonly number[],u:number,v:number):number {
  const x=wrapClimate(u,1)*CLIMATE_GRID_WIDTH-.5,y=wrapClimate(v,1)*CLIMATE_GRID_HEIGHT-.5;
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const at=(a:number,b:number)=>field[wrapClimate(b,CLIMATE_GRID_HEIGHT)*CLIMATE_GRID_WIDTH+wrapClimate(a,CLIMATE_GRID_WIDTH)]!;
  return (at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy;
}
export function climateAt(u:number,v:number,seed:number) {
  const humidity=.65*periodicClimateNoise(u,v,4,seed+101)+.35*periodicClimateNoise(u,v,8,seed+102);
  return {humidity};
}
