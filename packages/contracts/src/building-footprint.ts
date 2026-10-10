import {rotateSpawnPoint} from './spawn-map.js';
import {wrappedDistance,wrapCoordinate} from './infrastructure.js';
export interface FootprintCell {cellX:number;cellY:number}
export interface SpatialDimensions {widthCells:number;heightCells:number}
/** Canonical quarter-turn convention shared by preview, validation and persistence. */
export function transformFootprint<T extends {x:number;y:number}>(cells:readonly T[],anchor:{x:number;y:number},turns:number,world?:SpatialDimensions){
 return cells.map(c=>{const p=rotateSpawnPoint(c,turns),x=anchor.x+p.x,y=anchor.y+p.y;
 return {...c,cellX:world?wrapCoordinate(x,world.widthCells):x,cellY:world?wrapCoordinate(y,world.heightCells):y};});
}
/** Fixed composed buildings currently offered by Construire. Gardens remain selected surfaces. */
export function fixedBuildingFootprint(type:'university'|'stonemason',anchor:FootprintCell,turns=0,world?:SpatialDimensions):FootprintCell[]{
 const offsets=type==='university'?Array.from({length:30},(_,i)=>({x:i%5-2,y:Math.floor(i/5)-2})):[0,1].flatMap(x=>[0,1].map(y=>({x,y})));
 return transformFootprint(offsets,{x:anchor.cellX,y:anchor.cellY},turns,world).map(({cellX,cellY})=>({cellX,cellY}));
}

export const BUILD_REACH = 5;
/** Caller chooses eligible completed footprints; kit and paid construction retain their own costs. */
export function withinBuildReach(target:FootprintCell,cells:readonly FootprintCell[],world:SpatialDimensions):boolean {
 return cells.some(c=>Math.max(Math.abs(wrappedDistance(target.cellX,c.cellX,world.widthCells)),Math.abs(wrappedDistance(target.cellY,c.cellY,world.heightCells)))<=BUILD_REACH);
}
