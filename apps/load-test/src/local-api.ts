/** Launches a local API of its own for a load test, on a dedicated database
 * and a free port, with its scheduler, navigation and expedition workers (the
 * same server entry as `pnpm dev`), plus the read-only process probe
 * (api-probe.ts). It never touches the PO's `pnpm dev` (API 3000).
 *
 *   tsx src/local-api.ts --target local [--port 3300] [--construction-ms 3000]
 *
 * The database comes from --database-url or LOAD_DATABASE_URL. */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { databaseUrl, describeDatabase, guard, main, OUT_DIR, PACKAGE_ROOT } from './cli.js';
import { LoadTargetRefused } from './target.js';

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    'database-url': { type: 'string' },
    port: { type: 'string', default: '3300' },
    'construction-ms': { type: 'string', default: '3000' },
    'journey-enabled': { type: 'boolean', default: false },
  },
});

await main(async () => {
  const url = databaseUrl(values),
    port = values.port!;
  const checked = guard({ target: values.target, databaseUrl: url, baseUrl: `http://127.0.0.1:${port}` });
  if (checked.target !== 'local') throw new LoadTargetRefused("local-api ne lance qu'une API locale.");
  mkdirSync(OUT_DIR, { recursive: true });
  const probe = resolve(OUT_DIR, `api-probe-${port}.json`);
  const api = resolve(PACKAGE_ROOT, '..', 'api');
  console.info(`API de charge sur http://127.0.0.1:${port}, base ${describeDatabase(url)}, sonde ${probe}.`);
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--import', pathToFileURL(resolve(PACKAGE_ROOT, 'src', 'api-probe.ts')).href, 'src/server.ts'],
    {
      cwd: api,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: url,
        HOST: '127.0.0.1',
        PORT: port,
        NODE_ENV: 'development',
        COOKIE_NAME: 'arbestra_session',
        SESSION_TTL_DAYS: '30',
        SCHEDULED_TASK_POLL_INTERVAL_MS: '250',
        // As the development .env.example: constructions last 3 s (0 = catalog durations).
        ...(Number(values['construction-ms']) > 0 ? { CONSTRUCTION_DURATION_MS: values['construction-ms'] } : {}),
        JOURNEY_ENABLED: values['journey-enabled'] ? '1' : '0',
        LOAD_PROBE_FILE: probe,
      },
    },
  );
  const stop = () => child.kill('SIGTERM');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise<void>((done) => child.on('exit', () => done()));
});
