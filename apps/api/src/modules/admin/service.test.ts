import { describe, expect, it } from 'vitest';
import type { AdminActivity } from '@arbestra/contracts';
import { AdminReadCache, diagnoseActivity } from './service.js';

describe('NOC read cache', () => {
  it('shares one load, expires the timestamped result and retries failures', async () => {
    let now = 0, calls = 0;
    const cache = new AdminReadCache(() => now, 15_000);
    let release!: (result: number) => void;
    const load = () => { calls++; return new Promise<number>(resolve => { release = resolve; }); };
    const first = cache.read('world', load), second = cache.read('world', load);
    await Promise.resolve();
    expect(calls).toBe(1);
    release(7);
    expect(await Promise.all([first, second])).toEqual([7, 7]);
    expect(await cache.read('world', async () => 9)).toBe(7);
    now = 15_001;
    expect(await cache.read('world', async () => 9)).toBe(9);
    await expect(cache.read('broken', async () => { throw Error('offline'); })).rejects.toThrow('offline');
    expect(await cache.read('broken', async () => 11)).toBe(11);
  });

  it('bounds independent SQL flights while allowing a matching in-flight reader', async () => {
    const cache = new AdminReadCache();
    const releases: Array<() => void> = [];
    const load = () => new Promise<void>(resolve => { releases.push(resolve); });
    const flights = Array.from({ length: 4 }, (_, i) => cache.read(String(i), load));
    await Promise.resolve();
    await expect(cache.read('fifth', async () => undefined)).rejects.toMatchObject({ code: 'ADMIN_BUSY' });
    const shared = cache.read('0', load);
    for (const release of releases) release();
    await Promise.all([...flights, shared]);
    expect(releases).toHaveLength(4);
  });
});

describe('NOC activity diagnosis', () => {
  const record: AdminActivity = {
    id: '10000000-0000-4000-8000-000000000001', kind: 'science',
    worldId: '10000000-0000-4000-8000-000000000002', villageId: null, accountId: null,
    label: 'research', status: 'in-progress', receiptStatus: null, startedAt: '2026-01-01T00:00:00.000Z',
    dueAt: '2026-01-01T01:00:00.000Z', completedAt: null, attempts: 0, errorCode: null, relatedActivityId: null,
  };
  it('distinguishes a due transition from a persisted completion without claiming a worker failure', () => {
    const due = diagnoseActivity(record, new Date('2026-01-01T02:00:00Z'));
    expect(due[0]).toMatchObject({ status: 'attention', code: 'DEADLINE_PASSED' });
    expect(due[0]!.message).toContain('réconciliation');
    expect(diagnoseActivity({ ...record, status: 'completed', completedAt: record.dueAt }, new Date())[0])
      .toMatchObject({ status: 'ok', code: 'COMPLETED' });
  });
  it('reports a missing admitted activity as unknown, never as a successful preparation', () => {
    expect(diagnoseActivity({ ...record, kind: 'expedition', status: 'admitted', dueAt: null }, new Date())[0])
      .toMatchObject({ status: 'unknown', code: 'ACTIVITY_NOT_FOUND' });
  });
});
