import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import type {WorldSpace} from './world-space';

interface SurfacePixel {x:number;y:number}

/** Exact raster footprint, with a welded relief surface and only exposed side walls. */
export function flatRoadGeometry(
  pixels:ReadonlyMap<string,SurfacePixel>,
  space:WorldSpace,
  sample:(x:number,y:number)=>number|null,
  followTerrain:boolean,
  topOffset:number,
  depth=0,
):VertexData{
  const positions:number[]=[],indices:number[]=[],vertices=new Map<string,number>();
  const heights=new Map<string,number|null>();
  const wrap=(value:number,size:number)=>((value%size)+size)%size;
  const cell=(value:number,size:number)=>wrap(followTerrain?value:Math.floor(value+.5),size);
  const heightAt=(x:number,y:number)=>{
    const cx=cell(x/16,space.width),cy=cell(y/16,space.height),key=cx+':'+cy;
    if(!heights.has(key))heights.set(key,sample(cx,cy));
    return heights.get(key)!;
  };
  const point=(x:number,y:number,anchor:SurfacePixel,fallback:number):[number,number,number]=>{
    const projected=space.projectFrom({cellX:wrap(x/16,space.width),cellY:wrap(y/16,space.height)},
      {cellX:wrap(anchor.x/16,space.width),cellY:wrap(anchor.y/16,space.height)});
    return [projected.x,(heightAt(x,y)??fallback)+topOffset,projected.z];
  };
  const vertex=(x:number,y:number,anchor:SurfacePixel,fallback:number)=>{
    const p=point(x,y,anchor,fallback),key=p[0]+':'+p[2],prior=vertices.get(key);
    if(prior!==undefined)return prior;
    const id=positions.length/3;positions.push(...p);vertices.set(key,id);return id;
  };
  // Quarter-cell blocks retain the fine raster along contours, seams and corners.
  // Alignment also respects the terrain's half-cell triangulation boundaries.
  const used=new Set<string>();
  for(const size of [4,2,1])for(const [key,p]of pixels){
    if(used.has(key)||p.x%size||p.y%size)continue;
    let full=true;
    for(let dy=0;dy<size&&full;dy++)for(let dx=0;dx<size;dx++){
      const at=(p.x+dx)+':'+(p.y+dy);
      if(!pixels.has(at)||used.has(at)){full=false;break;}
    }
    if(!full)continue;
    for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++)used.add((p.x+dx)+':'+(p.y+dy));
    const anchor={x:p.x+size/2,y:p.y+size/2},height=heightAt(anchor.x,anchor.y);
    if(height===null)continue;
    const a=vertex(p.x,p.y,anchor,height),b=vertex(p.x+size,p.y,anchor,height);
    const c=vertex(p.x+size,p.y+size,anchor,height),d=vertex(p.x,p.y+size,anchor,height);
    // Babylon uses left-handed winding; these triangles have upward normals.
    indices.push(a,b,c,a,c,d);
  }
  if(depth>0){
    const width=space.width*16,height=space.height*16;
    const neighbour=(x:number,y:number)=>pixels.has(wrap(x,width)+':'+wrap(y,height));
    const edges=[
      {dx:0,dy:-1,ax:0,ay:0,bx:1,by:0},
      {dx:1,dy:0,ax:1,ay:0,bx:1,by:1},
      {dx:0,dy:1,ax:1,ay:1,bx:0,by:1},
      {dx:-1,dy:0,ax:0,ay:1,bx:0,by:0},
    ];
    for(const p of pixels.values()){
      let anchor:SurfacePixel|undefined,baseHeight:number|null|undefined;
      for(const edge of edges){
        if(neighbour(p.x+edge.dx,p.y+edge.dy))continue;
        anchor??={x:p.x+.5,y:p.y+.5};baseHeight??=heightAt(anchor.x,anchor.y);
        if(baseHeight===null)break;
        const a=point(p.x+edge.ax,p.y+edge.ay,anchor,baseHeight),b=point(p.x+edge.bx,p.y+edge.by,anchor,baseHeight),offset=positions.length/3;
        // Separate vertices preserve sharp curb normals without altering top lighting.
        positions.push(a[0],a[1]-depth,a[2],b[0],b[1]-depth,b[2],...b,...a);
        indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
      }
    }
  }
  const data=new VertexData(),normals:number[]=[];
  VertexData.ComputeNormals(positions,indices,normals);
  Object.assign(data,{positions,indices,normals});
  return data;
}
