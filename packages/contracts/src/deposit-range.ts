import {spawnDelta} from './spawn-map.js';
export const DEPOSIT_EXPLOITATION_RANGE = 16;
/** Historical Chebyshev reach from completed footprint cell centres, not path length. */
export function withinDepositRange(cells:readonly {cellX:number;cellY:number}[],target:{cellX:number;cellY:number},world:{widthCells:number;heightCells:number}):boolean {
 return cells.some(c=>Math.max(Math.abs(spawnDelta(target.cellX,c.cellX,world.widthCells)),Math.abs(spawnDelta(target.cellY,c.cellY,world.heightCells)))<=DEPOSIT_EXPLOITATION_RANGE);
}
