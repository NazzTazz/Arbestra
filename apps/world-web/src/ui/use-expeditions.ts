import {useCallback,useEffect,useRef,useState} from 'react';
import {mergeExpeditionReceipt,type ExpeditionIntent,type ExpeditionReceipt,type ScienceCommand} from '@arbestra/contracts';
import {sendExpedition,readExpeditionReceipts,ApiError} from '../api/client';
import {randomUUID} from '../random-uuid';
type Entry={intent?:ExpeditionIntent;receipt?:ExpeditionReceipt;uncertain?:boolean;message?:string};
export function useExpeditions(slug:string,worldId:string|undefined,villageId:string|undefined,enabled=true){
 const scope=worldId&&villageId?worldId+':'+villageId:'';
 const currentScope=useRef(scope);currentScope.current=scope;const active=useRef(enabled);active.current=enabled;
 const generation=useRef(0),context=useRef({scope,enabled});
 if(context.current.scope!==scope||context.current.enabled!==enabled){generation.current++;context.current={scope,enabled};}
 const records=useRef(new Map<string,Entry>()),[entries,setEntries]=useState<Entry[]>([]);
 const key='arbestra:expeditions:'+scope;
 const publish=useCallback(()=>{
  const list=[...records.current.values()];setEntries(list);
  try{sessionStorage.setItem(key,JSON.stringify(list.filter(e=>e.intent&&(e.uncertain||e.receipt?.status==='pending'||!e.receipt&&!e.message))));}catch{/* durable server receipts still recover admitted requests */}
 },[key]);
 const receive=useCallback((receipt:ExpeditionReceipt)=>{
  if(!active.current||currentScope.current!==scope||receipt.worldId!==worldId||receipt.villageId!==villageId)return;
  const old=records.current.get(receipt.commandId);
  const merged=mergeExpeditionReceipt(old?.receipt,receipt);
  if(old?.receipt===merged&&!old.uncertain&&!old.message)return;
  records.current.set(receipt.commandId,{...(old?.intent?{intent:old.intent}:{}),receipt:merged});
  while(records.current.size>68){const item=[...records.current].find(([,e])=>e.receipt?.status!=='pending'&&!e.uncertain);if(!item)break;records.current.delete(item[0]);}
  publish();
 },[scope,worldId,villageId,publish]);
 const send=useCallback(async(intent:ExpeditionIntent)=>{
  if(!active.current||!villageId||currentScope.current!==scope)return;const epoch=generation.current;
  const previous=records.current.get(intent.commandId);
  if(previous?.receipt&&previous.receipt.status!=='pending')return;
  records.current.set(intent.commandId,{...previous,intent});publish();
  try{const receipt=await sendExpedition(slug,villageId,intent);if(active.current&&generation.current===epoch)receive(receipt);}
  catch(error){
   if(!active.current||currentScope.current!==scope||generation.current!==epoch)return;
   const old=records.current.get(intent.commandId);if(old?.receipt&&old.receipt.status!=='pending')return;
   const retryable=!(error instanceof ApiError)||error.status>=500||error.status===429;
   records.current.set(intent.commandId,{...old,intent,uncertain:retryable,message:retryable?'Demande à confirmer · nouvelle vérification en cours.':error instanceof Error?error.message:'Départ impossible.'});publish();
  }
 },[slug,villageId,scope,publish,receive]);
 useEffect(()=>{
  records.current.clear();setEntries([]);
  if(!enabled){try{sessionStorage.removeItem(key);}catch{/* no local recovery */}return;}
  if(!scope)return;
  try{const saved=JSON.parse(sessionStorage.getItem(key)??'[]') as Entry[];for(const item of saved)if(item.intent?.commandId&&['survey','explore'].includes(item.intent.action))records.current.set(item.intent.commandId,{...item,uncertain:true});}catch{/* corrupt local recovery does not change authoritative data */}
  publish();
  let cancelled=false,reading=false,initial=true;
  const recover=async()=>{
   if(cancelled||reading||!villageId)return;
   if(!initial&&![...records.current.values()].some(e=>e.uncertain||e.receipt?.status==='pending'))return;
   initial=false;reading=true;
   try{
    const ids=[...records.current.keys()],history=await readExpeditionReceipts(slug,villageId),specific=ids.length?await readExpeditionReceipts(slug,villageId,ids.slice(0,64)):[];
    if(cancelled)return;for(const receipt of [...history,...specific])receive(receipt);
    const known=new Set(specific.map(r=>r.commandId));
    for(const [id,item]of records.current)if(item.uncertain&&item.intent&&!known.has(id))await send(item.intent);
   }catch(error){if(!cancelled&&error instanceof ApiError&&error.status===401){records.current.clear();publish();}}
   finally{reading=false;}
  };
  void recover();const timer=setInterval(()=>void recover(),3000);
  return()=>{cancelled=true;clearInterval(timer);};
 },[scope,enabled,key,slug,villageId,publish,receive,send]);
 return{entries,receive,submit:(command:Extract<ScienceCommand,{action:'survey'|'explore'}>)=>{
  if(!active.current||[...records.current.values()].filter(e=>e.uncertain||e.receipt?.status==='pending'||!e.receipt&&e.intent&&!e.message).length>=4)return;
  void send({...command,commandId:randomUUID()});
 }};
}
