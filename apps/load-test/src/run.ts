/** Runs the scripted bots by stages against an API, with the read-only
 * sampler in a separate process, and writes the raw JSON and the Markdown
 * summary (docs/TEST-DE-CHARGE.md §4 and §5).
 *
 *   tsx src/run.ts --target local --base-url http://127.0.0.1:3300 --world charge
 *     --stages 10,30 --stage-seconds 120 [--ramp-seconds 20] [--pace-seconds 8]
 *     [--mix harvest=3,build=1] [--max-p95-ms 5000] [--max-error-rate 5]
 *     [--api-probe-file out/api-probe-3300.json | --api-pid PID]
 *
 * Several worlds: --world a,b (one credentials file each, bots interleaved). */
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { parseMix } from './actions.js';
import { Bot, type BotObserver } from './bot.js';
import {
  credentialsPath,
  guard,
  main,
  OUT_DIR,
  PACKAGE_ROOT,
  readCredentials,
  runtimeScript,
  timestamp,
} from './cli.js';
import { renderMarkdown, summarizeSamples, firstSaturation, type SamplerLine, type StageResult } from './report.js';
import { distribution, summarizeWindow, type EffectEvent, type RequestEvent } from './stats.js';
import { DEFAULT_THRESHOLDS, hostReasonFromSamples, stopReason } from './stop.js';
import { LoadTargetRefused } from './target.js';

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    'base-url': { type: 'string' },
    world: { type: 'string' },
    credentials: { type: 'string' },
    'cookie-name': { type: 'string', default: 'arbestra_session' },
    stages: { type: 'string', default: '10,30' },
    'stage-seconds': { type: 'string', default: '120' },
    'ramp-seconds': { type: 'string', default: '20' },
    'pace-seconds': { type: 'string', default: '8' },
    mix: { type: 'string' },
    'max-p95-ms': { type: 'string', default: String(DEFAULT_THRESHOLDS.maxP95Ms) },
    'max-error-rate': { type: 'string', default: String(DEFAULT_THRESHOLDS.maxErrorRate) },
    'max-health-ms': { type: 'string', default: String(DEFAULT_THRESHOLDS.maxHealthMs) },
    'max-host-load-per-core': { type: 'string', default: String(DEFAULT_THRESHOLDS.maxHostLoadPerCore) },
    'min-free-mem-percent': { type: 'string', default: String(DEFAULT_THRESHOLDS.minFreeMemPercent) },
    'no-server-timing': { type: 'boolean', default: false },
    'no-sampler': { type: 'boolean', default: false },
    'database-url': { type: 'string' },
    'api-probe-file': { type: 'string' },
    'api-pid': { type: 'string' },
    'sample-seconds': { type: 'string', default: '2' },
    caveat: { type: 'string' },
    'confirm-staging': { type: 'boolean', default: false },
    'confirm-dedicated': { type: 'boolean', default: false },
  },
});

/** The host stop reason from the last sample of our own sampler (last 8 KiB of its file). */
function latestHostReason(path: string, now: number, thresholds: typeof DEFAULT_THRESHOLDS): string | null {
  if (!existsSync(path)) return null;
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size,
      length = Math.min(size, 8192),
      buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    // The first line of a partial window may be cut: only the last one is read.
    return hostReasonFromSamples(buffer.toString('utf8'), now, thresholds);
  } finally {
    closeSync(fd);
  }
}

