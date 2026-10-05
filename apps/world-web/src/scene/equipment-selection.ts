import { wrappedDistance, type SubPoint } from '@arbestra/contracts';

export interface SelectableEquipment { id:string;version:number;position:SubPoint;quarterTurns:number }

/** A mesh hit is authoritative for selection; the ground point can differ on slopes. */
export function selectEquipment(items:readonly SelectableEquipment[],point:SubPoint,world:{widthCells:number;heightCells:number},pickedId?:string):SelectableEquipment|null{
  if(pickedId)return items.find(item=>item.id===pickedId)??null;
  return items.find(item=>Math.abs(wrappedDistance(item.position.x,point.x,world.widthCells*8))<2
    &&Math.abs(wrappedDistance(item.position.y,point.y,world.heightCells*8))<2)??null;
}
