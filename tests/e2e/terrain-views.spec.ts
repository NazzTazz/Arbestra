import { expect, test } from '@playwright/test';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';

test.setTimeout(120_000);
test.use({ launchOptions: { args: process.env.TERRAIN_GPU === '1' && process.platform === 'win32' ? ['--use-angle=d3d11'] : [] } });

test('regional zoom stops detailed requests and the real wheel reaches the torus', async ({ page }) => {
  await resetE2eState();
  const details: string[] = [];
  page.on('request', request => { if (/\/terrain(?:\/updates)?\?chunks=/.test(request.url())) details.push(request.url()); });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  const canvas = page.getByTestId('village-canvas');
  await expect(canvas).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: /Explorer la/ }).click();
  await expect(canvas).toHaveAttribute('data-view-mode', 'region');
  await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-terrain-streaming') ?? '{}').overview, { timeout: 40_000 }).toBe(true);
  const settled = details.length;
  await page.waitForTimeout(6500);
  expect.soft(details.slice(settled), 'regional view must not refresh or download detailed chunks').toEqual([]);
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .45);
  for (let notch = 0; notch < 70 && await canvas.getAttribute('data-view-mode') !== 'world'; notch++) {
    await page.mouse.wheel(0, 120); await page.waitForTimeout(60);
  }
  await expect(canvas).toHaveAttribute('data-view-mode', 'world', { timeout: 15_000 });
  await expect(canvas).toHaveAttribute('data-cloud-cover', '0');
  await page.getByRole('button', { name: 'Mon village' }).click();
  await expect(canvas).toHaveAttribute('data-view-mode', 'village');
  await expect(canvas).toHaveAttribute('data-cloud-cover', '0');
  await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-terrain-streaming') ?? '{}').detailPaused).toBe(false);
});

test('wheel at regional limit records world intent while the overview is still loading', async ({ page }) => {
  await resetE2eState();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/terrain/overview', async route => { await held; await route.continue(); });
  try {
    await page.goto('/');
    await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
    await page.getByLabel('Mot de passe').fill('arbestra');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
    const canvas = page.getByTestId('village-canvas');
    await expect(canvas).toBeVisible({ timeout: 40_000 });
    const bounds = (await canvas.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .45);
    await page.mouse.wheel(0, 50_000);
    // Babylon bounds a single wheel impulse; keep scrolling to reach the limit on every viewport.
    for (let notch = 0; notch < 70 && !JSON.parse(await canvas.getAttribute('data-terrain-streaming') ?? '{}').worldRequested; notch++) {
      await page.mouse.wheel(0, 120); await page.waitForTimeout(60);
    }
    await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-terrain-streaming') ?? '{}').worldRequested).toBe(true);
    const waiting = JSON.parse(await canvas.getAttribute('data-terrain-streaming') ?? '{}');
    expect(waiting.overview).toBe(false); expect(waiting.detailPaused).toBe(true);
    release();
    await expect(canvas).toHaveAttribute('data-view-mode', 'world', { timeout: 30_000 });
    await expect(canvas).toHaveAttribute('data-cloud-cover', '0');
  } finally { release(); }
});

test('village, torus et région gardent la cellule choisie et les commandes spatiales au village', async ({ page }, info) => {
  await resetE2eState();
  const errors: string[] = [], overviews: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().endsWith('/terrain/overview')) overviews.push(response.url()); });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();

  const canvas = page.getByTestId('village-canvas');
  await canvas.waitFor({ timeout: 40_000 });
  await expect(canvas).toHaveAttribute('data-view-mode', 'village');
  await expect(page.getByRole('button', { name: /Construire/ })).toBeVisible();
  await page.getByRole('button', { name: /Explorer la/ }).click();
  await expect(canvas).toHaveAttribute('data-view-mode', 'region');
  await expect.poll(async () => Number(await canvas.getAttribute('data-regional-villages')), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: `test-results/lod-region-${info.project.name}.png` });
  await canvas.evaluate(el => {
    const transitions: Array<{ mode: string; cover: number }> = [];
    (el as HTMLElement & { transitions: typeof transitions }).transitions = transitions;
    let mode = el.getAttribute('data-view-mode');
    new MutationObserver(() => {
      const next = el.getAttribute('data-view-mode');
      if (next !== mode) { transitions.push({ mode: next!, cover: Number(el.getAttribute('data-cloud-cover')) }); mode = next; }
    }).observe(el, { attributes: true, attributeFilter: ['data-view-mode'] });
  });
  await page.getByRole('button', { name: 'Monde torique' }).click();
  await expect(canvas).toHaveAttribute('data-view-mode', 'world', { timeout: 60_000 });
  await expect(canvas).toHaveAttribute('data-cloud-cover', '0');
  await expect(page.getByRole('button', { name: /Construire/ })).toHaveCount(0);
  const bounds = (await canvas.boundingBox())!;
  let chosen: string | null = null;
  for (const [x, y] of [[0.5, 0.4], [0.72, 0.68], [0.3, 0.55], [0.5, 0.72]]) {
    await page.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
    chosen = await canvas.getAttribute('data-world-pick');
    if (chosen && chosen !== 'none') break;
  }
  expect(chosen).toMatch(/^\d+,\d+$/);
  expect(chosen).not.toBe('1024,512');
  await page.getByRole('button', { name: /Voir cette/ }).click();
  await expect(canvas).toHaveAttribute('data-view-mode', 'region');
  await expect(canvas).toHaveAttribute('data-cloud-cover', '0');
  await expect.poll(() => canvas.getAttribute('data-view-target')).toBe(chosen);
  await expect(page.getByRole('button', { name: /Construire/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mon village' }).click();
  await expect(canvas).toHaveAttribute('data-view-mode', 'village');
  await expect(page.getByRole('button', { name: /Construire/ })).toBeVisible();
  await page.getByRole('button', { name: 'Monde torique' }).click();
  await expect(canvas).toHaveAttribute('data-view-mode', 'world');
  await expect(canvas).toHaveAttribute('data-cloud-cover', '0');
  const transitions = await canvas.evaluate(el => (el as HTMLElement & { transitions: Array<{ mode: string; cover: number }> }).transitions);
  expect(transitions.filter(t => t.mode === 'world').every(t => t.cover === 1)).toBe(true);
  expect(transitions.find(t => t.mode === 'region')?.cover).toBe(1);
  await page.screenshot({ path: `test-results/lod-surface-${info.project.name}.png` });
  expect(overviews).toHaveLength(1);
  expect(errors).toEqual([]);
});
