import {useCallback,useEffect,useRef,useState} from 'react';
import {visibleSyncV2Scope,villageStateFromSyncV2,VILLAGE_PRESENTATION_COMPONENTS,type ProcessingCommand,type ProcessingOrder,
  type SyncV2State,type VillagePresentation} from '@arbestra/contracts';
import type {TimedVillageState} from './client';
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
type Options={worldSlug:string;worldId:string|undefined;villageId:string|undefined;enabled:boolean;
  /** Whole village from V2 (streams + presentation), not only the workshop. */
  village:boolean;onState:(update:TimedVillageState)=>void;onExpired:()=>void};

/** One V2 transport per mounted village. The workshop always uses it when
 * the server negotiates V2; the whole village only in village mode. A server
 * that does not negotiate V2 leaves both on their historical path. */
export function useVillageSyncV2({worldSlug,worldId,villageId,enabled,village,onState,onExpired}:Options){
  const [status,setStatus]=useState<ProcessingV2Status>('off');
  const [villageReady,setVillageReady]=useState(false);
  const [orders,setOrders]=useState<ProcessingOrder[]>([]);
  const [unresolved,setUnresolved]=useState<ProcessingCommand[]>([]);
  const transport=useRef<SyncV2Transport|null>(null);
  const expired=useRef(onExpired);expired.current=onExpired;
  const accept=useRef(onState);accept.current=onState;
  useEffect(()=>{
    if(!enabled||!worldId||!villageId){setStatus('off');return;}
    let presentation:VillagePresentation|null=null,latest:{state:SyncV2State;observedAt:string}|null=null;
    let loading=false,stale=false;
    const emit=()=>{
      if(!presentation||!latest||transport.current!==current)return;
      const projected=villageStateFromSyncV2(latest.state,presentation,latest.observedAt);
      if(!projected)return;
      accept.current({state:projected,serverOffsetMs:Date.parse(latest.observedAt)-Date.now(),source:'v2'});
      setVillageReady(true);
    };
    // Single flight; a structural change during a read triggers one more.
    const loadPresentation=async()=>{
      if(loading){stale=true;return;}
      loading=true;
      try{do{stale=false;const next=await current.presentation(presentation?.version);if(next)presentation=next;}while(stale&&transport.current===current);}
      catch(error){if(error instanceof SyncV2SessionExpired&&transport.current===current){current.close();expired.current();return;}}
      finally{loading=false;}
      emit();
    };
    const current=new SyncV2Transport(worldSlug,worldId,villageId,{
      // Convoys are public world entities: the traffic stream shows them all.
      ...(village?{include:['knowledge','manifest','traffic'] as const}:{}),expired:()=>expired.current(),
      publish:(state,observedAt,batch)=>{
        setOrders(processingOrdersV2(state));
        if(!village)return;
        // An ACK carries its command time, possibly before the last delta.
        latest={state,observedAt:latest&&latest.observedAt>observedAt?latest.observedAt:observedAt};
        const structural=batch.coverage==='scope-snapshot'||batch.groups.some(group=>group.changes.some(change=>
          (VILLAGE_PRESENTATION_COMPONENTS as readonly string[]).includes(change.component)&&(change.upsert.length>0||change.remove.length>0)));
        // Never show a building without its footprint: wait for the new read.
        if(structural||!presentation)void loadPresentation();else emit();
      }});
    transport.current=current;setStatus('starting');setVillageReady(false);
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
    return ()=>{current.close();if(transport.current===current)transport.current=null;setOrders([]);setUnresolved([]);setVillageReady(false);};
  },[enabled,village,worldSlug,worldId,villageId]);
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
  /** Immediate delta read, e.g. after a command still answered by V1. */
  const refresh=useCallback(()=>{transport.current?.reconnect();},[]);
  return {status,villageReady,orders,unresolved,command,discard,refresh};
}
