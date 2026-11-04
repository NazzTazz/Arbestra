/** Stage results, first saturated resource and the Markdown summary (pure). */
import { distribution, type WindowSummary } from './stats.js';

/** One line of the sampler (sampler.ts); only the fields the report reads. */
export interface SamplerLine {
  at: number;
  health: { ok: boolean; ms: number | null };
  db?: {
    connections: number;
    active: number;
    lockWaiting: number;
    longestTransactionS: number;
    longestQueryS: number;
    waits: Array<{ type: string; event: string; count: number }>;
    locksWaiting: number;
    advisoryWaiting: number;
    oldestDueS: number;
    tasksDue: number;
    harvestPending: number;
    oldestHarvestPendingS: number;
    commitsPerS: number;
    deadlocks: number;
  };
  api?: { cpuPercent: number | null; rssMb: number; eventLoopP99Ms?: number };
  host?: { load1: number };
}

export interface ServerSummary {
  samples: number;
  health: { failures: number; p95Ms: number | null; maxMs: number | null };
  db: {
    connectionsMax: number;
    activeP95: number;
    activeMax: number;
    lockWaitingMax: number;
    advisoryWaitingMax: number;
    longestTransactionMaxS: number;
    longestQueryMaxS: number;
    commitsPerSMean: number;
    deadlocks: number;
    topWaits: Array<{ wait: string; samples: number }>;
  } | null;
  scheduler: {
    oldestDueMaxS: number;
    tasksDueMax: number;
    harvestPendingMax: number;
    oldestHarvestMaxS: number;
  } | null;
  api: { cpuP95: number | null; cpuMax: number | null; rssMaxMb: number; eventLoopP99MaxMs: number | null } | null;
  hostLoadMax: number | null;
}

const max = (values: number[]) => (values.length ? Math.max(...values) : 0);
export function summarizeSamples(lines: readonly SamplerLine[], from: number, to: number): ServerSummary {
  const inside = lines.filter((l) => l.at >= from && l.at < to);
  const db = inside.flatMap((l) => (l.db ? [l.db] : []));
  const api = inside.flatMap((l) => (l.api ? [l.api] : []));
  const healthMs = inside.flatMap((l) => (l.health.ms === null ? [] : [l.health.ms]));
  const health = distribution(healthMs);
  const waits = new Map<string, number>();
  for (const d of db)
    for (const w of d.waits) waits.set(`${w.type}/${w.event}`, (waits.get(`${w.type}/${w.event}`) ?? 0) + 1);
  const cpu = distribution(api.flatMap((a) => (a.cpuPercent === null ? [] : [a.cpuPercent])));
  const loops = api.flatMap((a) => (a.eventLoopP99Ms === undefined ? [] : [a.eventLoopP99Ms]));
  return {
    samples: inside.length,
    health: {
      failures: inside.filter((l) => !l.health.ok).length,
      p95Ms: health?.p95 ?? null,
      maxMs: health?.max ?? null,
    },
    db: db.length
      ? {
          connectionsMax: max(db.map((d) => d.connections)),
          activeP95: distribution(db.map((d) => d.active))!.p95,
          activeMax: max(db.map((d) => d.active)),
          lockWaitingMax: max(db.map((d) => d.lockWaiting)),
          advisoryWaitingMax: max(db.map((d) => d.advisoryWaiting)),
          longestTransactionMaxS: max(db.map((d) => d.longestTransactionS)),
          longestQueryMaxS: max(db.map((d) => d.longestQueryS)),
          commitsPerSMean: Math.round((db.reduce((s, d) => s + d.commitsPerS, 0) / db.length) * 10) / 10,
          deadlocks: db.reduce((s, d) => s + d.deadlocks, 0),
          topWaits: [...waits]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([wait, samples]) => ({ wait, samples })),
        }
      : null,
    scheduler: db.length
      ? {
          oldestDueMaxS: max(db.map((d) => d.oldestDueS)),
          tasksDueMax: max(db.map((d) => d.tasksDue)),
          harvestPendingMax: max(db.map((d) => d.harvestPending)),
          oldestHarvestMaxS: max(db.map((d) => d.oldestHarvestPendingS)),
        }
      : null,
    api: api.length
      ? {
          cpuP95: cpu?.p95 ?? null,
          cpuMax: cpu?.max ?? null,
          rssMaxMb: max(api.map((a) => a.rssMb)),
          eventLoopP99MaxMs: loops.length ? max(loops) : null,
        }
      : null,
    hostLoadMax: inside.some((l) => l.host) ? max(inside.map((l) => l.host?.load1 ?? 0)) : null,
  };
}

export interface StageResult {
  label: string;
  bots: number;
  from: number;
  to: number;
  client: { eventLoopP99MaxMs: number | null; streamReconnects: number; effectsMissed: number; failures: number };
  summary: WindowSummary;
  server: ServerSummary;
  stopReason?: string;
}

