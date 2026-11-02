import { afterEach, expect, it, vi } from 'vitest';
import { readLastSeenRelease, sendSeenRelease } from './release-notes';

afterEach(() => vi.unstubAllGlobals());

it('reads the last seen version from the session the lobby already reads', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ account: { id: 'a', email: 'a@b.c', lastSeenRelease: 'alpha-2026.11.01.1' } })),
    );
  vi.stubGlobal('fetch', fetchMock);
  await expect(readLastSeenRelease()).resolves.toBe('alpha-2026.11.01.1');
  expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/session');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ account: { lastSeenRelease: null } }))),
  );
  await expect(readLastSeenRelease()).resolves.toBeNull();
});

it('rejects an expired session instead of inventing a version', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
  await expect(readLastSeenRelease()).rejects.toThrow('Session 401');
});

it('sends the version seen with one write and returns what the server keeps', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ lastSeenRelease: 'alpha-2026.11.02.1' })));
  vi.stubGlobal('fetch', fetchMock);
  await expect(sendSeenRelease('alpha-2026.11.02.1')).resolves.toBe('alpha-2026.11.02.1');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]![0]).toBe('/api/account/seen-release');
  expect(fetchMock.mock.calls[0]![1]).toMatchObject({
    method: 'POST',
    body: JSON.stringify({ releaseId: 'alpha-2026.11.02.1' }),
  });
});

it('reports a refused acknowledgement', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));
  await expect(sendSeenRelease('alpha-2026.11.02.1')).rejects.toThrow('Seen release 400');
});
