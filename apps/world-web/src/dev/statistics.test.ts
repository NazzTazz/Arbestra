import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_TIMING_HEADER, parseDevServerTiming } from '@arbestra/contracts';
import { clientTime, FrameTimings, recordFrame, recordRenderMetrics, recordGpuTiming, requestKind, setStatisticsEnabled, statisticsEnabled, statisticsSnapshot, timedFetch, timedJson } from './statistics';

describe('development statistics transport', () => {
  beforeEach(() => { vi.stubEnv('DEV', true); setStatisticsEnabled(false); });
  afterEach(() => { setStatisticsEnabled(false); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('keeps CPU counters separate by scene and GPU samples fresh, nullable, bounded and disabled in production', () => {
    setStatisticsEnabled(true); vi.stubGlobal('document', { hidden: false });
    let now = 100; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const values = { activeMeshesMs: 10, submissionMs: 20, particlesMs: 2, renderTargetsMs: 0, shaderMs: 0, drawCalls: 12, activeMeshes: 14, residentMeshes: 100 };
    recordGpuTiming(false); expect(statisticsSnapshot().rendering.gpu).toMatchObject({ supported: false, count: 0, meanMs: null });
    recordRenderMetrics('village', values); recordRenderMetrics('world', { ...values, activeMeshesMs: 4 });
    expect(statisticsSnapshot().rendering.metrics[0]?.mean).toBe(4);
    recordGpuTiming(true, 10_000_000); recordGpuTiming(true, -1); recordGpuTiming(true, NaN); recordGpuTiming(true);
    expect(statisticsSnapshot().rendering.gpu).toMatchObject({ count: 1, meanMs: 10 });
    now += 2001; expect(statisticsSnapshot().rendering.gpu.meanMs).toBeNull();
    expect(statisticsSnapshot().rendering.metrics[0]?.mean).toBeNull();
    for (let i = 0; i < 150; i++) { recordRenderMetrics('village', values); recordGpuTiming(true, 1); }
    expect(statisticsSnapshot().rendering.count).toBe(120); expect(statisticsSnapshot().rendering.gpu.count).toBe(120);
    vi.stubEnv('DEV', false); setStatisticsEnabled(true);
    recordRenderMetrics('village', values); recordGpuTiming(true, 1);
    expect(statisticsSnapshot().rendering.count).toBe(0); expect(statisticsSnapshot().rendering.gpu.count).toBe(0);
  });

  it('leaves disabled requests and production untouched, including credentials and headers', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', fetch);
    const init = { credentials: 'same-origin' as const, headers: { existing: 'retained' } };
    await timedFetch('/api/worlds/private/village', init);
    expect(fetch).toHaveBeenLastCalledWith('/api/worlds/private/village', init);
    vi.stubEnv('DEV', false); setStatisticsEnabled(true); expect(statisticsEnabled()).toBe(false);
    await timedFetch('/api/worlds/private/terrain?chunks=0,0', init);
    expect(fetch).toHaveBeenLastCalledWith('/api/worlds/private/terrain?chunks=0,0', init);
    expect(statisticsSnapshot().requests.size).toBe(0);
  });

  it('measures the selected reads, preserving signal, parsed payload and server reference', async () => {
    setStatisticsEnabled(true);
    const signal = new AbortController().signal;
    const id = '10000000-0000-4000-8000-000000000001';
    const response = new Response(JSON.stringify({ ok: 42 }), { headers: {
      'server-timing': 'arb_rc1_parse;dur=12;desc="1", arb_rc1_parse_self;dur=10;desc="1"', 'x-request-id': id,
    } });
    const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', fetch);
    const result = await timedFetch('/api/worlds/private/terrain?chunks=1,2', { signal, credentials: 'same-origin', headers: { existing: 'kept' } });
    const sent = fetch.mock.calls[0]![1] as RequestInit;
    expect(sent.signal).toBe(signal); expect(sent.credentials).toBe('same-origin');
    expect((sent.headers as Headers).get(DEV_TIMING_HEADER)).toBe('1'); expect((sent.headers as Headers).get('existing')).toBe('kept');
    expect(await timedJson(result)).toEqual({ ok: 42 });
    const row = statisticsSnapshot().requests.get('terrain')!.latest;
    expect(row.state).toBe('complete'); expect(row.requestId).toBe(id); expect(row.status).toBe(200);
    expect(row.server[0]?.phase).toBe('rc1_parse'); expect(row.totalMs).toBeGreaterThanOrEqual(row.parseMs!);
    expect(JSON.stringify(row)).not.toMatch(/private|chunks=|kept/);
  });

  it('keeps concurrent request observations separate and the first sample bounded', async () => {
    setStatisticsEnabled(true);
    let resolveFirst!: (r: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve; }))
      .mockImplementation(() => Promise.resolve(new Response('{"n":2}')));
    vi.stubGlobal('fetch', fetch);
    const first = timedFetch('/api/worlds/a/village'); const second = await timedFetch('/api/worlds/b/village');
    await timedJson(second); resolveFirst(new Response('{"n":1}')); await timedJson(await first);
    let data = statisticsSnapshot(); expect(data.requests.get('village')!.first).not.toBe(data.requests.get('village')!.latest);
    const original = data.requests.get('village')!.first;
    for (let i=0;i<40;i++) await timedJson(await timedFetch('/api/worlds/a/village'));
    data = statisticsSnapshot(); expect(data.requests.size).toBe(1); expect(data.requests.get('village')!.first).toBe(original);
    expect(data.requests.get('village')!.latest.state).toBe('complete');
  });

  it('records failure and JSON errors without replacing the original exception', async () => {
    setStatisticsEnabled(true); const sentinel = Error('private transport error');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(sentinel).mockResolvedValueOnce(new Response('broken')));
    await expect(timedFetch('/api/worlds/a/village')).rejects.toBe(sentinel);
    expect(statisticsSnapshot().requests.get('village')!.latest.state).toBe('error');
    await expect(timedJson(await timedFetch('/api/worlds/a/terrain'))).rejects.toBeInstanceOf(SyntaxError);
    expect(statisticsSnapshot().requests.get('terrain')!.latest.state).toBe('error');
    expect(JSON.stringify(statisticsSnapshot().requests.get('village'))).not.toContain('private transport');
  });

  it('never instruments mutations, unrelated routes or creates a refresh request', async () => {
    setStatisticsEnabled(true); const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}'))); vi.stubGlobal('fetch', fetch);
    const init = { method: 'POST', headers: { 'content-type':'application/json' }, body: '{}' };
    await timedFetch('/api/worlds/a/starter', init); expect(fetch).toHaveBeenLastCalledWith('/api/worlds/a/starter', init);
    await timedFetch('/api/admin/infrastructure'); expect(statisticsSnapshot().requests.size).toBe(0);
    statisticsSnapshot(); statisticsSnapshot(); expect(fetch).toHaveBeenCalledTimes(2);
    expect(requestKind('/api/worlds/a/starter/terrain?chunks=0,0')).toBe('preparation');
    expect(requestKind('https://elsewhere.test/api/worlds/a/village')).toBeNull();
  });

  it('clears observations on disabling and preserves synchronous application results', () => {
    setStatisticsEnabled(true); const value = { value: 1 };
    expect(clientTime('apply', () => value)).toBe(value);
    const sentinel = Error('exact'); expect(() => clientTime('scene', () => { throw sentinel; })).toThrow(sentinel);
    expect(statisticsSnapshot().clientCosts.get('scene')?.count).toBe(1);
    setStatisticsEnabled(false); expect(statisticsSnapshot().clientCosts.size).toBe(0);
  });

  it('rejects malformed, impossible, unknown and oversized server metrics', () => {
    expect(parseDevServerTiming('arb_sql;dur=2;desc="1", arb_sql_self;dur=4;desc="1"')).toEqual([]);
    expect(parseDevServerTiming('arb_private;dur=1;desc="1", arb_private_self;dur=1;desc="1"')).toEqual([]);
    expect(parseDevServerTiming('x'.repeat(12_001))).toEqual([]);
    expect(parseDevServerTiming(null)).toEqual([]);
  });

  it('partitions frame phases without overlap and averages skipped work over all completed frames', () => {
    setStatisticsEnabled(true); vi.stubGlobal('document', { hidden: false });
    let now = 100; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const first = new FrameTimings(now);
    now = 110; first.mark('demand'); now = 130; first.mark('roadsManual');
    now = 135; first.mark('demand'); now = 150; first.mark('render');
    recordFrame(100, 15, 150, first.costs);
    now = 180; const second = new FrameTimings(now);
    now = 185; second.mark('demand'); now = 200; second.mark('render');
    recordFrame(180, 15, 200, second.costs);
    const frame = statisticsSnapshot().frame;
    expect(frame.count).toBe(2); expect(frame.fps).toBe(12.5);
    expect(frame.totalMs).toBe(35); expect(frame.maxMs).toBe(50);
    expect(frame.phases.find(p => p.phase === 'roadsManual')).toMatchObject({ meanMs: 10, maxMs: 20 });
    expect(frame.phases.find(p => p.phase === 'demand')).toMatchObject({ meanMs: 10, maxMs: 15 });
    expect(frame.phases.reduce((sum, p) => sum + p.meanMs, 0)).toBe(frame.totalMs);
  });

  it('retains a just-completed long stall, expires it and bounds frames while ignoring hidden/disabled work', () => {
    setStatisticsEnabled(true); vi.stubGlobal('document', { hidden: false });
    let now = 18_000; vi.spyOn(performance, 'now').mockImplementation(() => now);
    recordFrame(0, 50, now, { roadsManual: 17_950, render: 50 });
    expect(statisticsSnapshot().frame.maxMs).toBe(18_000);
    now += 2001; expect(statisticsSnapshot().frame.phases).toEqual([]); expect(statisticsSnapshot().frame.totalMs).toBeNull();
    for (let i = 0; i < 150; i++) { now++; recordFrame(now - 1, 0, now, { demand: 1 }); }
    expect(statisticsSnapshot().frame.count).toBe(120);
    setStatisticsEnabled(false); recordFrame(now - 1, 0, now);
    expect(statisticsSnapshot().frame.count).toBe(0);
    setStatisticsEnabled(true); vi.stubGlobal('document', { hidden: true }); recordFrame(now - 1, 0, now);
    expect(statisticsSnapshot().frame.count).toBe(0);
  });
});
