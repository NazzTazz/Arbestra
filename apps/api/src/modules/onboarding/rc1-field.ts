import {createSpawnTerrainField,type GeneratedLandscape} from '@arbestra/contracts';
export {editedRc1Field} from '@arbestra/contracts';
export interface Rc1ResourceGroup {sourceKey:string;kind:'wood'|'stone';cellX:number;cellY:number;treeIndices:number[];amount:number}
export interface Rc1ResourceState extends Rc1ResourceGroup {featureId?:string;remainingAmount:number;reservedAmount:number;cleared:boolean;removedIndices:number[]}
export function rc1ResourceGroups(data:GeneratedLandscape,field=createSpawnTerrainField(data)):Rc1ResourceGroup[]{
 const groups:Rc1ResourceGroup[]=[];
 const buckets=new Map<string,number[]>();
 for(const [i,t]of (data.forest?.trees??[]).entries()){const key=`wood:${Math.floor((Math.round(t.x)%512)/4)}:${Math.floor((Math.round(t.y)%256)/4)}`;const indices=buckets.get(key)??[];indices.push(i);buckets.set(key,indices);}
 const used=new Set<string>();
 for(const [sourceKey,treeIndices]of buckets){
  let cell:{cellX:number;cellY:number}|undefined;
  for(const i of treeIndices){const t=data.forest!.trees[i]!;const x=Math.round(t.x)%512,y=Math.round(t.y)%256;
   if(!used.has(`${x}:${y}`)&&!field.surfaceReason({x,y,halfWidth:0,halfHeight:0},null,.125)){cell={cellX:x,cellY:y};break;}}
  if(!cell){const t=data.forest!.trees[treeIndices[0]!]!;cell={cellX:Math.round(t.x)%512,cellY:Math.round(t.y)%256};}
  used.add(`${cell.cellX}:${cell.cellY}`);groups.push({sourceKey,kind:'wood',...cell,treeIndices,amount:treeIndices.length*500});
 }
 for(const site of data.stoneSites??[]){
  // Interaction cell beside the fixed formation; the original rock geometry never moves.
  let access:{x:number;y:number}|undefined;
  for(let radius=0;radius<=8&&!access;radius++)for(let dy=-radius;dy<=radius&&!access;dy++)for(let dx=-radius;dx<=radius&&!access;dx++){
   if(Math.max(Math.abs(dx),Math.abs(dy))!==radius)continue;
   const point={x:(Math.round(site.x)+dx+512)%512,y:(Math.round(site.y)+dy+256)%256};
   if(!field.surfaceReason({...point,halfWidth:.5,halfHeight:.5},null,.125))access=point;
  }
  groups.push({sourceKey:`stone:${site.id}`,kind:'stone',cellX:access?.x??Math.round(site.x)%512,cellY:access?.y??Math.round(site.y)%256,treeIndices:[],amount:2000});
 }
 return groups;
}
