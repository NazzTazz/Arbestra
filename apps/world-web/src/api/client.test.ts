import { afterEach, expect, it, vi } from 'vitest';
import { discoverOrRefreshSupplies, harvestGarden } from './client';
import { getStoneDepositDetails, startStoneExtraction } from './client';

afterEach(() => vi.unstubAllGlobals());

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
