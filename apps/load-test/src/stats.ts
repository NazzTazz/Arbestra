/** Pure aggregation of the bots' observations (docs/TEST-DE-CHARGE.md §4). */

export interface Distribution {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

/** Nearest rank, the convention of the NOC telemetry (operations/telemetry.ts). */
export function percentile(sorted: readonly number[], quantile: number): number {
  if (!sorted.length) throw new Error('No value');
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))]!;
}

const round = (value: number) => Math.round(value * 10) / 10;
export function distribution(values: readonly number[]): Distribution | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: round(sorted[0]!),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted.at(-1)!),
    mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

export type Outcome = 'ok' | 'refused' | 'error';
/** Business refusals (409 and 422: the server, or the Oracle, said no) are
 * counted apart from errors. 400 is a malformed bot request, 401 a lost
 * session, 429 the server's attempt limiter, 5xx and status 0 (network,
 * timeout) failures: all errors. */
export function classifyStatus(status: number): Outcome {
  if ((status >= 200 && status < 300) || status === 304) return 'ok';
  if (status === 409 || status === 422) return 'refused';
  return 'error';
}

/** What a bot does to the game; reads and the stream are reported apart. */
export const COMMAND_KINDS = new Set([
  'harvest',
  'hud-pool',
  'hud-population',
  'build',
  'upgrade',
  'terraform',
  'terrain-restore',
  'market-publish',
  'market-cancel',
  'market-accept',
  'expedition',
]);

/** Server-Timing phases kept per request (x-arbestra-dev-timing). */
export const KEPT_PHASES = [
  'request',
  'pool',
  'village_lock',
  'navigation_lock',
  'navigation_queue',
  'navigation',
  'reconcile',
  'snapshot',
  'sql',
] as const;
export type KeptPhase = (typeof KEPT_PHASES)[number];

export interface RequestEvent {
  /** Epoch milliseconds at the end of the request. */
  t: number;
  kind: string;
  outcome: Outcome;
  status: number;
  ms: number;
  code?: string;
  phases?: Partial<Record<KeptPhase, number>>;
}
export interface EffectEvent {
  t: number;
  kind: string;
  /** Delay between the HTTP confirmation and the stream batch carrying the effect. */
  ms: number;
}
export interface KindSummary {
  count: number;
  ok: number;
  refused: number;
  errors: number;
  statuses: Record<string, number>;
  codes: Record<string, number>;
  latencyMs: Distribution | null;
  /** p95 of each Server-Timing phase, milliseconds. */
  phasesP95: Partial<Record<KeptPhase, number>>;
}
export interface WindowSummary {
  from: number;
  to: number;
  requests: number;
  perSecond: number;
  commands: {
    count: number;
    ok: number;
    refused: number;
    errors: number;
    errorRate: number;
    latencyMs: Distribution | null;
  };
  reads: { count: number; errors: number; latencyMs: Distribution | null };
  byKind: Record<string, KindSummary>;
  effects: Record<string, Distribution | null>;
  effectsAll: Distribution | null;
}

const count = (map: Record<string, number>, key: string) => (map[key] = (map[key] ?? 0) + 1);

export function summarizeWindow(
  requests: readonly RequestEvent[],
  effects: readonly EffectEvent[],
  from: number,
  to: number,
): WindowSummary {
  const inside = requests.filter((e) => e.t >= from && e.t < to);
  const kinds = new Map<string, RequestEvent[]>();
  for (const event of inside) kinds.set(event.kind, [...(kinds.get(event.kind) ?? []), event]);
  const byKind: Record<string, KindSummary> = {};
  for (const [kind, events] of [...kinds].sort(([a], [b]) => a.localeCompare(b))) {
    const statuses: Record<string, number> = {},
      codes: Record<string, number> = {};
    for (const e of events) {
      count(statuses, String(e.status));
      if (e.code && e.outcome !== 'ok') count(codes, e.code);
    }
    const phasesP95: Partial<Record<KeptPhase, number>> = {};
    for (const phase of KEPT_PHASES) {
      const values = events.flatMap((e) => (e.phases?.[phase] === undefined ? [] : [e.phases[phase]!]));
      if (values.length) phasesP95[phase] = distribution(values)!.p95;
    }
    byKind[kind] = {
      count: events.length,
      ok: events.filter((e) => e.outcome === 'ok').length,
      refused: events.filter((e) => e.outcome === 'refused').length,
      errors: events.filter((e) => e.outcome === 'error').length,
      statuses,
      codes,
      latencyMs: distribution(events.map((e) => e.ms)),
      phasesP95,
    };
  }
  const commands = inside.filter((e) => COMMAND_KINDS.has(e.kind)),
    reads = inside.filter((e) => !COMMAND_KINDS.has(e.kind) && e.kind !== 'sse-open'),
    commandErrors = commands.filter((e) => e.outcome === 'error').length;
  const effectKinds = new Map<string, number[]>();
  const effectsInside = effects.filter((e) => e.t >= from && e.t < to);
  for (const e of effectsInside) effectKinds.set(e.kind, [...(effectKinds.get(e.kind) ?? []), e.ms]);
  const seconds = Math.max(0.001, (to - from) / 1000);
  return {
    from,
    to,
    requests: inside.length,
    perSecond: Math.round((inside.length / seconds) * 100) / 100,
    commands: {
      count: commands.length,
      ok: commands.filter((e) => e.outcome === 'ok').length,
      refused: commands.filter((e) => e.outcome === 'refused').length,
      errors: commandErrors,
      errorRate: commands.length ? Math.round((commandErrors / commands.length) * 10000) / 100 : 0,
      latencyMs: distribution(commands.map((e) => e.ms)),
    },
    reads: {
      count: reads.length,
      errors: reads.filter((e) => e.outcome === 'error').length,
      latencyMs: distribution(reads.map((e) => e.ms)),
    },
    byKind,
    effects: Object.fromEntries([...effectKinds].map(([kind, values]) => [kind, distribution(values)])),
    effectsAll: distribution(effectsInside.map((e) => e.ms)),
  };
}

/** `arb_pool;dur=12.3;desc="2", arb_pool_self;…` → { pool: 12.3 } (inclusive durations). */
export function serverTimingPhases(header: string | null): Partial<Record<KeptPhase, number>> | undefined {
  if (!header) return undefined;
  const kept = new Set<string>(KEPT_PHASES);
  const phases: Partial<Record<KeptPhase, number>> = {};
  for (const entry of header.split(',')) {
    const match = /^\s*arb_([a-z0-9_]+);dur=([\d.]+)/.exec(entry);
    if (match && kept.has(match[1]!) && !match[1]!.endsWith('_self')) phases[match[1] as KeptPhase] = Number(match[2]);
  }
  return Object.keys(phases).length ? phases : undefined;
}
