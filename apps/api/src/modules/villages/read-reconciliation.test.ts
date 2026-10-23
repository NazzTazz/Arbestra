import { expect, it, vi } from 'vitest';
import { VillageReadReconciliations } from './read-reconciliation.js';
import type { VillageEconomy } from './reconcile-economy.js';

const result: VillageEconomy = { worldId: 'world', villageId: 'village', through: new Date(0) };
function gate() {
  let release!: (value: VillageEconomy) => void;
  const promise = new Promise<VillageEconomy>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it('shares a pending read-side commit and starts a fresh wakeup after settlement', async () => {
  const held = gate(),
    load = vi.fn(() => held.promise),
    reads = new VillageReadReconciliations(load);
  const first = reads.run('owner', 'slug', 'world', 'village');
  const second = reads.run('owner', 'slug', 'world', 'village');
  expect(first).toBe(second);
  expect(load).toHaveBeenCalledOnce();
  held.release(result);
  expect(await first).toEqual(result);
  await second;
  await reads.run('owner', 'slug', 'world', 'village');
  expect(load).toHaveBeenCalledTimes(2);
});

it('does not share between owners, worlds or villages', async () => {
  const held = gate(),
    load = vi.fn(() => held.promise),
    reads = new VillageReadReconciliations(load);
  const jobs = [
    reads.run('a', 'slug', 'w', 'v'),
    reads.run('b', 'slug', 'w', 'v'),
    reads.run('a', 'slug', 'other-world', 'v'),
    reads.run('a', 'slug', 'w', 'other-village'),
  ];
  expect(load).toHaveBeenCalledTimes(4);
  held.release(result);
  await Promise.all(jobs);
});

it('propagates the same failure to waiters and permits a subsequent retry', async () => {
  const failure = Error('expected reconciliation failure');
  const load = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(result);
  const reads = new VillageReadReconciliations(load);
  const outcomes = await Promise.allSettled([reads.run('a', 'slug', 'w', 'v'), reads.run('a', 'slug', 'w', 'v')]);
  expect(outcomes).toEqual([
    { status: 'rejected', reason: failure },
    { status: 'rejected', reason: failure },
  ]);
  expect(load).toHaveBeenCalledOnce();
  expect(await reads.run('a', 'slug', 'w', 'v')).toEqual(result);
  expect(load).toHaveBeenCalledTimes(2);
});
