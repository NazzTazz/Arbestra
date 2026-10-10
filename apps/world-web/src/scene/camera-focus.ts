import type {Cell} from './construction-selection';
import {delta,normalize} from './world-space';
/** Canonical interpolation remains continuous when the local Babylon frame rebases. */
export function cameraFocusAt(from:Cell,to:Cell,width:number,height:number,progress:number){
 const t=Math.max(0,Math.min(1,progress)),eased=t*t*(3-2*t);
 return {cellX:normalize(from.cellX+delta(to.cellX,from.cellX,width)*eased,width),cellY:normalize(from.cellY+delta(to.cellY,from.cellY,height)*eased,height),eased};
}
