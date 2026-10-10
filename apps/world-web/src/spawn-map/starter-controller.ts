import type {ReactNode} from 'react';
import type {StarterElement, SpawnPoint, VillageState} from '@arbestra/contracts';
import type {AreaPreview, Cell} from '../scene/construction-selection';
export interface StarterGhost {
 elements:StarterElement[]; point:SpawnPoint; quarterTurns:number; relativeToHall:boolean; referenceHeight?:number;
}
export interface StarterController {
 onSnapshot:(state:VillageState)=>void; state:VillageState; beforeTownHall:boolean; active:boolean; pending:boolean; uncertain:boolean; error:string|null;
 ghost:StarterGhost; preview:AreaPreview; choices:Array<{key:string;label:string;code:string}>; selected:string;
 onChoose:(key:string)=>void; onGesture:(cell:Cell,commit:boolean)=>void; onManual:()=>void; onRotate:()=>void; onRetry:()=>void;
 names:ReactNode;
}