/** Thresholds of a saturated resource (docs/TEST-DE-CHARGE.md §5). */
export const SATURATION = {
  poolWaitMs: 100,
  lockWaitMs: 500,
  lockWaiters: 3,
  navigationQueueMs: 500,
  navigationMs: 2000,
  schedulerLagS: 10,
  harvestPendingS: 15,
  apiCpuPercent: 90,
  apiEventLoopMs: 200,
  healthMs: 1000,
  longQueryS: 5,
  botEventLoopMs: 200,
} as const;

export interface Saturation {
  stage: string;
  bots: number;
  resource: string;
  /** Measured value over its threshold: the largest names the first resource of a stage. */
  ratio: number;
  evidence: string;
}

/** Highest p95 of a Server-Timing phase over the command kinds of a stage. */
function phaseP95(summary: WindowSummary, phase: keyof WindowSummary['byKind'][string]['phasesP95']) {
  let worst: { kind: string; ms: number } | null = null;
  for (const [kind, s] of Object.entries(summary.byKind)) {
    const ms = s.phasesP95[phase];
    if (ms !== undefined && s.count >= 5 && (!worst || ms > worst.ms)) worst = { kind, ms };
  }
  return worst;
}

export function saturations(stage: StageResult): Saturation[] {
  const hits: Saturation[] = [];
  const hit = (resource: string, value: number, threshold: number, evidence: string) => {
    if (value > threshold)
      hits.push({
        stage: stage.label,
        bots: stage.bots,
        resource,
        ratio: Math.round((value / threshold) * 100) / 100,
        evidence,
      });
  };
  const s = stage.summary,
    server = stage.server;
  const pool = phaseP95(s, 'pool');
  if (pool)
    hit(
      "pool PostgreSQL de l'API (8 connexions)",
      pool.ms,
      SATURATION.poolWaitMs,
      `attente de connexion p95 ${pool.ms} ms (${pool.kind})` +
        (server.db ? `, connexions actives max ${server.db.activeMax}` : ''),
    );
  for (const phase of ['village_lock', 'navigation_lock'] as const) {
    const lock = phaseP95(s, phase);
    if (lock)
      hit(
        phase === 'village_lock' ? 'verrou village (PostgreSQL)' : 'verrou de navigation du monde (PostgreSQL)',
        lock.ms,
        SATURATION.lockWaitMs,
        `attente ${phase} p95 ${lock.ms} ms (${lock.kind})`,
      );
  }
  if (server.db)
    hit(
      'verrous PostgreSQL (attentes simultanées)',
      server.db.lockWaitingMax,
      SATURATION.lockWaiters,
      `${server.db.lockWaitingMax} sessions en attente de verrou au pire échantillon (dont ${server.db.advisoryWaitingMax} verrous consultatifs)`,
    );
  const queue = phaseP95(s, 'navigation_queue');
  if (queue)
    hit(
      'file du worker de trajets',
      queue.ms,
      SATURATION.navigationQueueMs,
      `attente du worker p95 ${queue.ms} ms (${queue.kind})`,
    );
  const navigation = phaseP95(s, 'navigation');
  if (navigation)
    hit(
      'calcul de trajets',
      navigation.ms,
      SATURATION.navigationMs,
      `calcul p95 ${navigation.ms} ms (${navigation.kind})`,
    );
  if (server.scheduler) {
    hit(
      'worker économique (scheduler)',
      server.scheduler.oldestDueMaxS,
      SATURATION.schedulerLagS,
      `échéance due la plus ancienne ${server.scheduler.oldestDueMaxS} s, ${server.scheduler.tasksDueMax} tâches dues au pire`,
    );
    hit(
      'traitement des récoltes (worker)',
      server.scheduler.oldestHarvestMaxS,
      SATURATION.harvestPendingS,
      `récolte en attente depuis ${server.scheduler.oldestHarvestMaxS} s, ${server.scheduler.harvestPendingMax} en attente au pire`,
    );
  }
  if (server.api?.cpuP95 !== null && server.api?.cpuP95 !== undefined)
    hit(
      "CPU du processus de l'API",
      server.api.cpuP95,
      SATURATION.apiCpuPercent,
      `CPU p95 ${server.api.cpuP95} % (un cœur = 100 %)`,
    );
  if (server.api?.eventLoopP99MaxMs)
    hit(
      "boucle d'événements de l'API",
      server.api.eventLoopP99MaxMs,
      SATURATION.apiEventLoopMs,
      `retard de boucle p99 jusqu'à ${server.api.eventLoopP99MaxMs} ms`,
    );
  if (server.health.p95Ms !== null)
    hit("santé de l'API", server.health.p95Ms, SATURATION.healthMs, `/api/health p95 ${server.health.p95Ms} ms`);
  if (server.health.failures)
    hit(
      "santé de l'API",
      SATURATION.healthMs * 2,
      SATURATION.healthMs,
      `${server.health.failures} échecs de /api/health`,
    );
  if (server.db)
    hit(
      'requête PostgreSQL longue',
      server.db.longestQueryMaxS,
      SATURATION.longQueryS,
      `requête active depuis ${server.db.longestQueryMaxS} s`,
    );
  if (stage.client.eventLoopP99MaxMs)
    hit(
      'machine des bots (mesure faussée)',
      stage.client.eventLoopP99MaxMs,
      SATURATION.botEventLoopMs,
      `boucle d'événements des bots p99 jusqu'à ${stage.client.eventLoopP99MaxMs} ms`,
    );
  return hits.sort((a, b) => b.ratio - a.ratio);
}

