// Real RC1 receipt against spawn-map-fixture.mjs, authenticated without mocked API/terrain.
// SPAWN_MAP_URL and SPAWN_MAP_EMAIL come from the isolated fixture's output.
/* global process, console, URL, document, fetch, performance, getComputedStyle, requestAnimationFrame */
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 60000 });
const url = new URL(process.env.SPAWN_MAP_URL ?? '');
if (url.origin !== 'http://localhost:5274' || url.pathname !== '/spawn-map' || !url.searchParams.get('world')?.startsWith('rc1-receipt-')) throw Error('Use only the isolated RC1 fixture');
const email = process.env.SPAWN_MAP_EMAIL;
if (!email?.endsWith('@spawn-browser.test')) throw Error('Fixture account required');
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11'] });
const navigationOnly = process.argv.includes('--navigation-only');
const report = { scope: navigationOnly ? 'navigation' : 'full' }, errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(60000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url.href);
  expect(await page.evaluate(async email => (await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'rc1-receipt-password' }) })).status, email)).toBe(200);
  const started = performance.now(); await page.reload();
  await page.locator('[data-render-status=ready]').waitFor({ timeout: 150000 });
  report.readyMs = Math.round(performance.now() - started);
  await page.screenshot({ path: 'test-results/spawn-map-global.png' });
  const screen = async (x, y) => page.locator('canvas').evaluate((canvas, p) => {
    const r = canvas.getBoundingClientRect(), aspect = Number(canvas.dataset.mapAspect), radius = Number(canvas.dataset.mapRadius), [tx, ty] = canvas.dataset.mapTarget.split(':').map(Number);
    return { x: r.left + r.width / 2 + (p.x - 256 - tx) / (2 * radius * aspect) * r.width, y: r.top + r.height / 2 - (p.y - 128 - ty) / (2 * radius) * r.height };
  }, { x, y });
  const a = await screen(140, 20), b = await screen(180, 30), village = await screen(135, 80);
  await page.mouse.move(village.x, village.y);
  await expect(page.locator('.spawn-village-hover')).toHaveText('Village témoin · 15 habitants');
  expect(await page.locator('.spawn-village-hover').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await page.mouse.move(a.x, a.y); await page.mouse.click(a.x, a.y);
  await expect(page.getByRole('heading', { name: 'Emplacement 140, 20' })).toBeVisible();
  await expect(page.locator('.spawn-panel').getByText('En attente d’instrumentation', { exact: true })).toHaveCount(4);
  await expect(page.getByRole('img', { name: /Courbe locale/ })).toBeVisible();
  await expect(page.locator('[aria-label="Premier sommet"]')).toHaveCount(1);
  await expect(page.locator('[aria-label="Premier creux"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Choisir cet emplacement' })).toBeDisabled();
  await page.mouse.move(b.x, b.y);
  await expect(page.getByRole('heading', { name: 'Emplacement 140, 20' })).toBeVisible();
  await expect(page.locator('.spawn-panel').getByText('Emprises compatibles avec le terrain.', { exact: true })).toBeVisible();
  if (!navigationOnly) {
    const preflightStarted = performance.now();
    await page.getByRole('button', { name: 'Vérifier terrain et dotation' }).click();
    await expect(page.getByText('Terrain et voisinage confirmés par le serveur.', { exact: true })).toBeVisible();
    await expect(page.getByText(/Dotation complète possible sur les trajets calculés/)).toBeVisible();
    await expect(page.getByText(/Projection des ressources naturelles en attente/)).toBeVisible();
    report.resourcePreflightMs = Math.round(performance.now() - preflightStarted);
  }
  await page.mouse.move(a.x, a.y);
  await expect(page.locator('main')).toContainText('Point inspecté 140, 20');
  await expect(page.locator('canvas')).toHaveAttribute('data-map-overlay-disk', '1');
  await expect(page.locator('canvas')).toHaveAttribute('data-map-diagnostic-point', '140:20');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: 'test-results/spawn-map-selected.png' });
  report.diskComputeMs = await page.locator('.spawn-workspace').getAttribute('data-disk-compute-ms');
  report.selectionComputeMs = await page.locator('.spawn-workspace').getAttribute('data-selection-compute-ms');
  report.diskFrameMs = await page.locator('canvas').getAttribute('data-map-disk-frame-ms');
  report.geographyMs = await page.locator('.spawn-workspace').getAttribute('data-geography-ms');
  // The neutral disk must be visible on the next frames, even when continuous
  // movement prevents the debounced diagnostic from starting. No stale red.
  report.motionFrameMs = [];
  for (let x = 141; x <= 150; x++) {
    const p = await screen(x + .25, 20.25); await page.mouse.move(p.x, p.y);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = await page.locator('canvas').evaluate(el => ({ point: el.dataset.mapDiskPoint, diagnostic: el.dataset.mapDiagnosticPoint,
      visible: el.dataset.mapOverlayDisk, milliseconds: Number(el.dataset.mapCursorFrameMs) }));
    expect(state.point).toBe(`${x}:20`); expect(state.visible).toBe('1');
    expect(['', state.point]).toContain(state.diagnostic);
    report.motionFrameMs.push(state.milliseconds);
  }
  await expect(page.locator('canvas')).toHaveAttribute('data-map-diagnostic-point', '150:20');
  await expect(page.getByRole('heading', { name: 'Emplacement 140, 20' })).toBeVisible();
  await page.getByLabel('Orientation du modèle').selectOption('1');
  await expect(page.locator('.spawn-panel [role=status]').first()).not.toHaveText('Diagnostic du terrain…');
  await page.getByLabel('Orientation du modèle').selectOption('0');
  const angles = await page.locator('canvas').getAttribute('data-map-angles'), radius = await page.locator('canvas').getAttribute('data-map-radius');
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 100, a.y - 70, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('canvas')).toHaveAttribute('data-map-angles', angles);
  await expect(page.locator('canvas')).toHaveAttribute('data-map-radius', radius);
  await page.mouse.wheel(0, -100);
  await expect(page.locator('canvas')).not.toHaveAttribute('data-map-radius', radius);
  await expect(page.locator('canvas')).toHaveAttribute('data-map-angles', angles);
  await expect(page.getByRole('heading', { name: 'Emplacement 140, 20' })).toBeVisible();
  await page.getByRole('button', { name: 'Vue globale' }).click();
  await expect(page.locator('canvas')).toHaveAttribute('data-map-target', '0:0');
  await page.getByRole('button', { name: 'Fermer le panneau' }).click();
  await expect(page.locator('canvas')).toBeFocused();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await expect(page.locator('.spawn-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Fermer le panneau' }).click();
  // Click inside canonical cell 0 rather than the image's exact outer border,
  // where CSS/pointer rounding can put the event outside the terrain rectangle.
  const corner = await screen(.25, .25); await page.mouse.click(corner.x, corner.y);
  await expect(page.getByRole('heading', { name: 'Emplacement 0, 0' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveAttribute('data-map-selection-segments', '8');
  await page.screenshot({ path: 'test-results/spawn-map-corner.png' }); report.corner = true;
  const session = await page.context().storageState(); await page.context().close();
  const mobile = await browser.newPage({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, storageState: session });
  mobile.on('pageerror', e => errors.push(e.message));
  await mobile.goto(url.href); await mobile.locator('[data-render-status=ready]').waitFor({ timeout: 150000 });
  const touchPoint = await mobile.locator('canvas').evaluate(canvas => { const r = canvas.getBoundingClientRect(), aspect = Number(canvas.dataset.mapAspect), radius = Number(canvas.dataset.mapRadius), [tx, ty] = canvas.dataset.mapTarget.split(':').map(Number);
    return { x: r.left + r.width / 2 + (140 - 256 - tx) / (2 * radius * aspect) * r.width, y: r.top + r.height / 2 - (20 - 128 - ty) / (2 * radius) * r.height }; });
  await mobile.touchscreen.tap(touchPoint.x, touchPoint.y);
  await expect(mobile.getByRole('heading', { name: 'Emplacement 140, 20' })).toBeVisible();
  await expect(mobile.locator('.spawn-panel [role=status]').first()).not.toHaveText('Diagnostic du terrain…');
  await expect(mobile.locator('canvas')).toHaveAttribute('data-map-overlay-disk', '1');
  await mobile.getByRole('button', { name: 'Choisir cet emplacement' }).scrollIntoViewIfNeeded();
  await expect(mobile.getByRole('button', { name: 'Choisir cet emplacement' })).toBeVisible();
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.documentElement.scrollTop > 0)).toBe(true);
  await mobile.screenshot({ path: 'test-results/spawn-map-mobile.png', fullPage: true });
  report.touch = true;
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ ...report, errors, result: 'passed' }));
} catch (error) { console.log(JSON.stringify({ ...report, errors, result: 'failed' })); throw error; }
finally { await browser.close(); }
