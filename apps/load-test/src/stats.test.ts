import { describe, expect, it } from 'vitest';
import {
  classifyStatus,
  distribution,
  percentile,
  serverTimingPhases,
  summarizeWindow,
  type RequestEvent,
} from './stats.js';
import { requestKind } from './http.js';
import { botEmail, botIndex, botName, isBotEmail } from './bots.js';
import { stopReason, DEFAULT_THRESHOLDS } from './stop.js';
import { firstSaturation, saturations, summarizeSamples, type StageResult } from './report.js';

describe('percentiles', () => {
  it('uses the nearest rank, as the NOC telemetry', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 0.5)).toBe(50);
    expect(percentile(sorted, 0.95)).toBe(95);
    expect(percentile(sorted, 0.99)).toBe(99);
    expect(percentile([7], 0.99)).toBe(7);
    expect(percentile([1, 2, 3], 1)).toBe(3);
  });
  it('summarizes unsorted values and ignores non-finite ones', () => {
    expect(distribution([30, 10, 20, Number.NaN, 40])).toEqual({
      count: 4,
      min: 10,
      p50: 20,
      p95: 40,
      p99: 40,
      max: 40,
      mean: 25,
    });
    expect(distribution([])).toBeNull();
  });
});

describe('outcomes and kinds', () => {
  it('counts business refusals apart from errors', () => {
    expect([200, 204, 304].map(classifyStatus)).toEqual(['ok', 'ok', 'ok']);
    expect([409, 422].map(classifyStatus)).toEqual(['refused', 'refused']);
    expect([0, 400, 401, 429, 500, 503].map(classifyStatus)).toEqual(Array(6).fill('error'));
  });
  it('names each request of the client by its route and body', () => {
    const v = '/api/worlds/charge/villages/7b969e10-c2c0-4fb0-be4c-012ccfdc543c';
    expect(requestKind('GET', '/api/worlds/charge/village/bootstrap?generation=1&include=knowledge')).toBe('bootstrap');
    expect(requestKind('POST', v + '/sync/stream')).toBe('sse-open');
    expect(requestKind('POST', v + '/buildings/0b2c3d4e-0000-4000-8000-000000000000/upgrade')).toBe('upgrade');
    expect(requestKind('POST', v + '/buildings')).toBe('build');
    expect(requestKind('POST', v + '/terrain-edits', '{"gestures":[{"buildingType":"terrain-restore"}]}')).toBe(
      'terrain-restore',
    );
    expect(requestKind('POST', v + '/terrain-edits', '{"gestures":[{"buildingType":"terrain"}]}')).toBe('terraform');
    expect(requestKind('POST', v + '/market/trades', '{"action":"cancel","commandId":"x"}')).toBe('market-cancel');
    expect(requestKind('GET', '/api/worlds/charge/terrain?chunks=1%2C2')).toBe('terrain');
    expect(requestKind('DELETE', v + '/unknown')).toBe('delete:/api/worlds/charge/villages/:id/unknown');
  });
  it('reads the inclusive Server-Timing phases it keeps', () => {
    expect(
      serverTimingPhases(
        'arb_pool;dur=12.5;desc="2", arb_pool_self;dur=12.5;desc="2", arb_navigation;dur=300;desc="1", arbsql_1;dur=9;desc="x"',
      ),
    ).toEqual({ pool: 12.5, navigation: 300 });
    expect(serverTimingPhases(null)).toBeUndefined();
  });
});

describe('bot identity', () => {
  it('marks bots by an exact e-mail pattern', () => {
    expect(botEmail(7)).toBe('bot-007@load.arbestra.test');
    expect(botName(42)).toBe('Bot 042');
    expect(botIndex('bot-1234@load.arbestra.test')).toBe(1234);
    expect(isBotEmail('bot-007@load.arbestra.test.evil')).toBe(false);
    expect(isBotEmail('player@arbestra.local')).toBe(false);
    expect(isBotEmail('xbot-007@load.arbestra.test')).toBe(false);
    expect(() => botEmail(0)).toThrow();
  });
});

const event = (t: number, kind: string, ms: number, status = 200, phases?: RequestEvent['phases']): RequestEvent => ({
  t,
  kind,
  ms,
  status,
  outcome: classifyStatus(status),
  ...(phases ? { phases } : {}),
});

