import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { readServerEvents, type SyncV2Batch, type SyncV2ReadRequest } from '@arbestra/contracts';
import { serveSyncV2Stream } from './sync-v2-stream.js';
import { HttpError } from '../../errors.js';

it('sends cursor-only advances across scopes and terminates an expired real socket',async()=>{
  const worldId='11111111-1111-4111-8111-111111111111',villageId='22222222-2222-4222-8222-222222222222';
  const epoch='33333333-3333-4333-8333-333333333333';
  const initial:SyncV2ReadRequest={protocol:2,generation:1,scopes:[{kind:'village',key:villageId},{kind:'offers',key:'all'}],
    cursors:[{kind:'village',key:villageId,epoch,revision:'0'},{kind:'offers',key:'all',epoch,revision:'0'}]};
  const batch:SyncV2Batch={protocol:2,worldId,villageId,generation:1,observedAt:'2026-10-21T12:00:00Z',coverage:'delta',
    groups:initial.cursors.map(cursor=>({stream:{kind:cursor.kind,key:cursor.key,epoch},fromRevision:'0',toRevision:'1',changes:[]}))};
  const requests:SyncV2ReadRequest[]=[],events:string[]=[],errors:unknown[]=[];
  const expired=new HttpError(401,'SESSION_EXPIRED','Session expirée.');
  const app=Fastify(),abort=new AbortController();
  const timeout=setTimeout(()=>abort.abort(),10000);
  app.post('/stream',async(_request,reply)=>serveSyncV2Stream(reply,initial,async request=>{
    requests.push(request);if(requests.length>1)throw expired;return batch;
  },{pollMs:1,onError:error=>errors.push(error)}));
  try{
    const address=await app.listen({host:'127.0.0.1',port:0});
    const response=await fetch(address+'/stream',{method:'POST',signal:abort.signal});
    expect(response.status).toBe(200);
    await readServerEvents(response.body!,{signal:abort.signal,current:()=>!abort.signal.aborted,onEvent:event=>{
      events.push(event.event);if(event.event==='batch')expect(JSON.parse(event.data)).toEqual(batch);
    }});
    expect(events).toEqual(['batch','expired']);
    expect(requests[1]?.cursors.map(cursor=>cursor.revision)).toEqual(['1','1']);
    expect(requests[1]?.scopes).toEqual(initial.scopes);
    expect(errors).toEqual([expired]);
  }finally{clearTimeout(timeout);abort.abort();await app.close();}
},15000);
