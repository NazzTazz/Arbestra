/** Manual, loopback-only benchmark; no DB, business route or production endpoint.
 * node --expose-gc --import tsx apps/api/src/modules/operations/http-diagnostics.benchmark.ts --baseline test-results/noc-v1-telemetry-baseline.ts
 * The optional baseline is a preserved pre-change telemetry module, never fetched.
 */
import { randomUUID } from 'node:crypto';
import { Agent, request } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import * as current from './telemetry.js';
import { createHttpLogging } from './http-logging.js';

const baselinePath = process.argv[process.argv.indexOf('--baseline') + 1];
const baseline =
  process.argv.includes('--baseline') && baselinePath
    ? ((await import(pathToFileURL(resolve(baselinePath)).href)) as typeof current)
    : undefined;
function option(name: string, fallback: number, minimum: number, maximum: number) {
  const index = process.argv.indexOf(name),
    value = index < 0 ? fallback : Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw Error(`Invalid ${name}`);
  return value;
}
const concurrency = option('--concurrency', 8, 1, 32),
  repeats = option('--repeats', 3, 1, 9);
const warmup = option('--warmup', 800, 1, 20_000),
  measuredCount = option('--count', 4_000, 1, 20_000);
const plateauBatches = option('--plateau-batches', 4, 0, 10);
const workloadArgument = process.argv.indexOf('--workloads');
const workloads = workloadArgument < 0 ? ['simple', 'slow', 'mixed'] : process.argv[workloadArgument + 1]!.split(',');
if (!workloads.length || workloads.some((value) => !['simple', 'slow', 'mixed'].includes(value)))
  throw Error('Invalid --workloads');
const percentile = (values: number[], q: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1] ?? null;
const database = {
  status: 'unknown' as const,
  latencyMs: null,
  observedAt: null,
  connections: null,
  activeQueries: null,
  note: 'Benchmark without DB',
};

async function run(variant: 'before' | 'after', workload: 'simple' | 'slow' | 'mixed') {
  const logging = createHttpLogging('anomalies', (_line, done) => setImmediate(done));
  const app = Fastify(
    variant === 'after'
      ? {
          logger: logging.loggerOptions,
          disableRequestLogging: true,
          requestIdHeader: false,
          genReqId: () => randomUUID(),
        }
      : { logger: false },
  );
  const module = variant === 'before' ? baseline : current;
  const telemetry = module
    ? new module.OperationsTelemetry(Date.now, false, {
        slowThresholdMs: 250,
        httpLogger: logging.diagnostics(app.log),
      })
    : undefined;
  if (telemetry && module) module.instrumentHttp(app, telemetry);
  let index = 0;
  app.get('/work', async (_request, reply) => {
    if (workload === 'slow') await new Promise((done) => setTimeout(done, 260));
    if (workload === 'mixed' && index++ % 2 === 0) reply.status(503);
    return { ok: true };
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const agent = new Agent({ keepAlive: true, maxSockets: concurrency });
  const one = () =>
    new Promise<number>((done, reject) => {
      const at = performance.now();
      const req = request(`${base}/work`, { agent }, (res) => {
        res.resume();
        res.once('end', () => done(performance.now() - at));
        res.once('error', reject);
      });
      req.setTimeout(10_000, () => req.destroy(Error('Benchmark request timeout')));
      req.once('error', reject);
      req.end();
    });
  const batch = async (count: number) => {
    let assigned = 0;
    const durations: number[] = [];
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (assigned++ < count) durations.push(await one());
      }),
    );
    return durations;
  };
  try {
    await batch(workload === 'slow' ? 16 : warmup);
    global.gc?.();
    const heapBefore = process.memoryUsage().heapUsed,
      cpuBefore = process.cpuUsage(),
      start = performance.now();
    const count = workload === 'slow' ? 96 : measuredCount;
    const durations = await batch(count),
      elapsedMs = performance.now() - start,
      cpu = process.cpuUsage(cpuBefore);
    global.gc?.();
    const memory = process.memoryUsage();
    const snapshot = telemetry?.snapshot(database);
    const heapPlateau: number[] = [];
    if (workload === 'mixed')
      for (let i = 0; i < plateauBatches; i++) {
        await batch(measuredCount);
        global.gc?.();
        heapPlateau.push(process.memoryUsage().heapUsed);
      }
    return {
      variant,
      baseline: baseline ? 'V1 preserved telemetry' : 'uninstrumented',
      workload,
      count,
      elapsedMs,
      requestsPerSecond: (count * 1000) / elapsedMs,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      cpuMs: (cpu.user + cpu.system) / 1000,
      cpuPercentOneCore: (cpu.user + cpu.system) / elapsedMs / 10,
      heapBefore,
      heapAfter: memory.heapUsed,
      rssBytes: memory.rss,
      heapPlateau,
      diagnostics: snapshot?.httpDiagnostics ?? null,
    };
  } finally {
    agent.destroy();
    await app.close();
    logging.close();
  }
}

const results = [];
for (let repeat = 0; repeat < repeats; repeat++)
  for (const workload of workloads as Array<'simple' | 'slow' | 'mixed'>) {
    // Alternate order to reduce the effect of JIT warmup and changing machine load.
    for (const variant of (repeat % 2 ? ['after', 'before'] : ['before', 'after']) as Array<'before' | 'after'>) {
      results.push({ repeat, ...(await run(variant, workload)) });
    }
  }
process.stdout.write(
  JSON.stringify(
    {
      node: process.version,
      concurrency,
      warmup,
      repeats,
      measuredCount,
      plateauBatches,
      gcExposed: !!global.gc,
      note: 'Client and server share one process; CPU/RSS include both. Local asynchronous discard sink; no disk/DB.',
      results,
    },
    null,
    2,
  ) + '\n',
);
