/** Conforming, single-level shore refinement. The decision belongs to an edge,
 * not a triangle/chunk: both neighbours insert exactly the same shoreline vertex. */
export interface ShoreVertex {x:number;y:number;z:number;surface:number}
export function refineShoreTriangle<V extends ShoreVertex>(vertices:V[],sample:(x:number,y:number)=>V):V[][]{
 const mids=vertices.map((first,i)=>{
  const second=vertices[(i+1)%3]!;
  // A geographic dry plain close to sea level is not itself a shoreline.
  const da=first.z-first.surface,db=second.z-second.surface;
  if(da*db>=0||Math.min(Math.abs(da),Math.abs(db))<1e-8)return null;
  // Canonical edge direction also makes the root solve independent of winding.
  const [a,b]=first.x<second.x||(first.x===second.x&&first.y<second.y)?[first,second]:[second,first];
  const positive=a.z>a.surface;let low=0,high=1,v=a;
  for(let n=0;n<16;n++){
   const t=(low+high)/2;v=sample(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);
   const depth=v.z-v.surface;if(Math.abs(depth)<1e-8)break;
   if((depth>0)===positive)low=t;else high=t;
  }
  // Historic surface-level discontinuities cannot be made continuous by a renderer.
  // In that case refine once without inventing terrain/water data at the crossing.
  return Math.abs(v.z-v.surface)<.0001?v:sample((a.x+b.x)/2,(a.y+b.y)/2);
 });
 const count=mids.filter(Boolean).length;
 if(!count)return [vertices];
 if(count===3){const [a,b,c]=vertices,[ab,bc,ca]=mids as V[];return [[a!,ab!,ca!],[ab!,b!,bc!],[ca!,bc!,c!],[ab!,bc!,ca!]];}
 // Rotate the triangle, retaining winding. Two split edges meet at b.
 const i=count===1?mids.findIndex(Boolean):mids.findIndex((m,i)=>m&&mids[(i+1)%3]);
 const a=vertices[i]!,b=vertices[(i+1)%3]!,c=vertices[(i+2)%3]!,ab=mids[i]!;
 if(count===1)return [[a,ab,c],[ab,b,c]];
 const bc=mids[(i+1)%3]!;return [[ab,b,bc],[a,ab,bc],[a,bc,c]];
}
