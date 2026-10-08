// Isolated real registration → spawn → Village regression. No reset or development writes.
// Run: node --import tsx tests/browser/onboarding.mjs
/* global process, console, fetch, navigator, performance, HTMLInputElement, Event, URL, setTimeout */
import { chromium, expect as baseExpect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDatabase } from '../../apps/api/src/database/connection.ts';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment.ts';
const expect = baseExpect.configure({ timeout: 60000 });
const target = new URL(testDatabaseUrl());
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected browser test target');
const db = createDatabase(target.href), worldId = randomUUID(), slug = 'onboard-browser-' + worldId;
const name = 'Monde onboarding navigateur', accounts = [], servers = [], logs = [];
let browser;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function ready(url) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (servers.some(s => s.exitCode !== null)) throw Error('Test server exited: ' + logs.slice(-5).join(' '));
    try { if ((await fetch(url)).ok) return; } catch { /* retry bounded */ }
    await delay(500);
  }
  throw Error('Test server did not start: ' + url);
}
function launch(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(child);
  child.stdout.on('data', b => logs.push(String(b)));
  child.stderr.on('data', b => logs.push(String(b)));
  return child;
}
try {
  // Refuse to reuse somebody else's server or test data.
  for (const port of [3100, 5273, 5274]) {
    let occupied = false;
    try { await fetch('http://localhost:' + port); occupied = true; } catch { /* unused */ }
    if (occupied) throw Error('Test port already occupied: ' + port);
  }
  await db.insertInto('worlds').values({ id: worldId, slug, name, topology: 'torus', widthCells: 128, heightCells: 128,
    chunkSize: 32, seed: 1, generationStatus: 'ready', generationVersion: 2, generatedAt: new Date() }).execute();
  const chunks = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) chunks.push({ worldId, chunkX: x, chunkY: y,
    generationVersion: 2, terrainCodes: Array(1024).fill(1), elevations: Array(1024).fill(0) });
  await db.insertInto('worldChunks').values(chunks).execute();
  await db.insertInto('worldClearings').values([32, 96].map(c => ({ id: randomUUID(), worldId, centerCellX: c,
    centerCellY: c, innerRadius: 12, transitionRadius: 4, status: 'protected', claimedVillageId: null }))).execute();
  launch(['--import', 'tsx', 'apps/api/src/server-e2e.ts'], process.cwd());
  for (const [app, port] of [['play-web', 5273], ['world-web', 5274]]) {
    const cwd = resolve('apps/' + app), require = createRequire(resolve(cwd, 'package.json'));
    const cli = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    launch([cli, '--mode', 'e2e', '--host', 'localhost', '--port', String(port), '--strictPort'], cwd);
  }
  await Promise.all([ready('http://127.0.0.1:3100/api/health'), ready('http://localhost:5273'), ready('http://localhost:5274')]);
  await mkdir('test-results', { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11'] });
  const report = [];
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 393, height: 851 }]]) {
    console.log('Onboarding browser:', label);
    const context = await browser.newContext({ viewport, ...(label === 'mobile' ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage(), errors = [];
    await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
    page.on('pageerror', e => errors.push(e.message));
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) console.log('Navigation', label, new URL(frame.url()).port); });
    const email = randomUUID() + '@onboarding-browser.test', password = 'onboarding-test-password';
    await page.goto('http://localhost:5273');
    await page.getByRole('button', { name: 'S’inscrire', exact: true }).click();
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe', { exact: true }).fill(password);
    await page.getByLabel('Confirmer le mot de passe').fill(password + '-different');
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page.getByRole('alert')).toContainText('ne correspondent pas');
    await page.getByLabel('Confirmer le mot de passe').fill(password);
    const response = page.waitForResponse(r => r.url().endsWith('/api/auth/register'));
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    const registration = await response;
    expect(registration.status()).toBe(201);
    accounts.push((await registration.json()).account.id);
    await page.getByRole('button', { name: new RegExp(name) }).waitFor();
    // A registered player can leave before spawning, then resume without re-registering.
    await page.reload();
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await page.getByLabel('Nom du personnage').fill('Pionnier ' + label);
    await page.getByLabel('Nom du village').fill('Village ' + label);
    await page.screenshot({ path: 'test-results/onboarding-' + label + '-lobby.png' });
    const joinResponse = page.waitForResponse(r => r.url().endsWith('/join'));
    await page.getByRole('button', { name: 'Commencer l’aventure' }).click();
    const joined = await joinResponse;
    expect(joined.status()).toBe(200);
    await page.waitForURL('**:5274/**', { timeout: 120000 });
    const villageId = new URL(page.url()).searchParams.get('villageId');
    expect(villageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new URL(page.url()).searchParams.get('world')).toBe(slug);
    await page.getByTestId('village-canvas').waitFor({ timeout: 120000 });
    await page.locator('.terrain-loading').waitFor({ state: 'hidden', timeout: 120000 });
    let rendered;
    await expect.poll(async () => {
      rendered = await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('/@babylonjs_core_Engines_engine.js'));
      if (!url) return false;
      const { Engine } = await import(url);
      const scene = Engine.Instances.flatMap(e => e.scenes).find(s => s.meshes.some(m => m.metadata?.siteId));
      if (!scene) return false;
      const roots = scene.meshes.filter(m => !m.parent && m.metadata?.siteId && m.metadata?.buildingLod);
      if (roots.length < 4 || roots.some(r => r.metadata.lodAssetState && r.metadata.lodAssetState !== 'ready')) return false;
      return { sites: [...new Set(scene.meshes.filter(m => m.isEnabled() && m.metadata?.siteId).map(m => m.metadata.siteId))],
        instances: scene.meshes.filter(m => m.isAnInstance && m.isEnabled()).length,
        backend: scene.getEngine().getClassName() };
      });
      return rendered !== false && rendered.sites.length >= 4 && rendered.instances > 0;
    }, { timeout: 120000 }).toBe(true);
    expect(rendered.sites.length).toBeGreaterThanOrEqual(4);
    expect(rendered.instances).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Vue libre', exact: true }).click();
    const sun = page.locator('[aria-label="Moment du cycle solaire"]');
    if (await sun.count()) await sun.evaluate(input => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '540');
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await delay(1500);
    await page.screenshot({ path: 'test-results/onboarding-' + label + '-village.png' });
    const retry = await context.request.post('http://localhost:5273/api/worlds/' + slug + '/join', { data: { playerName: 'Retry', villageName: 'Retry' } });
    expect(await retry.json()).toEqual({ villageId });
    // Re-login offers the existing village and does not offer a second settlement.
    await page.goto('http://localhost:5273');
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await expect(page.locator('a.world-card').filter({ hasText: name })).toHaveCount(1);
    await expect(page.locator('button.world-card').filter({ hasText: name })).toHaveCount(0);
    expect(errors).toEqual([]);
    report.push({ label, villageId, rendered, errors, registration: 201, join: 200, resume: true, idempotentRetry: true });
    await context.close();
  }
  await writeFile('test-results/onboarding-browser.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  for (const server of servers) server.kill();
  await Promise.all(servers.map(s => s.exitCode !== null ? Promise.resolve() : new Promise(r => s.once('exit', r))));
  await db.updateTable('worldClearings').set({ claimedVillageId: null, status: 'protected' }).where('worldId', '=', worldId).execute();
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  if (accounts.length) await db.deleteFrom('accounts').where('id', 'in', accounts).execute();
  await db.destroy();
}
