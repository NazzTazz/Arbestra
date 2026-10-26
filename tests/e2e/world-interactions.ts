import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDatabase } from '../../apps/api/src/database/connection';
import { DEVELOPMENT_IDS } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';

// The dev client reveals a village only after its modules, terrain, routes and
// first frame: 20 to 40 s, more on a busy machine. Each load gets this budget
// on top of the test's own, so a slow start never eats the scenario's time.
const VILLAGE_LOAD_MS = 120_000;

/** Waits for the village behind the loading screen (first open or reload). */
export async function waitForVillage(target: Page | Locator) {
  const canvas = 'goto' in target ? target.getByTestId('village-canvas') : target;
  const info = test.info();
  info.setTimeout(info.timeout + VILLAGE_LOAD_MS);
  await expect(canvas).toBeVisible({ timeout: VILLAGE_LOAD_MS });
  return canvas;
}

/** The mode bar shows only the active mode until that mode is pressed again. */
export async function chooseMode(
  page: Page,
  label: 'Vue libre' | 'Constructions' | 'Population' | 'Exploitation',
  isMobile = false,
) {
  const bar = page.getByRole('navigation', { name: 'Modes du monde' });
  const press = (name: string) => {
    const button = bar.getByRole('button', { name, exact: true });
    return isMobile ? button.tap() : button.click();
  };
  if (await bar.evaluate((element) => element.classList.contains('is-minimal'))) {
    await press((await bar.getByRole('button').first().locator('b').textContent())!);
  }
  if ((await bar.getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed')) !== 'true')
    await press(label);
}

/** Checks a developer-drawer option (« Chemins et transports », « Laboratoire cosmologique »…). */
export async function devOption(page: Page, label: string, checked = true) {
  const drawer = page.getByRole('complementary', { name: 'Outils développeur' });
  if (!(await drawer.locator('.dev-drawer').count())) await page.getByRole('button', { name: 'DEV' }).click();
  await drawer.getByRole('checkbox', { name: label }).setChecked(checked);
}

const VIEWS = ['village', 'region', 'world'] as const;
/** Village, region and torus follow each other with + and − on the canvas. */
export async function showView(canvas: Locator, view: (typeof VIEWS)[number]) {
  for (let step = 0; step < 4; step++) {
    const current = (await canvas.getAttribute('data-view-mode')) as (typeof VIEWS)[number];
    if (current === view) return;
    await canvas.focus();
    await canvas.press(VIEWS.indexOf(view) > VIEWS.indexOf(current) ? '-' : '+');
    await expect(canvas).not.toHaveAttribute('data-view-mode', current, { timeout: 60_000 });
  }
  await expect(canvas).toHaveAttribute('data-view-mode', view);
}

/** Astronomy 1 reveals the torus; below it the world view stays bounded near
 * the village. The reset keeps science programs: revoke after the test. */
export async function setAstronomy(known: boolean) {
  const db = createDatabase(testDatabaseUrl());
  try {
    const program = db
      .deleteFrom('sciencePrograms')
      .where('worldId', '=', DEVELOPMENT_IDS.world)
      .where('accountId', '=', DEVELOPMENT_IDS.account)
      .where('code', '=', 'astronomy-1');
    await program.execute();
    if (known) {
      await db
        .insertInto('playerScience')
        .values({
          worldId: DEVELOPMENT_IDS.world,
          accountId: DEVELOPMENT_IDS.account,
          observationsSince: null,
          solarReport: null,
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
      await db
        .insertInto('sciencePrograms')
        .values({
          worldId: DEVELOPMENT_IDS.world,
          accountId: DEVELOPMENT_IDS.account,
          code: 'astronomy-1',
          discipline: 'astronomy',
          level: 1,
          workDoneMs: 0,
          paused: false,
          acquiredAt: new Date(),
          createdAt: new Date(),
          workerCap: 1,
        })
        .execute();
    }
  } finally {
    await db.destroy();
  }
}

/** Region centre within `cells` of a picked "x,y" cell on the development torus (2048 × 1024). */
export async function regionNear(canvas: Locator, picked: string, cells = 64) {
  const target = await canvas.getAttribute('data-view-target');
  if (!target) return false;
  const [x, y] = target.split(',').map(Number),
    [px, py] = picked.split(',').map(Number);
  const dx = Math.abs(x! - px!),
    dy = Math.abs(y! - py!);
  return Math.min(dx, 2048 - dx) <= cells && Math.min(dy, 1024 - dy) <= cells;
}

export async function openVillage(page: Page, email = 'player@arbestra.local') {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  return waitForVillage(page);
}

export async function cellPoint(page: Page, cell: { cellX: number; cellY: number }) {
  const canvas = page.getByTestId('village-canvas');
  const id = `${cell.cellX}:${cell.cellY}`;
  await expect
    .poll(async () =>
      canvas.evaluate((element, key) => {
        const positions = JSON.parse(element.dataset.cellScreens ?? '[]') as Array<{ id: string }>;
        return positions.some((position) => position.id === key);
      }, id),
    )
    .toBe(true);
  const point = await canvas.evaluate((element, key) => {
    const positions = JSON.parse(element.dataset.cellScreens!) as Array<{ id: string; x: number; y: number }>;
    const position = positions.find((item) => item.id === key)!;
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width * position.x, y: box.y + box.height * position.y };
  }, id);
  const viewport = page.viewportSize()!;
  expect(point.x).toBeGreaterThan(0);
  expect(point.x).toBeLessThan(viewport.width);
  expect(point.y).toBeGreaterThan(40);
  expect(point.y).toBeLessThan(viewport.height);
  return point;
}

export async function clickCell(page: Page, cell: { cellX: number; cellY: number }, isMobile: boolean) {
  const point = await cellPoint(page, cell);
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

export async function selectRectangle(
  page: Page,
  first: { cellX: number; cellY: number },
  last: { cellX: number; cellY: number },
  isMobile: boolean,
) {
  const a = await cellPoint(page, first),
    b = await cellPoint(page, last);
  if (isMobile) {
    await page.touchscreen.tap(a.x, a.y);
    await page.touchscreen.tap(b.x, b.y);
  } else {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 2 });
    await page.mouse.up();
  }
}
