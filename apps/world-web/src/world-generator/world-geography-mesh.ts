import { climateHash, wrapClimate, type GeneratedLandscape } from '@arbestra/contracts';
import { sampleWorldGeography } from '@arbestra/contracts/world-geography';
import type { PreviewLayer } from './PreviewScene';
import { altitudeColor } from './altitude-color';
import {refineShoreTriangle} from './terrain-shore';
import {terrainSurfaceColor,terrainWaterColor} from './terrain-surface';
interface Vertex {x:number;y:number;z:number;surface:number;rock:number;slope:number;incision?:number}
export interface WorldGeometryBuffers {positions:number[];colors:number[];indices:number[];faceCells:number[];waterPositions:number[];waterIndices:number[];waterColors:number[]}
export function worldTerrainVertex(data:GeneratedLandscape,local:boolean){
  const step=data.geography?.geology?(local?.5:1):(local?1:2);
  return (x:number,y:number):Vertex=>{
    const cx=wrapClimate(x,data.width),cy=wrapClimate(y,data.height);
    const boundary=cx%32===0||cy%32===0;
    const px=x+(boundary?0:(climateHash(data.seed,cx,cy,7429)-.5)*step*.58);
    const py=y+(boundary?0:(climateHash(data.seed,cx,cy,39593)-.5)*step*.58);
    const s=sampleWorldGeography(data.geography!,px,py);return {x:px,y:py,z:s.elevation,surface:s.surface,rock:s.rock,slope:s.geology?.slope??0,incision:Math.max(0,Math.min(.38,s.base-s.elevation))};
  };
}
/** Shared tessellation for rendering and exact block/talus anchoring. */
function terrainTriangles(data:GeneratedLandscape,local:boolean){
 const step=data.geography?.geology?(local?.5:1):(local?1:2),base=worldTerrainVertex(data,local);
 const nodes=new Map<string,Vertex>(),midpoints=new Map<string,Vertex>();
 const vertex=(x:number,y:number)=>{const key=x+':'+y;let v=nodes.get(key);if(!v){v=base(x,y);nodes.set(key,v);}return v;};
 const sample=(x:number,y:number)=>{const key=x+':'+y;let v=midpoints.get(key);if(!v){const s=sampleWorldGeography(data.geography!,x,y);v={x,y,z:s.elevation,surface:s.surface,rock:s.rock,slope:s.geology?.slope??0,incision:Math.max(0,Math.min(.38,s.base-s.elevation))};midpoints.set(key,v);}return v;};
 return (x:number,y:number)=>{
  const a=vertex(x,y),b=vertex(x+step,y),c=vertex(x+step,y+step),d=vertex(x,y+step);
  const triangles=climateHash(data.seed,wrapClimate(x,data.width),wrapClimate(y,data.height),6211)<.5?[[a,b,c],[a,c,d]]:[[a,b,d],[b,c,d]];
  return data.geography?.geology?triangles.flatMap(t=>refineShoreTriangle(t,sample)):triangles;
 };
}
/** Same periodic sampler for the overview and local detail. Borders have canonical samples. */
export function buildWorldGeometry(data:GeneratedLandscape,local:boolean,center:{x:number;y:number},layer:PreviewLayer,point:(x:number,y:number,z:number)=>number[]):WorldGeometryBuffers{
  const g=data.geography!;
  const result:WorldGeometryBuffers={positions:[],colors:[],indices:[],faceCells:[],waterPositions:[],waterIndices:[],waterColors:[]};
  const step=data.geography?.geology?(local?.5:1):(local?1:2),x0=local?Math.floor((center.x-16)/32)*32:0,y0=local?Math.floor((center.y-16)/32)*32:0;
  const x1=local?x0+64:g.width,y1=local?y0+64:g.height;
  const triangles=terrainTriangles(data,local);
  const color=(v:Vertex,cell:number):number[]=>{
    if(layer==='altitude')return [...altitudeColor(v.z*4),1];
    if(layer==='water')return [.26,.29,.22,1];
    if(layer==='exposure'){const e=data.exposure[cell]!;return [e*2.5,.25+e,.13,1];}
    if(layer==='humidity'){const h=data.humidity[cell]!;return [.12,h,.3+h*.6,1];}
    if(layer==='accessibility')return [.35,.35,.35,1];
    if(g.geology)return terrainSurfaceColor(g,v);
    const wet=v.z<v.surface,shore=Math.abs(v.z-v.surface)<.055;
    if(wet||shore)return [.42,.40,.30,1];
    const green=[.31,.43,.19],gray=[.47,.48,.45];return [...green.map((c,i)=>c*(1-v.rock)+gray[i]!*v.rock),1];
  };
  const triangle=(vertices:Vertex[])=>{
    const cell=wrapClimate(Math.floor(vertices.reduce((s,v)=>s+v.y,0)/3),g.height)*g.width+wrapClimate(Math.floor(vertices.reduce((s,v)=>s+v.x,0)/3),g.width);
    // Keep restrained low-poly facets; the previous 18% random contrast dominated
    // the formation. Large coherent strata now carry most material variation.
    const facet=g.geology&&layer==='terrain'?.97+climateHash(g.seed,Math.round(wrapClimate(vertices.reduce((sum,v)=>sum+v.x,0)/3,g.width)*16),Math.round(wrapClimate(vertices.reduce((sum,v)=>sum+v.y,0)/3,g.height)*16),7391)*.06:1;
    const start=result.positions.length/3;for(const v of vertices){result.positions.push(...point(v.x,v.y,v.z*4));const rgba=color(v,cell);for(let k=0;k<3;k++)rgba[k]!*=1+(facet-1)*v.rock;result.colors.push(...rgba);}
    result.indices.push(start,start+1,start+2);result.faceCells.push(cell);
    if(layer!=='terrain'&&layer!=='water')return;
    const wet:Vertex[]=[];
    for(let i=0;i<3;i++){
      const a=vertices[i]!,b=vertices[(i+1)%3]!,da=a.surface-a.z,db=b.surface-b.z;
      if(da>1e-6)wet.push(a);
      if((da>1e-6)!==(db>1e-6)){const t=(da-1e-6)/(da-db);wet.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,surface:a.surface+(b.surface-a.surface)*t,rock:0,slope:0});}
    }
    for(let i=1;i<wet.length-1;i++){const start=result.waterPositions.length/3;for(const v of [wet[0]!,wet[i]!,wet[i+1]!]){result.waterPositions.push(...point(v.x,v.y,(v.surface+.003)*4));if(g.geology)result.waterColors.push(...terrainWaterColor(Math.max(0,v.surface-v.z)));}result.waterIndices.push(start,start+1,start+2);}
  };
  for(let y=y0;y<y1;y+=step)for(let x=x0;x<x1;x+=step)for(const vertices of triangles(x,y))triangle(vertices);
  return result;
}

/** Barycentric height of the actual rendered triangles, for seamless visual attachments. */
export function createRenderedGroundSampler(data:GeneratedLandscape,local:boolean){
 const step=data.geography?.geology?(local?.5:1):(local?1:2),triangles=terrainTriangles(data,local);
 return (x:number,y:number)=>{
  const cx=Math.floor(x/step)*step,cy=Math.floor(y/step)*step;
  for(const [dx,dy] of [[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){
   const px=cx+dx!*step,py=cy+dy!*step;
   for(const [a,b,c]of triangles(px,py)){
    const determinant=(b!.y-c!.y)*(a!.x-c!.x)+(c!.x-b!.x)*(a!.y-c!.y);
    const u=((b!.y-c!.y)*(x-c!.x)+(c!.x-b!.x)*(y-c!.y))/determinant;
    const v=((c!.y-a!.y)*(x-c!.x)+(a!.x-c!.x)*(y-c!.y))/determinant,t=1-u-v;
    if(Math.min(u,v,t)>=-1e-9)return {height:u*a!.z+v*b!.z+t*c!.z,surface:u*a!.surface+v*b!.surface+t*c!.surface};
   }
  }
  throw Error('Point outside rendered terrain triangulation');
 };
}
