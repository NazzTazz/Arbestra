import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';

export interface RockSurfaceOptions {
  /** Canonical world cell coordinates, never camera-relative coordinates. */
  x:number; z:number; width:number; depth:number; seed:number;
  /** Shared visual height field. Never use a per-chunk or per-cell closure. */
  elevation?:((worldX:number,worldZ:number)=>number)|undefined;
  /** Optional torus periods in cells. */
  periodX?:number; periodZ?:number;
  subdivisions?:1|2|4;
  microRelief?:number;
}
const wrap=(n:number,period?:number)=>period===undefined?n:((n%period)+period)%period;
function hash(x:number,z:number,seed:number){
  let h=Math.imul(x|0,374761393)^Math.imul(z|0,668265263)^Math.imul(seed|0,1442695041);
  h=Math.imul(h^(h>>>13),1274126177);
  return ((h^(h>>>16))>>>0)/4294967295;
}
function noise(x:number,z:number,seed:number,periodX?:number,periodZ?:number){
  const ix=Math.floor(x),iz=Math.floor(z),tx=x-ix,tz=z-iz;
  const sx=tx*tx*(3-2*tx),sz=tz*tz*(3-2*tz);
  const h=(dx:number,dz:number)=>hash(wrap(ix+dx,periodX),wrap(iz+dz,periodZ),seed);
  return (h(0,0)*(1-sx)+h(1,0)*sx)*(1-sz)+(h(0,1)*(1-sx)+h(1,1)*sx)*sz;
}
/** One global vertex identity gives one position, even across independently built patches. */
export function rockSurfaceVertex(ix:number,iz:number,options:RockSurfaceOptions):number[]{
  const SUBDIVISIONS=options.subdivisions??4;
  const px=options.periodX===undefined?undefined:options.periodX*SUBDIVISIONS;
  const pz=options.periodZ===undefined?undefined:options.periodZ*SUBDIVISIONS;
  const cx=wrap(ix,px),cz=wrap(iz,pz);
  const jx=(hash(cx,cz,options.seed)-.5)*.55/SUBDIVISIONS;
  const jz=(hash(cx,cz,options.seed+73)-.5)*.55/SUBDIVISIONS;
  const x=ix/SUBDIVISIONS+jx,z=iz/SUBDIVISIONS+jz;
  const wx=wrap(cx/SUBDIVISIONS+jx,options.periodX),wz=wrap(cz/SUBDIVISIONS+jz,options.periodZ);
  const relief=(noise(wx*2,wz*2,options.seed,
    options.periodX===undefined?undefined:options.periodX*2,
    options.periodZ===undefined?undefined:options.periodZ*2)-.5)*(options.microRelief??.052);
  return [x,(options.elevation?.(wx,wz)??0)+relief,z];
}
/** Irregular triangulation, flat facets, no per-cell rim, wall, joint or cap.
 * Returned coordinates are world coordinates. Rebase only when attaching to WorldSpace. */
export function createRockSurface(options:RockSurfaceOptions){
  const {x,z,width,depth,seed}=options,SUBDIVISIONS=options.subdivisions??4;
  if(![x,z,width,depth,seed].every(Number.isSafeInteger)||width<1||depth<1||width*depth>16384)
    throw new Error('Rock surface requires integer cell bounds and a bounded patch');
  for(const period of [options.periodX,options.periodZ])
    if(period!==undefined&&(!Number.isSafeInteger(period)||period<1))throw new Error('Invalid torus period');
  const positions:number[]=[],indices:number[]=[],colors:number[]=[],uvs:number[]=[];
  const triangle=(a:number[],b:number[],c:number[],tone:number)=>{
    const first=positions.length/3;
    positions.push(...a,...b,...c);indices.push(first,first+2,first+1);
    for(const p of [a,b,c]){colors.push(tone,tone,tone,1);uvs.push(p[0]!,p[2]!);}
  };
  for(let iz=z*SUBDIVISIONS;iz<(z+depth)*SUBDIVISIONS;iz++)for(let ix=x*SUBDIVISIONS;ix<(x+width)*SUBDIVISIONS;ix++){
    const a=rockSurfaceVertex(ix,iz,options),b=rockSurfaceVertex(ix+1,iz,options);
    const c=rockSurfaceVertex(ix+1,iz+1,options),d=rockSurfaceVertex(ix,iz+1,options);
    const hx=wrap(ix,options.periodX===undefined?undefined:options.periodX*SUBDIVISIONS);
    const hz=wrap(iz,options.periodZ===undefined?undefined:options.periodZ*SUBDIVISIONS);
    const tone=.48+hash(hx,hz,seed+31)*.065;
    if(hash(hx,hz,seed+127)>.5){triangle(a,d,c,tone);triangle(a,c,b,tone+.008);}
    else{triangle(a,d,b,tone);triangle(b,d,c,tone+.008);}
  }
  const normals:number[]=[];VertexData.ComputeNormals(positions,indices,normals);
  return {positions,indices,colors,normals,uvs};
}

export interface RockOutcrop {x:number;z:number;radiusX:number;radiusZ:number;height:number;angle:number;scaleX?:number;detailSeed?:number}
/** Shared tilted, angular outcrop profile used by the workshop and r8. */
export function rockOutcropElevation(x:number,z:number,seed:number,r:RockOutcrop,periodX?:number,periodZ?:number){
  const delta=(a:number,b:number,p?:number)=>p===undefined?a-b:wrap(a-b+p/2,p)-p/2;
  const dx=delta(x,r.x,periodX)*(r.scaleX??1),dz=delta(z,r.z,periodZ);
  const u=dx*Math.cos(r.angle)-dz*Math.sin(r.angle),v=dx*Math.sin(r.angle)+dz*Math.cos(r.angle);
  const f=periodX===undefined?1.4:2;
  const bend=(noise(wrap(x,periodX)*f,wrap(z,periodZ)*f,seed,periodX===undefined?undefined:periodX*f,periodZ===undefined?undefined:periodZ*f)-.5)*.32;
  const radius=Math.max(Math.abs(u/r.radiusX),Math.abs(v/r.radiusZ),Math.abs(u/r.radiusX*.65+v/r.radiusZ*.55));
  const edge=Math.max(0,Math.min(1,(1.12-radius+bend)/.38));
  const shoulder=edge*edge*(3-2*edge);
  const tilted=r.height*(.93+.10*u/r.radiusX-.08*v/r.radiusZ)+(noise(wrap(x,periodX)*2,wrap(z,periodZ)*2,(r.detailSeed??seed)+41,periodX===undefined?undefined:periodX*2,periodZ===undefined?undefined:periodZ*2)-.5)*.10;
  return Math.max(0,shoulder*tilted);
}
/** Preview-only outcrops. Logical elevation/occupation data are never modified. */
export function rockPreviewElevation(x:number,z:number,seed:number){
  const outcrops=[[-1.65,-.45,1.8,1.1,.70,.28],[1.3,.65,1.4,1.05,.95,-.48],[.15,-1.8,.9,.6,.42,.65]];
  let surface=0;
  for(let i=0;i<outcrops.length;i++){
    const [cx,cz,rx,rz,rise,angle]=outcrops[i]!;
    surface=Math.max(surface,rockOutcropElevation(x,z,seed+i*19,{x:cx!,z:cz!,radiusX:rx!,radiusZ:rz!,height:rise!,angle:angle!,detailSeed:seed}));
  }
  return surface;
}
