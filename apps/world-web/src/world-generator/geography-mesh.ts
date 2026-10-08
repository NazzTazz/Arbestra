import Delaunator from 'delaunator';
import Constrainautor from './constrainautor-runtime.js';
import { clipGeographyWater, geoHash, geoRound, geoWrap, insideWater, localGeographyPoint,
  sampleGeography, segmentDistance, waterProfile, type GeoPoint, type GeographyDescriptor } from '@arbestra/contracts/geography-prototype';

export interface GeographyBuffers { positions:Float32Array; indices:Uint32Array; colors:Float32Array; flow:Float32Array }
export interface GeographyChunk {
  x:number; y:number; ground:GeographyBuffers; water:GeographyBuffers;
  boundary:number[][]; triangles:number; uniqueVertices:number; bytes:number;
}
/** Render resolution changes only interior samples. Boundary sampling is fixed. */
export function buildGeographyChunk(d:GeographyDescriptor,x:number,y:number,density:1|2=1):GeographyChunk{
  const size=32;
  if(!Number.isInteger(x/size)||!Number.isInteger(y/size))throw new Error('Expected aligned chunk');
  const water=clipGeographyWater(d,x,y,size);
  const perimeter:GeoPoint[]=[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
  const rings=[perimeter,...water.flat()];
  const points:GeoPoint[]=[],byKey=new Map<string,number>();
  const add=(p:GeoPoint)=>{p=[geoRound(p[0]),geoRound(p[1])];const key=p.join(',');const old=byKey.get(key);
    if(old!==undefined)return old;const id=points.length;points.push(p);byKey.set(key,id);return id;};
  const segments:[GeoPoint,GeoPoint][]=[];
  for(const ring of rings)for(let i=1;i<ring.length;i++){add(ring[i-1]!);add(ring[i]!);segments.push([ring[i-1]!,ring[i]!]);}
  for(let i=0;i<=size;i++){add([x+i,y]);add([x+i,y+size]);add([x,y+i]);add([x+size,y+i]);}
  const step=1/density;
  for(let j=0;j<size*density;j++)for(let i=0;i<size*density;i++){
    const gx=x*density+i,gy=y*density+j;
    const hx=geoWrap(gx,d.width*density),hy=geoWrap(gy,d.height*density);
    const p:GeoPoint=[x+(i+.5+(geoHash(d.options.seed,hx,hy,901)-.5)*.65)*step,
      y+(j+.5+(geoHash(d.options.seed,hx,hy,902)-.5)*.65)*step];
    // Constraints may not intersect a third vertex. Keep interior points away.
    if(segments.every(([a,b])=>segmentDistance(p,a,b).distance>1e-4))add(p);
  }
  const edges:[number,number][]=[],seen=new Set<string>();
  for(const [a,b] of segments){
    const on=points.map((p,id)=>({id,...segmentDistance(p,a,b)})).filter(p=>p.distance<2e-6).sort((a,b)=>a.t-b.t||a.id-b.id);
    for(let i=1;i<on.length;i++){
      const first=on[i-1]!.id,last=on[i]!.id;if(first===last)continue;
      const key=Math.min(first,last)+':'+Math.max(first,last);
      if(!seen.has(key)){seen.add(key);edges.push([first,last]);}
    }
  }
  const delaunay=Delaunator.from(points);
  new Constrainautor(delaunay,edges);
  const samples=points.map(p=>sampleGeography(d,...p));
  const ground={positions:[] as number[],indices:[] as number[],colors:[] as number[],flow:[] as number[]};
  const liquid={positions:[] as number[],indices:[] as number[],colors:[] as number[],flow:[] as number[]};
  const emit=(ids:number[],wet:boolean)=>{
    const out=wet?liquid:ground,first=out.positions.length/3;
    const center=ids.reduce((p,id)=>[p[0]!+points[id]![0]/3,p[1]!+points[id]![1]/3],[0,0]);
    const tone=.87+.22*geoHash(d.options.seed,Math.floor(geoWrap(center[0]!,d.width)*32),Math.floor(geoWrap(center[1]!,d.height)*32),7919);
    for(const id of ids){
      const p=points[id]!,s=samples[id]!;
      const elevation=wet?waterProfile(localGeographyPoint(d,...p)[0]):s.elevation;
      out.positions.push(p[0]-x,elevation,p[1]-y);
      if(wet){out.colors.push(.19,.47,.49,1);out.flow.push(...s.flow);}
      else {
        const bank=1-Math.min(1,Math.abs(s.shoreDistance)/1.5),stone=s.rock;
        const grass=s.waterLevel===null?[.38,.46,.20]:[.28,.30,.24],sand=[.57,.53,.34],rock=[.54,.55,.53];
        for(let c=0;c<3;c++)out.colors.push((grass[c]!*(1-bank)+sand[c]!*bank)*(1-stone)+rock[c]!*stone*tone);
        out.colors.push(1);out.flow.push(0,0);
      }
    }
    out.indices.push(first,first+1,first+2);
  };
  for(let i=0;i<delaunay.triangles.length;i+=3){
    const ids=[delaunay.triangles[i]!,delaunay.triangles[i+1]!,delaunay.triangles[i+2]!];
    const a=points[ids[0]!]!,b=points[ids[1]!]!,c=points[ids[2]!]!;
    // Babylon's left-handed normal convention: positive signed area in x/z.
    const area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    if(Math.abs(area)<1e-12)continue;if(area<0)[ids[1],ids[2]]=[ids[2]!,ids[1]!];
    emit(ids,false);
    if(insideWater([(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3],water))emit(ids,true);
  }
  const pack=(b:typeof ground):GeographyBuffers=>({positions:new Float32Array(b.positions),indices:new Uint32Array(b.indices),colors:new Float32Array(b.colors),flow:new Float32Array(b.flow)});
  const packedGround=pack(ground),packedWater=pack(liquid);
  const boundary=points.flatMap((p,i)=>p[0]===x||p[0]===x+size||p[1]===y||p[1]===y+size?[[p[0],samples[i]!.elevation,p[1]]]:[]);
  return {x,y,ground:packedGround,water:packedWater,boundary,triangles:ground.indices.length/3,uniqueVertices:points.length,
    bytes:[packedGround,packedWater].reduce((sum,b)=>sum+b.positions.byteLength+b.indices.byteLength+b.colors.byteLength+b.flow.byteLength,0)};
}
