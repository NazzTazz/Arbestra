import type {VillageState} from './villages.js';
import type {TravelCell} from './travel-paths.js';
import {wrapCoordinate,wrappedDistance} from './infrastructure.js';
export interface BuildingAccess {id:string;position:TravelCell;outside:TravelCell;normal:{x:number;y:number};width:number;principal:boolean}
/** Recipe offsets are in cells, relative to the unrotated footprint centre. */
export function buildingAccesses(state:Pick<VillageState,'world'|'cells'>,buildingId:string):BuildingAccess[]{
  const anchor=state.cells.find(c=>c.building?.id===buildingId);if(!anchor?.building)return [];
  const b=anchor.building,cells=state.cells.filter(c=>c.footprint?.buildingId===buildingId);
  const xs=(cells.length?cells:[anchor]).map(c=>wrappedDistance(c.cellX,anchor.cellX,state.world.widthCells));
  const ys=(cells.length?cells:[anchor]).map(c=>wrappedDistance(c.cellY,anchor.cellY,state.world.heightCells));
  const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
  const halfX=(Math.max(...xs)-Math.min(...xs)+1)/2,halfY=(Math.max(...ys)-Math.min(...ys)+1)/2;
  const turn=b.quarterTurns??b.visualLayout?.quarterTurns??0;
  const rotate=(x:number,y:number)=>turn===0?{x,y}:turn===1?{x:y,y:-x}:turn===2?{x:-x,y:-y}:{x:-y,y:x};
  const at=(x:number,y:number):TravelCell=>({cellX:wrapCoordinate(anchor.cellX+cx+x,state.world.widthCells),cellY:wrapCoordinate(anchor.cellY+cy+y,state.world.heightCells)});
  const definitions=b.accesses?.length?b.accesses:(()=>{
    const face=b.visualLayout?.entranceFace??'-z';
    const n=face.endsWith('x')?{x:face.startsWith('-')?-1:1,y:0}:{x:0,y:face.startsWith('-')?-1:1};
    const half=n.x?(turn%2?halfY:halfX):(turn%2?halfX:halfY);
    const bodyHalf=b.type==='dwelling'?.336:b.type==='town-hall'?(b.visualLayout?(face.endsWith('x')?.448:.896):.416):half*.8;
    const offset=b.visualLayout?.offset??[0,0];
    const factoryDoor=b.type==='dwelling'||(b.type==='town-hall'&&Boolean(b.visualLayout));
    return [{id:'main',x:n.x*bodyHalf+offset[0]/2.5,y:n.y*bodyHalf+offset[1]/2.5,dx:n.x,dy:n.y,width:factoryDoor?.224:.25,principal:true}];
  })();
  return definitions.map(access=>{
    const p=rotate(access.x,access.y),n=rotate(access.dx,access.dy);
    const edge=n.x?halfX:halfY,positionOnNormal=p.x*n.x+p.y*n.y;
    const clearance=b.type==='town-hall'&&!b.visualLayout?Math.max(edge,.75):edge;
    const outside=Math.ceil((Math.max(clearance,positionOnNormal)+.125)*8)/8-positionOnNormal;
    return {id:access.id,position:at(p.x,p.y),outside:at(p.x+n.x*outside,p.y+n.y*outside),normal:n,width:access.width,principal:access.principal};
  }).sort((a,b)=>Number(b.principal)-Number(a.principal)||a.id.localeCompare(b.id));
}
