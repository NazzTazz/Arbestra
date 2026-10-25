import { expect, test, type Locator, type Page } from '@playwright/test';

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
