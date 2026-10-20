import type { SpatialDimensions } from './building-footprint.js';
import { LEVELING_WORK_MS_PER_QUARTER } from './leveling.js';

export interface TerrainVertex { vertexX: number; vertexY: number; height: number }
type Cell = { cellX: number; cellY: number };
export const vertexKey = (v: Pick<TerrainVertex, 'vertexX' | 'vertexY'>) => `${v.vertexX}:${v.vertexY}`;
const wrap = (n: number, size: number) => (n % size + size) % size;
export const terrainHeightPrecision = (height: number) => Math.round(height * 1e6) / 1e6;
export function cellVertices(c: Cell, world: SpatialDimensions) {
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => ({
    vertexX: wrap(c.cellX + x!, world.widthCells), vertexY: wrap(c.cellY + y!, world.heightCells),
  }));
}
export function footprintVertices(cells: readonly Cell[], world: SpatialDimensions) {
  return [...new Map(cells.flatMap(c => cellVertices(c, world)).map(v => [vertexKey(v), v])).values()]
    .sort((a, b) => a.vertexX - b.vertexX || a.vertexY - b.vertexY);
}
export function vertexCells(vertices: readonly Pick<TerrainVertex, 'vertexX' | 'vertexY'>[], world: SpatialDimensions): Cell[] {
  return [...new Map(vertices.flatMap(v => [-1, 0].flatMap(dx => [-1, 0].map(dy => ({
    cellX: wrap(v.vertexX + dx, world.widthCells), cellY: wrap(v.vertexY + dy, world.heightCells),
  })))).map(c => [`${c.cellX}:${c.cellY}`, c])).values()].sort((a,b) => a.cellX-b.cellX || a.cellY-b.cellY);
}
/** Diagonal 00 -> 11. Used both by the mesh and authoritative sampling. */
export function triangleHeight(h00: number, h10: number, h11: number, h01: number, u: number, v: number) {
  return u >= v ? h00 * (1-u) + h10 * (u-v) + h11 * v : h00 * (1-v) + h11 * u + h01 * (v-u);
}
export function vertexSurface(world: SpatialDimensions, natural: (x:number,y:number)=>number, edits: readonly TerrainVertex[]) {
  const values = new Map(edits.map(v => [vertexKey(v), v.height]));
  const height = (x: number, y: number) => {
    x=wrap(x,world.widthCells); y=wrap(y,world.heightCells);
    const key=`${x}:${y}`, prior=values.get(key);
    if(prior!==undefined)return prior;
    const value=terrainHeightPrecision(natural(x-.5,y-.5)); values.set(key,value); return value;
  };
  const sample = (x:number,y:number) => {
    const ix=Math.floor(x+.5),iy=Math.floor(y+.5);
    return triangleHeight(height(ix,iy),height(ix+1,iy),height(ix+1,iy+1),height(ix,iy+1),x+.5-ix,y+.5-iy);
  };
  return { height, sample };
}

/** Integral of |linear height| over a triangle of area 1/2, clipping at zero. */
export function absoluteTriangleVolume(heights: readonly [number,number,number]) {
  type P = {x:number;y:number;h:number};
  const triangle: P[] = heights.map((h,i)=>({x:i===1?1:0,y:i===2?1:0,h}));
  let total=0;
  for(const sign of [-1,1]){
    const polygon:P[]=[];
    for(let i=0;i<3;i++){
      const a=triangle[i]!,b=triangle[(i+1)%3]!,da=a.h*sign,db=b.h*sign;
      if(da>=0)polygon.push(a);
      if((da>=0)!==(db>=0)){const t=da/(da-db);polygon.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,h:0});}
    }
    for(let i=1;i<polygon.length-1;i++){
      const a=polygon[0]!,b=polygon[i]!,c=polygon[i+1]!;
      const area=Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2;
      total+=area*(a.h+b.h+c.h)*sign/3;
    }
  }
  return total;
}
export function vertexLeveling(cells: readonly Cell[], world: SpatialDimensions, heightAt: (x:number,y:number)=>number, workers:number, targetHeight?:number) {
  if(!cells.length || !Number.isInteger(workers) || workers<1 || workers>(targetHeight===undefined?3:50) || targetHeight!==undefined&&!Number.isFinite(targetHeight))throw Error('Invalid leveling footprint/team');
  const points=footprintVertices(cells,world), selected=new Set(points.map(vertexKey)), affectedCells=vertexCells(points,world);
  const triangles=affectedCells.flatMap(c=>{const vs=cellVertices(c,world);return [[vs[0]!,vs[1]!,vs[2]!],[vs[0]!,vs[2]!,vs[3]!]];});
  let sum=0,weight=0;
  for(const t of triangles)for(const v of t)if(selected.has(vertexKey(v))){sum+=heightAt(v.vertexX,v.vertexY);weight++;}
  if(!Number.isFinite(sum))throw Error('Terrain heights unavailable');
  const height=terrainHeightPrecision(targetHeight??sum/weight);
  let volume=0;
  for(const t of triangles)volume+=absoluteTriangleVolume(t.map(v=>selected.has(vertexKey(v))?height-heightAt(v.vertexX,v.vertexY):0) as [number,number,number]);
  return {height,vertices:points.map(v=>({...v,height})),affectedCells,volume,workMs:Math.max(1,Math.ceil(volume/.25*LEVELING_WORK_MS_PER_QUARTER/workers))};
}
/** No averaging of incompatible historical foundations. */
export function convertTerraces(terraces: readonly (Cell & {height:number})[], world: SpatialDimensions) {
  const vertices=new Map<string,TerrainVertex>(),conflicts=new Set<string>();
  for(const c of terraces)for(const v of cellVertices(c,world)){
    const key=vertexKey(v), height=terrainHeightPrecision(c.height),prior=vertices.get(key);
    if(prior && prior.height!==height)conflicts.add(key);
    else vertices.set(key,{...v,height});
  }
  return {vertices:[...vertices.values()].sort((a,b)=>a.vertexX-b.vertexX||a.vertexY-b.vertexY),conflicts:[...conflicts].sort()};
}
