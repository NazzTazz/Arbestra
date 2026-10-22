import {useCallback,useEffect,useRef,useState} from 'react';
import {visibleSyncV2Scope,type ProcessingCommand,type ProcessingOrder,type SyncV2State} from '@arbestra/contracts';
import {SyncV2Transport} from './sync-v2-transport';
import {SyncV2SessionExpired} from './sync-v2-session';

/** Newest first, like the historical snapshot. The private stream keeps
 * terminal orders as values, so the latest outcome stays displayable. */
export function processingOrdersV2(state:SyncV2State):ProcessingOrder[]{
  const scope=state.scopes.get(`village:${state.villageId}`);
  if(!scope)return [];
  const orders:ProcessingOrder[]=[];
  for(const [key,value] of visibleSyncV2Scope(scope))if(key.startsWith('processingOrders:'))orders.push(value as ProcessingOrder);
  return orders.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id));
}

export function processingCommandBuilding(command:ProcessingCommand,orders:readonly ProcessingOrder[]):string|null{
  return 'buildingId' in command?command.buildingId:orders.find(order=>order.id===command.orderId)?.buildingId??null;
}

export type ProcessingV2Status='off'|'starting'|'ready'|'unavailable';

/** Workshop slice of V2: the rest of the village still follows V1. A server
 * that does not negotiate V2 leaves the workshop on its historical path. */
export function useProcessingV2(worldSlug:string,worldId:string|undefined,villageId:string|undefined,enabled:boolean,onExpired:()=>void){
  const [status,setStatus]=useState<ProcessingV2Status>('off');
  const [orders,setOrders]=useState<ProcessingOrder[]>([]);
  const [unresolved,setUnresolved]=useState<ProcessingCommand[]>([]);
  const transport=useRef<SyncV2Transport|null>(null);
  const expired=useRef(onExpired);expired.current=onExpired;
  useEffect(()=>{
    if(!enabled||!worldId||!villageId){setStatus('off');return;}
    const current=new SyncV2Transport(worldSlug,worldId,villageId,{
      publish:state=>setOrders(processingOrdersV2(state)),expired:()=>expired.current()});
    transport.current=current;setStatus('starting');
    void (async()=>{
      try{await current.start();}
      catch(error){
        if(transport.current!==current)return;
        current.close();transport.current=null;
        if(error instanceof SyncV2SessionExpired){setStatus('off');expired.current();}
        else setStatus('unavailable');
        return;
      }
      if(transport.current!==current)return;
      setStatus('ready');
      const list=await current.recover().catch(()=>current.pending());
      if(transport.current===current)setUnresolved(list);
    })();
    return ()=>{current.close();if(transport.current===current)transport.current=null;setOrders([]);setUnresolved([]);};
  },[enabled,worldSlug,worldId,villageId]);
  const command=useCallback(async(command:ProcessingCommand)=>{
    const current=transport.current;
    if(!current)throw Error('Synchronisation indisponible.');
    try{await current.processing(command);}
    finally{if(transport.current===current)setUnresolved(current.pending());}
  },[]);
  const discard=useCallback((commandId:string)=>{
    const current=transport.current;if(!current)return;
    current.forget(commandId);setUnresolved(current.pending());
  },[]);
  return {status,orders,unresolved,command,discard};
}
