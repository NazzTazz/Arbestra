import {expect,it} from 'vitest';
import {createWorldGeography,geographicBase,sampleWorldTopography,geographicWaterCurrent,DEFAULT_GEOGRAPHY_PARAMETERS as p} from './world-geography.js';
const g=createWorldGeography(42,128,64,p,10);
it('keeps positive low shores above sea and preserves reproducibility and toroidal joins',()=>{
 expect(g).toEqual(createWorldGeography(42,128,64,p,10));expect(g.circulation?.version).toBe(1);
 let low=0;
 for(let y=0;y<64;y+=.5)for(let x=0;x<128;x+=.5){const z=geographicBase(g,x,y);if(z>0&&z<.05)low++;}
 expect(low).toBeGreaterThan(0);
 const clone=JSON.parse(JSON.stringify(g));
 for(const [x,y]of [[-.01,0],[0,12],[52.3,63.99],[127.99,30]]){
  const a=sampleWorldTopography(g,x!,y!),b=sampleWorldTopography(clone,x!+128,y!-64);
  expect(a.elevation).toBeCloseTo(b.elevation,9);expect(a.surface).toBeCloseTo(b.surface,9);
 }
});
it('removes hard switches of elevated water and keeps the river direction downstream',()=>{
 let checked=0;
 for(const r of g.rivers)for(let k=1;k<r.points.length;k+=3){
  const a=r.points[k-1]!,b=r.points[k]!,dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<.1)continue;
  const x=(a[0]+b[0])/2,y=(a[1]+b[1])/2;
  for(let d=0;d<9;d+=.15){
   const px=x-dy/length*d,py=y+dx/length*d,s=sampleWorldTopography(g,px,py),t=sampleWorldTopography(g,px+1e-6,py+1e-6);
   expect(Math.abs(s.surface-t.surface)).toBeLessThan(.001);expect(Math.abs(s.elevation-t.elevation)).toBeLessThan(.001);
  }
  if(sampleWorldTopography(g,x,y).depth>.01){
   const flow=geographicWaterCurrent(g,x,y,0);expect(flow[0]*dx+flow[1]*dy).toBeGreaterThanOrEqual(-1e-8);checked++;
  }
 }
 expect(checked).toBeGreaterThan(0);
});
it('does not retrofit solar fields or new banks onto r9',()=>{
 const old=createWorldGeography(42,128,64,p,9);expect(old.circulation).toBeUndefined();expect(old.lakeSurface).toBeUndefined();
});
