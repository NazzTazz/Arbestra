// Fixed physical legend shared by the mesh and the operator panel.
const stops:Array<[number,readonly [number,number,number]]>=[
  [-16,[.04,.06,.20]],[-8,[.12,.16,.48]],[-4,[.10,.48,.72]],[0,[.65,.82,.88]],
  [1,[.28,.55,.32]],[4,[.80,.68,.32]],[8,[.72,.22,.16]],[16,[.95,.9,.84]],
];
export function altitudeColor(height:number):[number,number,number]{
  const z=Math.max(-16,Math.min(16,height));
  for(let i=1;i<stops.length;i++){
    const [b,cb]=stops[i]!,[a,ca]=stops[i-1]!;
    if(z<=b){const t=(z-a)/(b-a);return [0,1,2].map(k=>ca[k]!+(cb[k]!-ca[k]!)*t) as [number,number,number];}
  }
  return [...stops[stops.length-1]![1]];
}
export const ALTITUDE_LEGEND=[-16,-8,-4,0,1,4,8,16].map(height=>({height,color:'rgb('+altitudeColor(height).map(c=>Math.round(c*255)).join(',')+')'}));
