import {COSMOLOGY,SOLAR_ORBIT,TAU,cyclePhases,sunPosition,torusFrame,type SolarOrbit} from './cosmology.js';
import {periodicClimateNoise,wrapClimate} from './world-climate.js';
/** Stylised lore, not gravitation or a fluid solver. Persisted with each new world. */
export interface SolarCirculation {
 version:1; majorRadius:number;tubeRadius:number;torusTurns:number;solarTurns:number;
 periodMs:number;epochMs:number;orbit:SolarOrbit;
}
export function createSolarCirculation():SolarCirculation{return {version:1,...COSMOLOGY,orbit:{...SOLAR_ORBIT}};}
function solarPull(u:number,v:number,phase:number,c:SolarCirculation):[number,number]{
 const phases=cyclePhases(phase,c),frame=torusFrame(u*TAU,v*TAU+Math.PI,phases.torus,c),sun=sunPosition(phases.sun,c.orbit);
 const d=sun.map((value,i)=>value-frame.point[i]!),length=Math.hypot(...d);
 return [d.reduce((sum,value,i)=>sum+value*frame.east[i]!,0)/length,d.reduce((sum,value,i)=>sum+value*frame.north[i]!,0)/length];
}
/** A complete cycle rolls three times around the ring and twice around the tube.
 * Solar attraction deforms this transport periodically; it is not inferred gravity.
 * Coordinates are continuous across both world seams and across cycle boundaries. */
export function solarTransport(u:number,v:number,phase:number,c:SolarCirculation):[number,number]{
 const pull=solarPull(u,v,phase,c),initial=solarPull(u,v,0,c);
 return [u-c.torusTurns*phase/TAU-.06*(pull[0]-initial[0]),v-c.solarTurns*phase/TAU-.06*(pull[1]-initial[1])];
}
/** Tangent transport in physical ring/tube units per cycle; same field as clouds. */
export function solarCurrent(u:number,v:number,phase:number,c:SolarCirculation):[number,number]{
 const epsilon=.0001,a=solarTransport(u,v,phase-epsilon,c),b=solarTransport(u,v,phase+epsilon,c);
 const ring=c.majorRadius+c.tubeRadius*Math.cos(v*TAU+Math.PI);
 return [(a[0]-b[0])/(2*epsilon)*ring,(a[1]-b[1])/(2*epsilon)*c.tubeRadius];
}
/** Time-independent rainfall proxy: fixed full-cycle sampling, never Date.now().
 * Different solar residence/transport combines with seeded moisture availability. */
export function solarRunoff(u:number,v:number,seed:number,c:SolarCirculation):number{
 let total=0;const steps=24,initial=solarPull(u,v,0,c);
 for(let i=0;i<steps;i++){
  const phase=i/steps*TAU,pull=solarPull(u,v,phase,c);
  const x=u-c.torusTurns*phase/TAU-.06*(pull[0]-initial[0]),y=v-c.solarTurns*phase/TAU-.06*(pull[1]-initial[1]);
  const moisture=periodicClimateNoise(wrapClimate(x,1),wrapClimate(y,1),5,seed+4021);
  total+=moisture*(.7+.3*Math.hypot(...pull));
 }
 return .45+total/steps*1.4;
}
