import {wrapClimate,type GeneratedLandscape} from '@arbestra/contracts';
import {createRockSurface,rockOutcropElevation,type RockOutcrop} from '../scene/rock-surface';
import {createRenderedGroundSampler} from './world-geography-mesh';

/** Legacy r8 formations; in r9 this mesh contains only detached blocks/talus.
 * Continuous r9 bedrock belongs to the terrain mesh and the geographic height field. */
export function createWorldOutcropField(data:GeneratedLandscape,local:boolean){
 const burial=data.geography?.geology?.version===1?.035:.18;
 const w=data.width,h=data.height,ground=createRenderedGroundSampler(data,local);
 const cells=new Map<number,Array<{shape:RockOutcrop;seed:number}>>();
 let index=0;
 for(const site of data.stoneSites??[])for(const rock of site.rocks){
  const scaleX=(2.4+Math.cos(rock.y/h*Math.PI*2+Math.PI))*h/w;
  const shape:RockOutcrop={x:rock.x,z:rock.y,radiusX:rock.width*.75,radiusZ:rock.depth*.75,height:rock.height,angle:rock.rotation,scaleX};
  const entry={shape,seed:data.seed+index++*19},radius=Math.hypot(shape.radiusX,shape.radiusZ)*1.5;
  const keys=new Set<number>();
  for(let y=Math.floor(rock.y-radius)-1;y<=Math.ceil(rock.y+radius)+1;y++)for(let x=Math.floor(rock.x-radius/scaleX)-1;x<=Math.ceil(rock.x+radius/scaleX)+1;x++)keys.add(wrapClimate(y,h)*w+wrapClimate(x,w));
  for(const key of keys){if(!cells.has(key))cells.set(key,[]);cells.get(key)!.push(entry);}
 }
 const cache=new Map<string,{base:number;rise:number;height:number}>();
 const sample=(x:number,y:number)=>{
  x=wrapClimate(x,w);y=wrapClimate(y,h);const key=x+':'+y,prior=cache.get(key);if(prior)return prior;
  const base=ground(x,y);let rise=0;
  for(const {shape,seed}of cells.get(Math.floor(y)*w+Math.floor(x))??[])rise=Math.max(rise,rockOutcropElevation(x,y,seed,shape,w,h));
  // Let the actual terrain occlude the buried rim; no rectangular patch is exposed.
  const shore=Math.max(0,Math.min(1,(base.height-base.surface)/.12));rise*=shore*shore*(3-2*shore);
  const result={base:base.height,rise,height:base.height+rise-burial};cache.set(key,result);return result;
 };
 return {burial,cells:[...cells.keys()].sort((a,b)=>a-b),sample};
}
/** One merged mesh, bounded to site footprints. Same canonical vertex identities at every seam. */
export function buildWorldOutcrops(data:GeneratedLandscape,local:boolean,center:{x:number;y:number},point:(x:number,y:number,z:number)=>number[]){
 const field=createWorldOutcropField(data,local),w=data.width,h=data.height;
 const x0=local?Math.floor((center.x-16)/32)*32:0,y0=local?Math.floor((center.y-16)/32)*32:0;
 const result={positions:[] as number[],indices:[] as number[],colors:[] as number[]};
 for(const cell of field.cells){
  const x=local?x0+wrapClimate(cell%w-x0,w):cell%w,y=local?y0+wrapClimate(Math.floor(cell/w)-y0,h):Math.floor(cell/w);
  if(local&&(x>=x0+64||y>=y0+64))continue;
  const patch=createRockSurface({x,z:y,width:1,depth:1,seed:data.seed,periodX:w,periodZ:h,
   subdivisions:local?4:1,microRelief:0,elevation:(x,y)=>field.sample(x,y).height});
  for(let i=0;i<patch.indices.length;i+=3){
   const vertices=patch.indices.slice(i,i+3).map(j=>({x:patch.positions[j*3]!,height:patch.positions[j*3+1]!,y:patch.positions[j*3+2]!,j}));
   if(vertices.every(v=>field.sample(v.x,v.y).rise<=field.burial))continue;
   const start=result.positions.length/3;
   for(const v of vertices){result.positions.push(...point(v.x,v.y,v.height*4));result.colors.push(...patch.colors.slice(v.j*4,v.j*4+4));}
   result.indices.push(start,start+1,start+2);
  }
 }
 return result;
}
