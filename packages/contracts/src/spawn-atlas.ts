import { Type, type Static } from '@sinclair/typebox';
import { spawnDelta, type SpawnPoint, type SpawnSurface } from './spawn-map.js';

export const AtlasPresentationSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 80 }), slogan: Type.String({ maxLength: 180 }),
}, { additionalProperties: false });
export type AtlasPresentation = Static<typeof AtlasPresentationSchema>;
export interface SpawnTerritory { villageId: string; points: SpawnPoint[] }
export const SpawnTerritorySchema = Type.Object({ villageId: Type.String({ format: 'uuid' }),
  points: Type.Array(Type.Object({ x: Type.Number(), y: Type.Number() }, { additionalProperties: false }), { minItems: 3, maxItems: 32 }) });
export const DrawSpawnTerritorySchema = Type.Object({ points: Type.Array(Type.Object({
  x: Type.Integer({minimum:0,maximum:511}),y:Type.Integer({minimum:0,maximum:255}),
}, {additionalProperties:false}), {minItems:3,maxItems:32}) }, {additionalProperties:false});
export function territoriesOverlap(a:readonly SpawnPoint[],b:readonly SpawnPoint[],width:number,height:number):boolean {
  if(!a.length||!b.length)return false;
  const origin=a[0]!,first=b[0]!,dx=origin.x+spawnDelta(first.x,origin.x,width)-first.x,dy=origin.y+spawnDelta(first.y,origin.y,height)-first.y;
  const shifted=b.map(p=>({x:p.x+dx,y:p.y+dy}));
  if(insideTerritory(origin,shifted,width,height)||insideTerritory(shifted[0]!,a,width,height))return true;
  return a.some((p,i)=>shifted.some((q,j)=>segmentsIntersect(p,a[(i+1)%a.length]!,q,shifted[(j+1)%shifted.length]!)));
}
/** Stored vertices are unwrapped around their hall; the display duplicates across seams. */
export function unwrapTerritory(points: readonly SpawnPoint[], hall: SpawnPoint, width: number, height: number): SpawnPoint[] {
  return points.map(p=>({x:hall.x+spawnDelta(p.x,hall.x,width),y:hall.y+spawnDelta(p.y,hall.y,height)}));
}
function cross(a:SpawnPoint,b:SpawnPoint,c:SpawnPoint){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function onSegment(p:SpawnPoint,a:SpawnPoint,b:SpawnPoint){return Math.abs(cross(a,b,p))<1e-8&&p.x>=Math.min(a.x,b.x)-1e-8&&p.x<=Math.max(a.x,b.x)+1e-8&&p.y>=Math.min(a.y,b.y)-1e-8&&p.y<=Math.max(a.y,b.y)+1e-8;}
export function segmentsIntersect(a:SpawnPoint,b:SpawnPoint,c:SpawnPoint,d:SpawnPoint):boolean {
  return onSegment(a,c,d)||onSegment(b,c,d)||onSegment(c,a,b)||onSegment(d,a,b)||(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0);
}
/** Closed boundary: a hall on the traced frontier is inside. */
export function insideTerritory(point:SpawnPoint,points:readonly SpawnPoint[],width:number,height:number):boolean {
  if(points.length<3)return false;
  const first=points[0]!,p={x:first.x+spawnDelta(point.x,first.x,width),y:first.y+spawnDelta(point.y,first.y,height)};
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[j]!,b=points[i]!;
    if(onSegment(p,a,b))return true;
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
export function simpleTerritory(points:readonly SpawnPoint[]):boolean {
  let area=0;
  for(let i=0;i<points.length;i++){
    const a=points[i]!,b=points[(i+1)%points.length]!;
    if(a.x===b.x&&a.y===b.y)return false;
    area+=a.x*b.y-b.x*a.y;
    for(let j=i+1;j<points.length;j++){
      if(j===i+1||(i===0&&j===points.length-1))continue;
      if(segmentsIntersect(a,b,points[j]!,points[(j+1)%points.length]!))return false;
    }
  }
  return Math.abs(area)>1e-6;
}
/** Cleaning proposal only; no mutation, no timber credit. Geometry stays exact. */
export interface SpawnCleaningPlan { referenceHeight: number; surfaces: SpawnSurface[]; removedTreeIndices: number[]; woodCredit: 0 }
