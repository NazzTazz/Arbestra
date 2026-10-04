import { expect, it, vi } from 'vitest';
import { BuildingThumbnailCache, THUMBNAIL_MAX_BYTES, THUMBNAIL_MAX_ENTRIES, THUMBNAIL_STORAGE_KEY } from './building-thumbnail-cache';

const png = 'data:image/png;base64,aW1hZ2U=';
const otherPng = 'data:image/png;base64,b3RoZXI=';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
  };
}

it('restores pixels after a page reload without invoking the renderer', async () => {
  const disk = storage();
  const render = vi.fn(async () => png);
  await new BuildingThumbnailCache('v1', render, () => disk).get('university', 3);

  const mustNotRender = vi.fn(async () => { throw new Error('unexpected render'); });
  const reloaded = new BuildingThumbnailCache('v1', mustNotRender, () => disk);
  expect(reloaded.peek('university', 3)).toBe(png);
  await expect(reloaded.get('university', 3)).resolves.toBe(png);
  expect(render).toHaveBeenCalledExactlyOnceWith('university', 3);
  expect(mustNotRender).not.toHaveBeenCalled();
});

it('regenerates a changed rendering revision and keeps building levels distinct', async () => {
  const disk = storage();
  await new BuildingThumbnailCache('v1', async () => png, () => disk).get('dwelling');
  const render = vi.fn(async () => otherPng);
  const changed = new BuildingThumbnailCache('v2', render, () => disk);
  expect(changed.peek('dwelling')).toBeUndefined();
  await expect(changed.get('dwelling')).resolves.toBe(otherPng);
  await changed.get('dwelling', 2);
  expect(render.mock.calls).toEqual([['dwelling', 1], ['dwelling', 2]]);
});

it('deduplicates pending images even when the queue exceeds the image limit', async () => {
  const gate = deferred<string>();
  const started = deferred<void>();
  let active = 0;
  let maxActive = 0;
  const render = vi.fn(async (_code: string, level: number) => {
    maxActive = Math.max(maxActive, ++active);
    if (level === 1) { started.resolve(); await gate.promise; }
    active--;
    return png;
  });
  const cache = new BuildingThumbnailCache('v1', render, storage);
  const requests = Array.from({ length: THUMBNAIL_MAX_ENTRIES + 2 }, (_, i) => cache.get('dwelling', i + 1));
  try {
    await started.promise;
    expect(cache.get('dwelling')).toBe(requests[0]);
    expect(render).toHaveBeenCalledTimes(1);
  } finally {
    gate.resolve(png);
    await Promise.all(requests);
  }
  expect(maxActive).toBe(1);
  expect(render).toHaveBeenCalledTimes(requests.length);
});

it('serves a stored image immediately while another image is being generated', async () => {
  const disk = storage();
  await new BuildingThumbnailCache('v1', async () => png, () => disk).get('dwelling');
  const gate = deferred<string>();
  const cache = new BuildingThumbnailCache('v1', () => gate.promise, () => disk);
  const cold = cache.get('university');
  try {
    const cached = cache.get('dwelling');
    const resolved = await Promise.race([cached, Promise.resolve('queued')]);
    expect(resolved).toBe(png);
  } finally { gate.resolve(otherPng); await cold; }
});

it.each(['corrupt', 'blocked', 'quota'] as const)('falls back to rendering and memory with %s storage', async problem => {
  const disk = storage();
  if (problem === 'corrupt') disk.setItem(THUMBNAIL_STORAGE_KEY, '{bad json');
  if (problem === 'quota') disk.setItem = () => { throw new Error('quota'); };
  const render = vi.fn(async () => png);
  const cache = new BuildingThumbnailCache('v1', render, () => {
    if (problem === 'blocked') throw new Error('access denied');
    return disk;
  });
  await expect(cache.get('dwelling')).resolves.toBe(png);
  await expect(cache.get('dwelling')).resolves.toBe(png);
  expect(render).toHaveBeenCalledTimes(1);
});

it('retries a failed render and continues rendering other recipes', async () => {
  const render = vi.fn().mockRejectedValueOnce(new Error('WebGL unavailable')).mockResolvedValue(png);
  const cache = new BuildingThumbnailCache('v1', render, storage);
  const failed = cache.get('dwelling');
  const next = cache.get('university');
  await expect(failed).rejects.toThrow('WebGL unavailable');
  await expect(next).resolves.toBe(png);
  await expect(cache.get('dwelling')).resolves.toBe(png);
  expect(render).toHaveBeenCalledTimes(3);
});

it('bounds image count using recency and persists the eviction', async () => {
  const disk = storage();
  const cache = new BuildingThumbnailCache('v1', async () => png, () => disk);
  for (let level = 1; level <= THUMBNAIL_MAX_ENTRIES; level++) await cache.get('dwelling', level);
  cache.peek('dwelling', 1);
  await cache.get('dwelling', THUMBNAIL_MAX_ENTRIES + 1);
  const reloaded = new BuildingThumbnailCache('v1', async () => png, () => disk);
  expect(reloaded.peek('dwelling', 1)).toBe(png);
  expect(reloaded.peek('dwelling', 2)).toBeUndefined();
  expect(reloaded.peek('dwelling', THUMBNAIL_MAX_ENTRIES + 1)).toBe(png);
  expect(JSON.parse(disk.getItem(THUMBNAIL_STORAGE_KEY)!).entries).toHaveLength(THUMBNAIL_MAX_ENTRIES);
});

it('bounds stored bytes without touching other application storage', async () => {
  const disk = storage();
  disk.setItem('player-preference', 'keep');
  const largePng = `data:image/png;base64,${'A'.repeat(THUMBNAIL_MAX_BYTES / 4)}`;
  const cache = new BuildingThumbnailCache('v1', async () => largePng, () => disk);
  await cache.get('dwelling');
  await cache.get('university');
  expect(cache.peek('dwelling')).toBeUndefined();
  expect(cache.peek('university')).toBe(largePng);
  expect(disk.getItem(THUMBNAIL_STORAGE_KEY)!.length * 2).toBeLessThanOrEqual(THUMBNAIL_MAX_BYTES);
  expect(disk.getItem('player-preference')).toBe('keep');
});