await main(async () => {
  const base = values['base-url'],
    worlds = (values.world ?? '').split(',').filter(Boolean);
  if (!base || !worlds.length) throw new LoadTargetRefused('--base-url et --world sont obligatoires.');
  const databaseUrl = values['database-url'] ?? process.env.LOAD_DATABASE_URL;
  let checked = guard({
    target: values.target,
    baseUrl: base,
    worldSlug: worlds[0]!,
    ...(databaseUrl ? { databaseUrl } : {}),
  });
  for (const world of worlds.slice(1)) checked = guard({ target: values.target, baseUrl: base, worldSlug: world });
  const stages = values.stages!.split(',').map(Number);
  if (stages.some((n, i) => !Number.isSafeInteger(n) || n < 1 || (i > 0 && n < stages[i - 1]!)))
    throw new LoadTargetRefused('--stages : des effectifs croissants, par exemple 10,30,60,100.');
  const stageMs = Number(values['stage-seconds']) * 1000,
    rampMs = Math.min(stageMs / 2, Number(values['ramp-seconds']) * 1000),
    paceMs = Number(values['pace-seconds']) * 1000;
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    maxP95Ms: Number(values['max-p95-ms']),
    maxErrorRate: Number(values['max-error-rate']),
    maxHealthMs: Number(values['max-health-ms']),
    maxHostLoadPerCore: Number(values['max-host-load-per-core']),
    minFreeMemPercent: Number(values['min-free-mem-percent']),
  };
  for (const [name, value] of [
    ['--max-host-load-per-core', thresholds.maxHostLoadPerCore],
    ['--min-free-mem-percent', thresholds.minFreeMemPercent],
  ] as const)
    if (!Number.isFinite(value) || value < 0) throw new LoadTargetRefused(`${name} : un nombre positif (0 désactive).`);
  const mix = parseMix(values.mix);
  const files = (values.credentials ?? '').split(',').filter(Boolean);
  const pools = worlds.map((world, i) =>
    readCredentials(credentialsPath(checked.target, world, files[i]), checked.target, world)
      .bots.filter((b) => b.token && b.villageId)
      .map((credential) => ({ world, credential })),
  );
  // Interleaved worlds: each stage spreads its bots over every world.
  const roster: Array<(typeof pools)[number][number]> = [];
  for (let i = 0; pools.some((p) => i < p.length); i++) for (const p of pools) if (p[i]) roster.push(p[i]!);
  const wanted = stages.at(-1)!;
  if (roster.length < wanted)
    throw new LoadTargetRefused(
      `${roster.length} bots provisionnés pour ${wanted} demandés : lancez provision.ts d'abord (un monde RC1 tient une cinquantaine de villages).`,
    );

  const runDir = resolve(OUT_DIR, `run-${checked.target}-${timestamp()}`);
  mkdirSync(runDir, { recursive: true });
  const requests: RequestEvent[] = [],
    effects: EffectEvent[] = [],
    health: Array<{ t: number; ok: boolean; ms: number | null }> = [],
    loops: Array<{ t: number; p99: number }> = [],
    streamEvents: Array<{ t: number; type: 'open' | 'reconnect' | 'close' }> = [],
    missed: Array<{ t: number; kind: string }> = [],
    actions: Array<{ t: number; kind: string }> = [],
    failures: Array<{ t: number; bot: number; kind: string; message: string }> = [];
  const observer: BotObserver = {
    request: (event) => requests.push(event),
    effect: (kind, ms) => effects.push({ t: Date.now(), kind, ms }),
    effectMissed: (kind) => missed.push({ t: Date.now(), kind }),
    streamOpened: (reconnect) => streamEvents.push({ t: Date.now(), type: reconnect ? 'reconnect' : 'open' }),
    streamClosed: () => streamEvents.push({ t: Date.now(), type: 'close' }),
    action: (kind) => actions.push({ t: Date.now(), kind }),
    failure: (bot, kind, error) => {
      if (failures.length < 2000)
        failures.push({ t: Date.now(), bot, kind, message: String((error as Error)?.message ?? error).slice(0, 200) });
    },
  };

  // The sampler, a separate read-only process; stopped by closing its stdin.
  let sampler: ChildProcess | null = null;
  const samplesPath = resolve(runDir, 'samples.jsonl');
  if (!values['no-sampler'] && databaseUrl) {
    const args = [
      ...runtimeScript('sampler'),
      '--target',
      checked.target,
      '--base-url',
      base,
      '--world',
      worlds[0]!,
      '--out',
      samplesPath,
      '--interval',
      values['sample-seconds']!,
      ...(values['api-probe-file'] ? ['--api-probe-file', resolve(values['api-probe-file'])] : []),
      ...(values['api-pid'] ? ['--api-pid', values['api-pid']] : []),
      '--stop-on-stdin-close',
      ...(values['confirm-staging'] ? ['--confirm-staging'] : []),
      ...(values['confirm-dedicated'] ? ['--confirm-dedicated'] : []),
    ];
    sampler = spawn(process.execPath, args, {
      cwd: PACKAGE_ROOT,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, LOAD_DATABASE_URL: databaseUrl },
    });
  } else console.warn('Sans --database-url ni LOAD_DATABASE_URL : pas d’échantillonneur serveur.');

  // Health of the API and event loop of this process (a busy bot machine skews the measures).
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let healthFailures = 0;
  const healthTimer = setInterval(() => {
    const started = performance.now();
    void fetch(base + '/api/health', { signal: AbortSignal.timeout(5000) })
      .then(async (r) => {
        await r.arrayBuffer();
        healthFailures = r.ok ? 0 : healthFailures + 1;
        health.push({ t: Date.now(), ok: r.ok, ms: performance.now() - started });
      })
      .catch(() => {
        healthFailures++;
        health.push({ t: Date.now(), ok: false, ms: null });
      });
    loops.push({ t: Date.now(), p99: loop.percentile(99) / 1e6 });
    loop.reset();
  }, 2000);

  let interrupted = false;
  process.on('SIGINT', () => {
    interrupted = true;
  });
  const bots: Bot[] = [];
  const stageWindows: Array<{ label: string; bots: number; from: number; to: number; stopReason?: string }> = [];
  let stop: string | undefined;
  const startedAt = new Date().toISOString();
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
  console.info(
    `Paliers ${stages.join(', ')} bots, ${stageMs / 1000} s chacun, rythme moyen ${paceMs / 1000} s ; ${runDir}`,
  );
  try {
    for (const target of stages) {
      const stageStart = Date.now(),
        toStart = target - bots.length;
      for (let i = 0; i < toStart && !stop && !interrupted; i++) {
        const { world, credential } = roster[bots.length]!;
        const bot = new Bot({
          base,
          world,
          cookieName: values['cookie-name']!,
          credential,
          mix,
          paceMs,
          serverTiming: !values['no-server-timing'],
          observer,
        });
        bots.push(bot);
        void bot.start();
        await sleep(rampMs / Math.max(1, toStart));
      }
      const steadyFrom = Date.now();
      let stageStop: string | undefined;
      while (Date.now() - stageStart < stageMs && !interrupted) {
        await sleep(5000);
        const now = Date.now();
        const window = summarizeWindow(requests, effects, now - 30_000, now);
        const recent = health.filter((h) => h.t >= now - 30_000 && h.ms !== null).map((h) => h.ms!);
        const reason = stopReason(
          window,
          { p95Ms: distribution(recent)?.p95 ?? null, consecutiveFailures: healthFailures },
          thresholds,
        );
        const hostReason = reason ?? latestHostReason(samplesPath, now, thresholds);
        const c = window.commands;
        console.info(
          `[${target} bots] ${Math.round((now - stageStart) / 1000)} s : ${c.count} commandes/30 s, p95 ${c.latencyMs?.p95 ?? '—'} ms, erreurs ${c.errorRate} %, refus ${c.refused}`,
        );
        if (hostReason) {
          stageStop = stop = hostReason;
          break;
        }
      }
      if (interrupted && !stop) stageStop = stop = 'interrompu (Ctrl+C)';
      stageWindows.push({
        label: String(target),
        bots: bots.length,
        from: stageStop ? stageStart : steadyFrom,
        to: Date.now(),
        ...(stageStop ? { stopReason: stageStop } : {}),
      });
      if (stop) break;
    }
  } finally {
    clearInterval(healthTimer);
    await Promise.all(bots.map((b) => b.stop()));
    for (const b of bots) b.http.sweep(Number.MAX_SAFE_INTEGER);
    sampler?.stdin?.end();
    if (sampler) await new Promise((done) => sampler!.on('exit', done));
  }

  const samples: SamplerLine[] = existsSync(samplesPath)
    ? readFileSync(samplesPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as SamplerLine)
    : [];
  const stageResults: StageResult[] = stageWindows.map((w) => ({
    label: w.label,
    bots: w.bots,
    from: w.from,
    to: w.to,
    summary: summarizeWindow(requests, effects, w.from, w.to),
    server: summarizeSamples(samples, w.from, w.to),
    client: {
      eventLoopP99MaxMs: (() => {
        const inside = loops.filter((l) => l.t >= w.from && l.t < w.to).map((l) => l.p99);
        return inside.length ? Math.round(Math.max(...inside)) : null;
      })(),
      streamReconnects: streamEvents.filter((e) => e.type === 'reconnect' && e.t >= w.from && e.t < w.to).length,
      effectsMissed: missed.filter((m) => m.t >= w.from && m.t < w.to).length,
      failures: failures.filter((m) => m.t >= w.from && m.t < w.to).length,
    },
    ...(w.stopReason ? { stopReason: w.stopReason } : {}),
  }));
  const options = {
    stages,
    stageSeconds: stageMs / 1000,
    rampSeconds: rampMs / 1000,
    paceSeconds: paceMs / 1000,
    worlds,
    mix,
    thresholds,
    serverTiming: !values['no-server-timing'],
  };
  writeFileSync(
    resolve(runDir, 'result.json'),
    JSON.stringify(
      {
        target: checked.target,
        base,
        startedAt,
        options,
        stop,
        stages: stageResults,
        requests,
        effects,
        missed,
        health,
        loops,
        streamEvents,
        actions,
        failures,
      },
      null,
      0,
    ),
  );
  const markdown = renderMarkdown({
    title: `Test de charge ${checked.target} du ${startedAt.slice(0, 16).replace('T', ' ')} UTC`,
    target: checked.target,
    base,
    startedAt,
    options,
    stages: stageResults,
    ...(stop ? { stopReason: stop } : {}),
    ...(values.caveat ? { caveat: values.caveat } : {}),
  });
  writeFileSync(resolve(runDir, 'summary.md'), markdown);
  const first = firstSaturation(stageResults);
  console.info(
    `Fin : ${stop ?? 'paliers terminés'}. Première ressource saturée : ${first ? `${first.resource} (${first.stage} bots, ${first.evidence})` : 'aucune'}.`,
  );
  console.info(`Résumé : ${resolve(runDir, 'summary.md')}`);
  process.exit(0);
});
