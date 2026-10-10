// Internal RC1 terrain receipt. No migrations, reset, development writes or source-world opening.
// Run: node --import tsx tests/browser/spawn-map-fixture.mjs ; Ctrl+C removes only this fixture.
/* global process, console, fetch, setTimeout, URL */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { createDatabase } from '../../apps/api/src/database/connection.ts';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment.ts';
import { hashPassword } from '../../apps/api/src/security/passwords.ts';
import { RC1_CANONICAL_CHECKSUM } from '../../apps/api/src/modules/onboarding/spawn-map.ts';
const target = new URL(testDatabaseUrl());
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected RC1 browser fixture target');
const db = createDatabase(target.href), worldId = randomUUID(), slug = 'rc1-receipt-' + worldId;
const accountId = randomUUID(), neighborId = randomUUID(), email = accountId + '@spawn-browser.test', children = [], logs = [];
const data = JSON.parse(readFileSync('apps/world-web/public/studies/t1-alpha512-rc1.json', 'utf8'));
let finish;
const stopped = new Promise(resolve => { finish = resolve; });
process.once('SIGINT', () => finish()); process.once('SIGTERM', () => finish());
process.stdin.once('data', () => finish());
function launch(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, windowsHide: true, env: { ...process.env, WORLD_GENERATOR_OPERATOR_EMAILS: email }, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
  child.stdout.on('data', b => logs.push(String(b))); child.stderr.on('data', b => logs.push(String(b)));
  child.once('exit', () => finish());
}
try {
  for (const port of [3100, 5274]) {
    let occupied = false; try { await fetch('http://localhost:' + port); occupied = true; } catch { /* unused */ }
    if (occupied) throw Error('Fixture port already occupied: ' + port);
  }
  const passwordHash=await hashPassword('rc1-receipt-password');
  await db.insertInto('accounts').values([{ id: accountId, email, passwordHash }, { id: neighborId, email: neighborId + '@spawn-browser.test', passwordHash }]).execute();
  await db.insertInto('worlds').values({ id: worldId, slug, name: 'RC1 · recette terrain', topology: 'torus', widthCells: 512, heightCells: 256, chunkSize: 32, seed: data.seed, generationVersion: 3, generationStatus: 'ready', isOpen: true, generatedAt: new Date() }).execute();
  await db.insertInto('worldGenerationCandidates').values({ worldId, commandId: randomUUID(), ownerAccountId: accountId, parameters: data.geography.parameters, status: 'ready', checksum: RC1_CANONICAL_CHECKSUM, artifact: data }).execute();
  await db.insertInto('worldMemberships').values({ worldId, accountId: neighborId, playerName: 'Village témoin' }).execute();
  const village = await db.insertInto('villages').values({ worldId, ownerAccountId: neighborId, name: 'Village témoin', anchorCellX: 135, anchorCellY: 80 }).returning('id').executeTakeFirstOrThrow();
  await db.insertInto('populationCohorts').values({ worldId, villageId: village.id, originVillageId: village.id, memberCount: 15, activity: 'idle', energy: 8, energyProgress: 0, energyUpdatedAt: new Date(), restingSince: null, foodUsedSinceRest: 0, harvestId: null, extractionId: null, restBuildingId: null }).execute();
  const built=process.argv.includes('--built');
  launch(built?['apps/api/dist/server-e2e.js']:['--import', 'tsx', 'apps/api/src/server-e2e.ts'], process.cwd());
  const cwd = resolve('apps/world-web'), require = createRequire(resolve(cwd, 'package.json'));
  launch([resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), ...(built?['preview']:[]), '--mode', 'e2e', '--host', 'localhost', '--port', '5274', '--strictPort'], cwd);
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (children.some(c => c.exitCode !== null)) throw Error('Fixture server exited: ' + logs.slice(-4).join(' '));
    try { if ((await fetch('http://127.0.0.1:3100/api/health')).ok && (await fetch('http://localhost:5274')).ok) break; } catch { /* retry bounded */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (Date.now() >= deadline) throw Error('Fixture readiness timeout');
  console.log(JSON.stringify({ url: 'http://localhost:5274/spawn-map?world=' + slug, email, neighborEmail: neighborId + '@spawn-browser.test', password: 'rc1-receipt-password', worldId }));
  await stopped;
} finally {
  for (const child of children) child.kill();
  await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))));
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('woodlandDeposits').where('worldId', '=', worldId).execute();
  await db.deleteFrom('stoneDeposits').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db.deleteFrom('accounts').where('id', 'in', [accountId, neighborId]).execute();
  await db.destroy();
  process.stdin.pause();
  process.stdin.unref?.();
}
