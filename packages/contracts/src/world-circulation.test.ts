import {expect,it} from 'vitest';
import {TAU} from './cosmology.js';
import {createSolarCirculation,solarCurrent,solarRunoff,solarTransport} from './world-circulation.js';
const c=createSolarCirculation();
it('repeats at both toroidal seams and after the complete solar cycle',()=>{
 for(const phase of [0,.7,3,TAU]){
  const a=solarCurrent(.37,.41,phase,c),b=solarCurrent(1.37,-.59,phase+TAU,c);
  for(let i=0;i<2;i++)expect(a[i]).toBeCloseTo(b[i]!,7);
 }
 const a=solarTransport(.3,.4,0,c),b=solarTransport(.3,.4,TAU,c);
 expect(a[0]-b[0]).toBeCloseTo(c.torusTurns,10);expect(a[1]-b[1]).toBeCloseTo(c.solarTurns,10);
});
it('responds to solar phase/orbit and reconstructs deterministic rainfall from a saved contract',()=>{
 expect(solarCurrent(.3,.4,0,c)).not.toEqual(solarCurrent(.3,.4,1,c));
 expect(solarRunoff(.3,.4,42,c)).toBe(solarRunoff(.3,.4,42,JSON.parse(JSON.stringify(c))));
 expect(solarRunoff(.3,.4,42,c)).not.toBe(solarRunoff(.3,.4,42,{...c,orbit:{...c.orbit,a:7}}));
});
