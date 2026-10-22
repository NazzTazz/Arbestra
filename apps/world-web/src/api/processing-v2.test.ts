import {expect,it} from 'vitest';
import {applySyncV2Batch,SYNC_V2_PRIVATE_COMPONENTS,type ProcessingOrder,type SyncV2State} from '@arbestra/contracts';
import {processingCommandBuilding,processingOrdersV2} from './processing-v2';

const worldId='11111111-1111-4111-8111-111111111111',villageId='22222222-2222-4222-8222-222222222222';
const epoch='33333333-3333-4333-8333-333333333333',building='44444444-4444-4444-8444-444444444444';
const order=(id:string,createdAt:string,status:ProcessingOrder['status']):ProcessingOrder=>({id,buildingId:building,status,
  blockedReason:null,requestedLots:2,completedLots:0,workerCount:1,createdAt,finishedAt:null,currentLot:null});
const older=order('55555555-5555-4555-8555-555555555555','2026-10-22T00:00:00.000Z','completed');
const newer=order('66666666-6666-4666-8666-666666666666','2026-10-22T00:05:00.000Z','running');

it('projects visible workshop orders newest first, with acknowledged effects over the base',()=>{
  const empty:SyncV2State={worldId,villageId,generation:1,scopes:new Map()};
  const snapshot=applySyncV2Batch(empty,{protocol:2,worldId,villageId,generation:1,observedAt:'2026-10-22T00:06:00Z',coverage:'scope-snapshot',
    groups:[{stream:{kind:'village',key:villageId,epoch},fromRevision:'0',toRevision:'3',changes:SYNC_V2_PRIVATE_COMPONENTS.map(component=>
      ({component,upsert:component==='processingOrders'?[older,newer]:[],remove:[]}))}]} as never);
  expect(snapshot.kind).toBe('applied');
  expect(processingOrdersV2(snapshot.state)).toEqual([newer,older]);
  const paused={...newer,status:'pause-requested' as const};
  const acknowledged=applySyncV2Batch(snapshot.state,{protocol:2,worldId,villageId,generation:1,observedAt:'2026-10-22T00:06:01Z',coverage:'effects',
    groups:[{stream:{kind:'village',key:villageId,epoch},fromRevision:'4',toRevision:'4',changes:[{component:'processingOrders',upsert:[paused],remove:[]}]}]});
  expect(acknowledged.kind).toBe('applied');
  const orders=processingOrdersV2(acknowledged.state);
  expect(orders).toEqual([paused,older]);
  expect(orders[1]).toBe(processingOrdersV2(snapshot.state)[1]);
  expect(processingOrdersV2(empty)).toEqual([]);
});

it('locates the workshop of a command through its order',()=>{
  expect(processingCommandBuilding({commandId:epoch,action:'start',buildingId:building,durationSeconds:3600,workerCount:1},[])).toBe(building);
  expect(processingCommandBuilding({commandId:epoch,action:'pause',orderId:newer.id},[older,newer])).toBe(building);
  expect(processingCommandBuilding({commandId:epoch,action:'pause',orderId:epoch},[older])).toBeNull();
});