/** The first stage with a saturated resource, and its largest overrun. */
export function firstSaturation(stages: readonly StageResult[]): Saturation | null {
  for (const stage of stages) {
    const hits = saturations(stage).filter((h) => h.resource !== 'machine des bots (mesure faussée)');
    if (hits.length) return hits[0]!;
  }
  return null;
}

const f = (value: number | null | undefined, unit = '') =>
  value === null || value === undefined ? '—' : `${value}${unit}`;

export function renderMarkdown(run: {
  title: string;
  target: string;
  base: string;
  startedAt: string;
  options: Record<string, unknown>;
  stages: StageResult[];
  stopReason?: string;
  caveat?: string;
}): string {
  const lines: string[] = [];
  lines.push(`# ${run.title}`, '');
  lines.push(`- Cible : ${run.target} (${run.base}), début ${run.startedAt}.`);
  lines.push(`- Options : \`${JSON.stringify(run.options)}\`.`);
  if (run.caveat) lines.push(`- **Réserve** : ${run.caveat}`);
  lines.push(`- Arrêt : ${run.stopReason ?? 'paliers terminés'}.`);
  const first = firstSaturation(run.stages);
  lines.push(
    first
      ? `- **Première ressource saturée** : ${first.resource}, au palier ${first.stage} (${first.bots} bots) : ${first.evidence}.`
      : '- **Première ressource saturée** : aucune au-delà des seuils sur ces paliers.',
    '',
  );
  lines.push('## Paliers', '');
  lines.push(
    '| Palier | Bots | Req/s | Commandes | Refus | Erreurs | p50 | p95 | p99 | Effet SSE p50 / p95 | Lectures p95 | Santé p95 | Retard worker max | Connexions actives max | Attentes verrou max | CPU API p95 | Boucle API p99 max | Boucle bots p99 max |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of run.stages) {
    const c = s.summary.commands;
    lines.push(
      `| ${s.label} | ${s.bots} | ${s.summary.perSecond} | ${c.count} | ${c.refused} | ${c.errors} (${c.errorRate} %) | ${f(c.latencyMs?.p50, ' ms')} | ${f(c.latencyMs?.p95, ' ms')} | ${f(c.latencyMs?.p99, ' ms')} | ${f(s.summary.effectsAll?.p50, ' ms')} / ${f(s.summary.effectsAll?.p95, ' ms')} | ${f(s.summary.reads.latencyMs?.p95, ' ms')} | ${f(s.server.health.p95Ms, ' ms')} | ${f(s.server.scheduler?.oldestDueMaxS, ' s')} | ${f(s.server.db?.activeMax)} | ${f(s.server.db?.lockWaitingMax)} | ${f(s.server.api?.cpuP95, ' %')} | ${f(s.server.api?.eventLoopP99MaxMs, ' ms')} | ${f(s.client.eventLoopP99MaxMs, ' ms')} |`,
    );
  }
  for (const s of run.stages) {
    lines.push('', `## Palier ${s.label} : ${s.bots} bots`, '');
    const hits = saturations(s);
    lines.push(hits.length ? 'Seuils dépassés :' : 'Aucun seuil dépassé.');
    for (const h of hits) lines.push(`- ${h.resource} (×${h.ratio}) : ${h.evidence}.`);
    lines.push('', '| Type | Nombre | OK | Refus | Erreurs | p50 | p95 | p99 | Codes | Phases serveur p95 (ms) |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const [kind, k] of Object.entries(s.summary.byKind))
      lines.push(
        `| ${kind} | ${k.count} | ${k.ok} | ${k.refused} | ${k.errors} | ${f(k.latencyMs?.p50)} | ${f(k.latencyMs?.p95)} | ${f(k.latencyMs?.p99)} | ${Object.entries(
          k.codes,
        )
          .map(([code, n]) => `${code} ×${n}`)
          .join(', ')} | ${Object.entries(k.phasesP95)
          .map(([phase, ms]) => `${phase} ${ms}`)
          .join(', ')} |`,
      );
    const effects = Object.entries(s.summary.effects);
    if (effects.length) {
      lines.push(
        '',
        'Délai confirmation → effet par SSE : ' +
          effects.map(([k, d]) => `${k} p50 ${f(d?.p50)} / p95 ${f(d?.p95)} ms (${d?.count ?? 0})`).join(' ; ') +
          '.',
      );
    }
    if (s.server.db?.topWaits.length)
      lines.push(
        '',
        'Attentes PostgreSQL les plus vues : ' +
          s.server.db.topWaits.map((w) => `${w.wait} (${w.samples})`).join(', ') +
          '.',
      );
    if (s.stopReason) lines.push('', `Arrêt pendant ce palier : ${s.stopReason}.`);
  }
  return lines.join('\n') + '\n';
}
