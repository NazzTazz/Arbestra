import {expect,it} from 'vitest';
import {SYNC_V2_PRIVATE_COMPONENTS,SYNC_V2_KNOWLEDGE_COMPONENTS,type SyncV2Batch} from '@arbestra/contracts';
import {SyncV2Transport} from './sync-v2-transport';
const worldId='11111111-1111-4111-8111-111111111111',villageId='22222222-2222-4222-8222-222222222222';
const epoch='33333333-3333-4333-8333-333333333333',owner='44444444-4444-4444-8444-444444444444';
function memory():Storage{
  const rows=new Map<string,string>();return {get length(){return rows.size;},clear(){rows.clear();},key(index){return [...rows.keys()][index]??null;},
    getItem:key=>rows.get(key)??null,setItem:(key,value)=>{rows.set(key,value);},removeItem:key=>{rows.delete(key);}};
}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','retry-after':'2'}});
function bootstrap(generation:number):SyncV2Batch{return {protocol:2,worldId,villageId,generation,observedAt:'2026-10-22T00:00:00Z',coverage:'scope-snapshot',groups:[
  {stream:{kind:'village',key:villageId,epoch},fromRevision:'0',toRevision:'4',changes:SYNC_V2_PRIVATE_COMPONENTS.map(component=>({component,upsert:[],remove:[]}))},
  {stream:{kind:'knowledge',key:owner,epoch},fromRevision:'0',toRevision:'1',changes:SYNC_V2_KNOWLEDGE_COMPONENTS.map(component=>({component,upsert:[],remove:[]}))},
]};}
it('retains the identical UUID through catch-up and reload, persists no cursors and clears only an applied receipt',async()=>{
  const storage=memory(),posts:unknown[]=[],reads:unknown[]=[],sockets:RequestInit[]=[],published:unknown[]=[];
  let fail=true;
  const request:typeof fetch=async(url,init)=>{
    if(String(url).endsWith('/sync/stream')){
      sockets.push(init!);return new Response(new ReadableStream(),{headers:{'content-type':'text/event-stream'}});
    }
    const generation=Number(new Headers(init?.headers).get('x-arbestra-generation'));
    if(String(url).endsWith('/sync/read')){reads.push(JSON.parse(String(init?.body)));return json(bootstrap(generation));}
    const command=JSON.parse(String(init?.body));posts.push(command);
    if(fail)return json({code:'SCOPE_CATCHING_UP',message:'Rattrapage en cours'},503);
    return json({protocol:2,worldId,villageId,commandId:command.commandId,status:'applied',commandTime:'2026-10-22T00:00:01Z',result:{orderId:epoch}});
  };
  const options={storage,request,publish:(state:unknown)=>published.push(state),expired:()=>{throw Error('Unexpected expiration');}};
  const first=new SyncV2Transport('aube',worldId,villageId,options);
  const command={commandId:'55555555-5555-4555-8555-555555555555',action:'start' as const,buildingId:epoch,lots:2,workerCount:1};
  await first.start(true);
  await expect(first.processing(command)).rejects.toMatchObject({code:'SCOPE_CATCHING_UP',retryAfterMs:2000});
  expect(first.pending()).toEqual([command]);expect(storage.length).toBe(1);
  expect(storage.getItem(storage.key(0)!)).not.toMatch(/revision|cursor|epoch/);
  first.close();
  const second=new SyncV2Transport('aube',worldId,villageId,options);
  try{
    await second.start(true);expect(second.pending()).toEqual([command]);fail=false;
    await second.processing(second.pending()[0]!);
    expect(posts).toEqual([command,command]);expect(second.pending()).toEqual([]);expect(storage.length).toBe(0);
    expect(reads).toMatchObject([{cursors:[]},{cursors:[]}]);
    expect(sockets.every(socket=>new Headers(socket.headers).get('x-arbestra-protocol')==='2')).toBe(true);
    expect(published).toHaveLength(2);
  }finally{second.close();}
});
