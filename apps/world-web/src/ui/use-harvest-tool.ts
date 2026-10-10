import {useEffect,useRef,useState,type RefObject} from 'react';
import type {HarvestIntent,HarvestReceipt,VillageState} from '@arbestra/contracts';
import {ApiError,sendHarvestIntent,readHarvestReceipts} from '../api/client';
import {randomUUID} from '../random-uuid';
import type {Cell} from '../scene/construction-selection';
import type {TerrainHandle} from '../scene/VillageScene';
import {cellKey} from '../scene/construction-selection';
export type HarvestFilter='all'|'gardens'|'wood'|'stone';
type Draft={intent:HarvestIntent;cells:Cell[];submitted?:boolean};
export type HarvestFeedback=Cell&{id:string;text:string;resource:'carrot'|'wood'|'stone'|'error';at:number};
const reasons:Record<string,string>={'already-assigned':'Déjà prévu','out-of-range':'Hors de portée',protected:'Protégé',interior:'Inaccessible',unreachable:'Sans chemin',depleted:'Épuisé',empty:'Vide','not-found':'Indisponible','building-incomplete':'En construction'};
export function useHarvestTool({state,scene,enabled,slug,onAccepted}:{state:VillageState|null;scene:RefObject<TerrainHandle|null>;enabled:boolean;slug:string;onAccepted:()=>void}){
  const [filter,setFilter]=useState<HarvestFilter>('all');
  const [pendingCells,setPendingCells]=useState<Cell[]>([]);
  const [feedback,setFeedback]=useState<HarvestFeedback[]>([]);
  const [networkError,setNetworkError]=useState(false);
  const draft=useRef<Draft|null>(null),queue=useRef<Draft[]>([]),flight=useRef(false),alive=useRef(true),retryTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const current=useRef({state,enabled,filter,onAccepted});current.current={state,enabled,filter,onAccepted};
  const storageKey=state?`arbestra:harvest-intents:${state.world.id}:${state.village.id}`:null;
  const context=useRef(storageKey);context.current=storageKey;
  function publish(){setPendingCells([...queue.current.flatMap(d=>d.cells),...(draft.current?.cells??[])]);}
  function persist(){if(context.current)sessionStorage.setItem(context.current,JSON.stringify(queue.current));publish();}
  function flash(receipt:HarvestReceipt,item:Draft){
    const at=Date.now();
    const entries:HarvestFeedback[]=receipt.accepted.map(a=>({...a,id:randomUUID(),text:`+${a.amount}`,at}));
    for(const rejection of receipt.refused){
      const feature=current.current.state?.region.features.find(f=>f.id===rejection.key);
      const cell=rejection.key.startsWith('garden:')?{cellX:Number(rejection.key.split(':')[1]),cellY:Number(rejection.key.split(':')[2])}:feature??item.cells[0];
      if(cell)entries.push({...cell,id:randomUUID(),text:reasons[rejection.reason]??rejection.reason,resource:'error',at});
    }
    setFeedback(previous=>[...previous.filter(f=>at-f.at<3000),...entries].slice(-32));
  }
  async function drain(){
    const item=queue.current.find(d=>!d.submitted),village=current.current.state;
    if(flight.current||!item||!village)return;
    flight.current=true;const key=context.current;
    try{
      const receipt=await sendHarvestIntent(slug,village.village.id,item.intent);
      if(!alive.current||key!==context.current)return;
      if(receipt.pending)item.submitted=true;
      else{queue.current=queue.current.filter(d=>d.intent.commandId!==item.intent.commandId);flash(receipt,item);current.current.onAccepted();}
      persist();setNetworkError(false);
    }catch(error){
      if(!alive.current||key!==context.current)return;
      if(error instanceof ApiError&&error.status<500&&error.status!==429){
        queue.current=queue.current.filter(d=>d.intent.commandId!==item.intent.commandId);persist();flash({commandId:item.intent.commandId,accepted:[],refused:[{key:'',reason:error.message}]},item);
      }else{setNetworkError(true);retryTimer.current=setTimeout(()=>{retryTimer.current=null;void drain();},3000);}
    }finally{flight.current=false;if(alive.current&&key===context.current&&!retryTimer.current)void drain();}
  }
  useEffect(()=>{
    alive.current=true;queue.current=[];draft.current=null;
    if(storageKey){try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??'[]');if(Array.isArray(saved))queue.current=saved.filter(d=>d?.intent?.commandId&&Array.isArray(d.cells));}catch{/* No command can be recovered from corrupt storage. */}}
    publish();void drain();
    return()=>{alive.current=false;if(retryTimer.current)clearTimeout(retryTimer.current);retryTimer.current=null;};
  },[storageKey]);
  useEffect(()=>{
    let cancelled=false,busy=false;
    const poll=async()=>{const village=current.current.state,ids=queue.current.filter(d=>d.submitted).slice(0,64).map(d=>d.intent.commandId);
      if(busy||!village||!ids.length)return;busy=true;
      try{const receipts=await readHarvestReceipts(slug,village.village.id,ids);if(cancelled)return;
        for(const receipt of receipts){if(receipt.pending)continue;const item=queue.current.find(d=>d.intent.commandId===receipt.commandId);if(!item)continue;
          queue.current=queue.current.filter(d=>d!==item);flash(receipt,item);current.current.onAccepted();}
        persist();setNetworkError(false);
      }catch{if(!cancelled)setNetworkError(true);}finally{busy=false;}
    };const timer=setInterval(()=>void poll(),1000);return()=>{cancelled=true;clearInterval(timer);};
  },[storageKey]);
  function cancel(){draft.current=null;publish();}
  function collect(cell:Cell|null,newGesture=false,previewOnly=false){
    if(previewOnly||!current.current.enabled)return;
    const village=current.current.state;if(!village)return;
    if(!cell){
      const item=draft.current;draft.current=null;
      if(item&&(item.intent.gardens.length||item.intent.wood.length||item.intent.stone.length)){queue.current.push(item);persist();void drain();}else publish();
      return;
    }
    if(newGesture)draft.current={intent:{commandId:randomUUID(),gardens:[],wood:[],stone:[]},cells:[]};
    const item=draft.current;if(!item)return;
    const selected=current.current.filter;
    const garden=village.cells.some(c=>c.building?.status==='completed'&&c.building.garden?.plots.some(p=>cellKey(p)===cellKey(cell)));
    let changed=false;
    if(garden&&(selected==='all'||selected==='gardens')&&item.intent.gardens.length<100&&!item.intent.gardens.some(p=>cellKey(p)===cellKey(cell))){item.intent.gardens.push(cell);changed=true;}
    for(const feature of scene.current?.featuresAt(cell)??village.region.features.filter(f=>cellKey(f)===cellKey(cell))){
      const family=feature.deposit?.resourceCode;
      if((family==='wood'||family==='stone')&&(selected==='all'||selected===family)&&item.intent[family].length<64&&!item.intent[family].includes(feature.id)){
        item.intent[family].push(feature.id);changed=true;
      }
    }
    if(changed&&!item.cells.some(p=>cellKey(p)===cellKey(cell)))item.cells.push(cell);
    publish();
  }
  return{filter,setFilter,pendingCells,feedback,networkError,collect,cancel,hasDraft:()=>!!draft.current};
}
