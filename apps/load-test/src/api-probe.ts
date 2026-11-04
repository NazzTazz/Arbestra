/** Preloaded into the local API launched by local-api.ts (`node --import`), never
 * into a deployed API: every second it writes the process CPU, memory and
 * event-loop delay to LOAD_PROBE_FILE for the sampler. It reads process
 * counters only; the game code is unchanged. */
import { renameSync, writeFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const file = process.env.LOAD_PROBE_FILE;
if (file) {
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const timer = setInterval(() => {
    const cpu = process.cpuUsage(),
      memory = process.memoryUsage();
    const sample = {
      pid: process.pid,
      at: Date.now(),
      cpuUserUs: cpu.user,
      cpuSystemUs: cpu.system,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      eventLoopDelayMs: {
        p50: delay.percentile(50) / 1e6,
        p99: delay.percentile(99) / 1e6,
        max: delay.max / 1e6,
      },
    };
    delay.reset();
    try {
      writeFileSync(file + '.tmp', JSON.stringify(sample));
      renameSync(file + '.tmp', file);
    } catch {
      /* A probe never disturbs the API. */
    }
  }, 1000);
  timer.unref();
}
