import {expect, it} from 'vitest';
import {SharedCalculation} from './shared-calculation.js';

it('shares one pending calculation between ten callers and releases it after failure or success', async () => {
  const shared = new SharedCalculation<number>(); let release!: () => void, calls = 0;
  const gate = new Promise<void>(r => {release = r;});
  const run = async () => {calls++; await gate; return 7;};
  const requests = Array.from({length: 10}, () => shared.run('pair', run));
  await Promise.resolve(); expect(calls).toBe(1); release();
  expect(await Promise.all(requests)).toEqual(Array(10).fill(7));
  const injected = new Error('calculation-failed');
  await expect(shared.run('pair', async () => {throw injected;})).rejects.toBe(injected);
  expect(await shared.run('pair', async () => 9)).toBe(9);
});

it('bounds distinct keys and waiters without starting rejected work', async () => {
  const shared = new SharedCalculation<number>(1, 2); let release!: () => void;
  const gate = new Promise<number>(r => {release = () => r(1);});
  const first = shared.run('a', () => gate), second = shared.run('a', () => gate);
  try {
    await expect(shared.run('a', async () => {throw Error('must not start');})).rejects.toThrow('waiters saturated');
    await expect(shared.run('b', async () => {throw Error('must not start');})).rejects.toThrow('calculations saturated');
  } finally {release(); await Promise.all([first, second]);}
});
