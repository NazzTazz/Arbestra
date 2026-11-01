import { afterEach, expect, it, vi } from 'vitest';
import { getStoneDepositDetails, setFactoryEnabled } from './client';

afterEach(() => vi.unstubAllGlobals());

it('preserves the server refusal code for the deposit menu', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'DEPOSIT_FULLY_COMMITTED', message: 'Engagé' }), { status: 409 }),
      ),
  );
  await expect(getStoneDepositDetails('aube', 'village', 'target')).rejects.toMatchObject({
    status: 409,
    code: 'DEPOSIT_FULLY_COMMITTED',
  });
});

it('switches the workshop access with one write and reads no village back', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true, canConfigure: true })));
  vi.stubGlobal('fetch', fetchMock);
  await expect(setFactoryEnabled('aube', true)).resolves.toBeUndefined();
  // The V2 streams carry the new access: the legacy snapshot read is gone.
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]![0]).toBe('/api/worlds/aube/dev/factory-access');
  expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ enabled: true }) });
});

it('reports a refused workshop switch instead of ignoring it', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'DEV_ONLY', message: 'Réglage disponible uniquement en développement.' }), {
        status: 404,
      }),
    ),
  );
  await expect(setFactoryEnabled('aube', false)).rejects.toMatchObject({ status: 404, code: 'DEV_ONLY' });
});
