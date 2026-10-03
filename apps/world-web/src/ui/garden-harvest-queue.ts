import { ApiError, type TimedVillageState } from '../api/client';
import type { Cell } from '../scene/construction-selection';

export interface HarvestTarget extends Cell { worldSlug:string;villageId:string;buildingId:string }
export interface HarvestIntent extends HarvestTarget {targets:HarvestTarget[];commandId:string;gesture:number;status:'selecting'|'queued'|'sending'|'uncertain'}
const key=(p:HarvestTarget)=>`${p.worldSlug}:${p.villageId}:${p.cellX}:${p.cellY}`;

/** A gesture commits one immutable tour; an uncertain reply keeps its receipt. */
export class GardenHarvestQueue {
  private intents:HarvestIntent[]=[];
  private draft:HarvestIntent|null=null;
  private gesture=0;
  private running:Promise<void>|null=null;
  private notified=new Set<number>();
  constructor(private readonly handlers:{send:(intent:HarvestIntent)=>Promise<TimedVillageState>;accepted:(snapshot:TimedVillageState)=>void;
    warning:(message:string)=>void;changed:(intents:HarvestIntent[])=>void}){}
  pending(){return [...this.intents,...(this.draft?[this.draft]:[])].flatMap(i=>i.targets.map(t=>({...i,...t,targets:i.targets.map(p=>({...p}))})));}
  has(target:HarvestTarget){return this.pending().some(p=>key(p)===key(target));}
  enqueue(target:HarvestTarget,newGesture:boolean){
    if(newGesture){this.cancelGesture();this.gesture++;}
    if(this.has(target)){this.retry();return;}
    if(!this.draft)this.draft={...target,targets:[],gesture:this.gesture,commandId:crypto.randomUUID(),status:'selecting'};
    if(this.draft.worldSlug!==target.worldSlug||this.draft.villageId!==target.villageId)return;
    if(this.draft.targets.length>=100)return;
    this.draft.targets.push({...target});this.changed();
  }
  finishGesture(){if(!this.draft)return;this.draft.status='queued';this.intents.push(this.draft);this.draft=null;this.changed();this.drain();}
  cancelGesture(){this.draft=null;this.changed();}
  retry(){if(this.running||!this.intents.length)return;this.intents[0]!.status='queued';this.drain();}
  settled(){return this.running??Promise.resolve();}
  private changed(){this.handlers.changed(this.pending());}
  private drain(){if(!this.running)this.running=this.process().finally(()=>{this.running=null;});}
  private async process(){
    while(this.intents.length){const intent=this.intents[0]!;intent.status='sending';this.changed();
      try{this.handlers.accepted(await this.handlers.send(intent));this.intents.shift();}
      catch(error){const definite=error instanceof ApiError&&error.status>=400&&error.status<500;
        if(!this.notified.has(intent.gesture)){this.notified.add(intent.gesture);this.handlers.warning(definite?error.message:'Tournée à confirmer. La même demande sera réessayée.');}
        if(!definite){intent.status='uncertain';this.changed();return;}this.intents.shift();
      }this.changed();
    }this.notified.clear();
  }
}
