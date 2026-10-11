import { afterEach, expect, it, vi } from 'vitest';
import { discoverOrRefreshSupplies, harvestGarden } from './client';
import { getStoneDepositDetails, startStoneExtraction } from './client';
import {buildBuilding} from './client';

afterEach(() => vi.unstubAllGlobals());

it('bounds construction waiting and retransmits the same id after an uncertain timeout',async()=>{
 const controller=new AbortController(),deadline=vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);
 const fetchMock=vi.fn().mockImplementationOnce((_url,init:RequestInit)=>new Promise((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(init.signal!.reason))));
 vi.stubGlobal('fetch',fetchMock);
 try{
  const pending=buildBuilding('rc1','village','university',{cellX:1,cellY:2},[],'same-command');
  controller.abort(new DOMException('Response deadline','TimeoutError'));
  await expect(pending).rejects.toMatchObject({name:'TimeoutError'});expect(deadline).toHaveBeenCalledWith(15000);
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({serverTime:'2026-10-10T20:00:00Z'})));
  await buildBuilding('rc1','village','university',{cellX:1,cellY:2},[],'same-command');
  expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
 }finally{deadline.mockRestore();}
});

it('refreshes the village after another tab claimed the supplies, without repeating the claim', async () => {
  const snapshot = { serverTime: '2026-09-06T18:00:00Z', village: { carrots: 2050 } };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'SUPPLIES_ALREADY_DISCOVERED' }), { status: 409 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(snapshot)));
  vi.stubGlobal('fetch', fetchMock);
  const result = await discoverOrRefreshSupplies('aube', 'village', 'hall');
  expect(result).toMatchObject({ alreadyDiscovered: true, snapshot: { state: snapshot } });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1]).toEqual(['/api/worlds/aube/village', { credentials: 'same-origin' }]);
});

it('sends the harvest command as JSON and preserves its id for a retry', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ serverTime: new Date().toISOString() }),
    { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  const commandId = crypto.randomUUID();
  await harvestGarden('aube', 'village', 'garden', 12, 34, commandId);
  expect(fetchMock).toHaveBeenCalledWith('/api/worlds/aube/villages/village/buildings/garden/harvest',
    expect.objectContaining({ method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId, cellX: 12, cellY: 34 }) }));
});

it('E: sends one explicit extraction intention across retries and returns its off-screen target', async () => {
  const result = { villageState: { serverTime: '2026-09-05T00:00:00Z' }, extraction: { id: 'work' }, deposit: { featureId: 'target' } };
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(result))));
  vi.stubGlobal('fetch', fetchMock);
  const commandId = crypto.randomUUID();
  const first = await startStoneExtraction('aube', 'village', 'target', 2, commandId);
  await startStoneExtraction('aube', 'village', 'target', 2, commandId);
  expect(first).toMatchObject(result);
  for (const call of fetchMock.mock.calls) expect(call).toEqual(['/api/worlds/aube/villages/village/features/target/extractions',
    expect.objectContaining({ credentials:'same-origin',method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commandId,workerCount:2}) })]);
});

it('preserves the server refusal code for the deposit menu', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({code:'DEPOSIT_FULLY_COMMITTED',message:'Engagé'}),{status:409})));
  await expect(getStoneDepositDetails('aube','village','target')).rejects.toMatchObject({status:409,code:'DEPOSIT_FULLY_COMMITTED'});
});

const syncFixture=async()=>JSON.parse((await import('node:fs')).readFileSync(new URL('../../../../tests/fixtures/village-sync-state.json',import.meta.url),'utf8'));
it('requests and parses an authoritative construction frame without changing the command payload',async()=>{
 const {villageFrame}=await import('@arbestra/contracts'),state=await syncFixture(),frame=villageFrame(state,{...state,syncRevision:2,village:{...state.village,wood:75}});
 const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({kind:'frame',commandTime:state.serverTime,serverTime:state.serverTime,frame})));vi.stubGlobal('fetch',fetchMock);
 const base={revision:state.syncRevision,serverTime:state.serverTime};
 const reply=await buildBuilding(state.world.slug,state.village.id,'dwelling',{cellX:66,cellY:64},[{cellX:66,cellY:64}],'same-command',[],0,'logs',base);
 expect(reply).toMatchObject({frame});expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({'x-village-sync':'1','x-village-revision':'1','x-village-server-time':state.serverTime});
 const body=fetchMock.mock.calls[0]![1].body;
 fetchMock.mockResolvedValue(new Response(JSON.stringify({kind:'snapshot',commandTime:state.serverTime,serverTime:state.serverTime,state})));
 expect(await buildBuilding(state.world.slug,state.village.id,'dwelling',{cellX:66,cellY:64},[{cellX:66,cellY:64}],'same-command',[],0,'logs',{...base,revision:2})).toMatchObject({state});
 expect(fetchMock.mock.calls[1]![1].body).toBe(body);
});
it('rejects a malformed incremental response as uncertain rather than accepting a partial village',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({kind:'frame',frame:{toRevision:2}}))));
 await expect(buildBuilding('rc1','village','dwelling',{cellX:1,cellY:2},[],'same-command')).rejects.toThrow('Réponse de synchronisation invalide');
});
