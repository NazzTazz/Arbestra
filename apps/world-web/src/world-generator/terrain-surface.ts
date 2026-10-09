import {periodicClimateNoise,wrapClimate} from '@arbestra/contracts';
const smooth=(v:number)=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
const mix=(a:number[],b:number[],t:number)=>a.map((v,i)=>v*(1-t)+b[i]!*t);
/** Visual materials only. Saved geography, water levels and bedrock remain authoritative. */
export function terrainSurfaceColor(world:{width:number;height:number;seed:number;circulation?:unknown},v:{x:number;y:number;z:number;surface:number;rock:number;slope:number;incision?:number}):number[]{
 const x=wrapClimate(v.x,world.width)/world.width,y=wrapClimate(v.y,world.height)/world.height;
 const province=periodicClimateNoise(x,y,Math.max(4,Math.round(world.height/12)),world.seed+9187);
 const clearance=v.z-v.surface;
 // Approximate a narrow lateral wet fringe from slope, rather than paint every
 // low plain as a beach merely because it is close to sea level.
 const wetHeight=world.circulation
  ? Math.max(.003,Math.min(.016,v.slope*.13))
  : Math.max(.006,Math.min(.06,v.slope*.35));
 const grass=[.31,.43,.19],damp=[.28,.32,.20],bed=[.27,.29,.23];
 const soil=clearance<0?mix(damp,bed,smooth(-clearance/.15)):mix(damp,grass,smooth(clearance/wetHeight));
 const rock=mix([.35,.38,.36],[.46,.475,.445],smooth((clearance+.015)/.10));
 // Coherent strata and actual incisions give the formation a readable hierarchy.
 const strata=periodicClimateNoise(x,y,Math.max(8,Math.round(world.height/6)),world.seed+17191);
 const exposure=smooth((v.rock-.12)/.72);
 const rockShade=.87+.20*strata-.12*smooth(((v.incision??0)-.10)/.22);
 const shade=(.97+.06*province)*(1-exposure+exposure*rockShade);
 return [...mix(soil,rock,exposure).map(c=>c*shade),1];
}

/** Opaque water coloured by the actual local depth; no extra transparency pass. */
export function terrainWaterColor(depth:number):number[]{
 const shallow=mix([.23,.33,.28],[.10,.36,.43],smooth(depth/.09));
 return [...mix(shallow,[.065,.29,.43],smooth((depth-.06)/.55)),1];
}
