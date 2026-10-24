import { afterEach, expect, it, vi } from 'vitest';
const getVillage = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ getVillage }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  getVillage.mockReset();
});
it('shares the early read with App and repeated development mounts', async () => {
  vi.stubGlobal('location', { href: 'http://localhost/village?world=another-world' });
  let release!: (value: unknown) => void;
  getVillage.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const { initialVillageRead } = await import('./initial-village');
  const early = initialVillageRead(),
    mounted = initialVillageRead(),
    remounted = initialVillageRead();
  expect(getVillage).toHaveBeenCalledExactlyOnceWith('another-world');
  expect(mounted).toBe(early);
  expect(remounted).toBe(early);
  const snapshot = { state: { world: { id: 'world' } }, serverOffsetMs: 0 };
  release(snapshot);
  expect(await mounted).toBe(snapshot);
});
it('keeps a failed early read observable by App without silently starting another request', async () => {
  vi.stubGlobal('location', { href: 'http://localhost/village?world=unavailable' });
  getVillage.mockRejectedValue(new Error('offline'));
  const { initialVillageRead } = await import('./initial-village');
  await expect(initialVillageRead()).rejects.toThrow('offline');
  await expect(initialVillageRead()).rejects.toThrow('offline');
  expect(getVillage).toHaveBeenCalledTimes(1);
});