describe('window summaries and stops', () => {
  const events = [
    ...Array.from({ length: 18 }, (_, i) => event(1000 + i, 'harvest', 100 + i)),
    event(1100, 'harvest', 9000, 500),
    event(1101, 'build', 50, 409),
    event(1102, 'presentation', 800),
    event(5000, 'harvest', 1),
  ];
  it('separates commands, refusals, errors and reads inside the window', () => {
    const s = summarizeWindow(events, [{ t: 1050, kind: 'harvest', ms: 40 }], 1000, 2000);
    expect(s.commands).toMatchObject({ count: 20, ok: 18, refused: 1, errors: 1, errorRate: 5 });
    expect(s.reads.count).toBe(1);
    expect(s.byKind.harvest!.statuses).toEqual({ '200': 18, '500': 1 });
    expect(s.byKind.build!.refused).toBe(1);
    expect(s.effects.harvest!.p50).toBe(40);
  });
  it('stops on the command p95, the error rate or a degraded health', () => {
    const window = summarizeWindow(events, [], 1000, 2000);
    const healthy = { p95Ms: 20, consecutiveFailures: 0 };
    expect(stopReason(window, healthy, { ...DEFAULT_THRESHOLDS, maxP95Ms: 100, minCommands: 5 })).toMatch(
      /p95 des commandes 117 ms/,
    );
    expect(
      stopReason(window, healthy, { ...DEFAULT_THRESHOLDS, maxP95Ms: 10_000, maxErrorRate: 4, minCommands: 5 }),
    ).toMatch(/taux d'erreur/);
    expect(stopReason(window, healthy, { ...DEFAULT_THRESHOLDS, maxP95Ms: 10_000, minCommands: 5 })).toBeNull();
    // Too few commands to judge latency or errors.
    expect(stopReason(window, healthy, { ...DEFAULT_THRESHOLDS, maxP95Ms: 1, minCommands: 50 })).toBeNull();
    expect(stopReason(window, { p95Ms: null, consecutiveFailures: 3 }, DEFAULT_THRESHOLDS)).toMatch(
      /échecs consécutifs/,
    );
    expect(stopReason(window, { p95Ms: 2500, consecutiveFailures: 0 }, DEFAULT_THRESHOLDS)).toMatch(/health p95 2500/);
  });
});

describe('first saturated resource', () => {
  const stage = (
    label: string,
    bots: number,
    phases: RequestEvent['phases'],
    db: { active: number; lockWaiting: number; oldestDueS: number },
  ): StageResult => {
    const requests = Array.from({ length: 10 }, (_, i) => event(1000 + i, 'build', 100, 200, phases));
    const sample = {
      at: 1500,
      health: { ok: true, ms: 10 },
      db: {
        connections: 10,
        active: db.active,
        lockWaiting: db.lockWaiting,
        longestTransactionS: 1,
        longestQueryS: 0.5,
        waits: [{ type: 'Lock', event: 'advisory', count: db.lockWaiting }],
        locksWaiting: db.lockWaiting,
        advisoryWaiting: db.lockWaiting,
        oldestDueS: db.oldestDueS,
        tasksDue: 3,
        harvestPending: 0,
        oldestHarvestPendingS: 0,
        commitsPerS: 50,
        deadlocks: 0,
      },
    };
    return {
      label,
      bots,
      from: 1000,
      to: 2000,
      summary: summarizeWindow(requests, [], 1000, 2000),
      server: summarizeSamples([sample], 1000, 2000),
      client: { eventLoopP99MaxMs: 20, streamReconnects: 0, effectsMissed: 0, failures: 0 },
    };
  };
  it('is the largest overrun of the earliest stage that crosses a threshold', () => {
    const calm = stage('10', 10, { pool: 2, village_lock: 5 }, { active: 2, lockWaiting: 0, oldestDueS: 0.2 });
    const busy = stage('30', 30, { pool: 450, village_lock: 600 }, { active: 8, lockWaiting: 4, oldestDueS: 30 });
    expect(saturations(calm)).toEqual([]);
    const hits = saturations(busy);
    expect(hits.map((h) => h.resource)).toEqual([
      "pool PostgreSQL de l'API (8 connexions)",
      'worker économique (scheduler)',
      'verrous PostgreSQL (attentes simultanées)',
      'verrou village (PostgreSQL)',
    ]);
    expect(firstSaturation([calm, busy])).toMatchObject({
      stage: '30',
      bots: 30,
      resource: "pool PostgreSQL de l'API (8 connexions)",
      ratio: 4.5,
      evidence: 'attente de connexion p95 450 ms (build), connexions actives max 8',
    });
    expect(firstSaturation([calm])).toBeNull();
  });
});
