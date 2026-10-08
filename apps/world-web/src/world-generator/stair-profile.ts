import type { GeneratedLandscape, NaturalStair } from '@arbestra/contracts';
/** Shallow treads; descending risers belong at the far edge of each tread. */
export function stairProfile(stair:NaturalStair,data:Pick<GeneratedLandscape,'elevations'>){
  const first=data.elevations[stair.from]!,last=data.elevations[stair.to]!,count=8,ascending=last>first;
  return Array.from({length:count},(_,k)=>{
    const a=k*stair.length/count,b=(k+1)*stair.length/count;
    const near=first+(last-first)*k/count,far=first+(last-first)*(k+1)/count;
    return {a,b,height:ascending?far:near,riserAt:ascending?a:b,near,far};
  });
}
