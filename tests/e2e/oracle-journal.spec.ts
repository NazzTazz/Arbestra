import { expect, test, type Page } from '@playwright/test';

import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { createDatabase } from '../../apps/api/src/database/connection';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { DEVELOPMENT_IDS } from '../../apps/api/src/database/seed';
import { ORACLE_HINT } from '../../apps/world-web/src/ui/oracle-hint';

test.setTimeout(90_000);
test.beforeEach(() => resetE2eState());

async function enterWorld(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  await expect(page.getByTestId('village-canvas')).toBeVisible({ timeout: 15_000 });
}

async function openTownHall(page: Page, isMobile: boolean): Promise<void> {
  const canvas = page.getByTestId('village-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not laid out');
  const offsets: Array<{ x: number; y: number; distance: number }> = [];
  for (let y = -140; y <= 140; y += 20) for (let x = -180; x <= 180; x += 20)
    offsets.push({ x, y, distance: Math.hypot(x, y) });
  offsets.sort((left, right) => left.distance - right.distance);
  const action = page.getByRole('button', { name: 'Fouiller les réserves' });
  for (const offset of offsets) {
    const x = box.x + box.width / 2 + offset.x, y = box.y + box.height / 2 + offset.y;
    if (isMobile) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    if (await action.isVisible()) return;
  }
  throw new Error("L'Hôtel de ville n'a pas été trouvé dans la zone centrale");
}

test('le coffre écrit une fois dans le grimoire et reste visible après rechargement', async ({ page, context, isMobile }) => {
  await enterWorld(page);
  await page.getByRole('button', { name: "Ouvrir le grimoire de l'Oracle" }).click();
  await expect(page.getByText('Le grimoire ne porte encore aucune trace.')).toBeVisible();
  await page.getByTestId('village-canvas').click({ position: { x: 5, y: 60 } });

  const otherTab = await context.newPage();
  await otherTab.goto('http://localhost:5274/?world=aube');
  await expect(otherTab.getByTestId('village-canvas')).toBeVisible({ timeout: 15_000 });

  await page.bringToFront();
  await openTownHall(page, isMobile);
  await page.getByRole('button', { name: 'Fouiller les réserves' }).click();
  await expect(page.getByText("Oracle — Un coffre, 2 000 carottes, et personne n'avait regardé. Admirable.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('2 050 carottes')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: "Ouvrir le grimoire de l'Oracle" }).click();
  await expect(page.getByText('Les anciennes réserves')).toBeVisible();
  await expect(page.getByText("2 000 carottes découvertes dans l'Hôtel de ville.")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('village-canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: "Ouvrir le grimoire de l'Oracle" }).locator('small')).toHaveText('1');
  await page.getByRole('button', { name: "Ouvrir le grimoire de l'Oracle" }).click();
  await expect(page.getByText('Les anciennes réserves')).toBeVisible();

  await otherTab.bringToFront();
  await otherTab.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(otherTab.getByRole('button', { name: "Ouvrir le grimoire de l'Oracle" }).locator('small')).toHaveText('1');
  await otherTab.getByRole('button', { name: "Ouvrir le grimoire de l'Oracle" }).click();
  await expect(otherTab.getByText('Les anciennes réserves')).toBeVisible();
});

test('un accomplissement ancien reste silencieux et le grimoire se commande au clavier', async ({ page }) => {
  const db = createDatabase(testDatabaseUrl());
  const completedAt = new Date('2026-09-05T12:34:56.000Z');
  try {
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('buildingHiddenSupplies').set({ claimedAt: completedAt })
        .where('worldId', '=', DEVELOPMENT_IDS.world).where('buildingId', '=', DEVELOPMENT_IDS.townHall).execute();
      await tx.insertInto('villageAccomplishments').values({ worldId: DEVELOPMENT_IDS.world,
        villageId: DEVELOPMENT_IDS.village, code: 'town-hall-supplies', completedAt }).execute();
    });
  } finally { await db.destroy(); }
  // Observe even transient announcements from before React mounts.
  await page.addInitScript(() => {
    const observed: string[] = [];
    Object.assign(window, { oracleAnnouncements: observed });
    new MutationObserver(() => {
      document.querySelectorAll('.game-notification').forEach((item) => observed.push(item.textContent ?? ''));
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await enterWorld(page);
  const journal = page.getByRole('button', { name: "Ouvrir le grimoire de l'Oracle" });
  for (let step = 0; step < 12 && !await journal.evaluate((button) => button === document.activeElement); step++)
    await page.keyboard.press('Tab');
  await expect(journal).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Les anciennes réserves')).toBeVisible();
  await expect(page.locator('.oracle-journal time')).toHaveAttribute('datetime', completedAt.toISOString());
  await expect(page.getByLabel('50 carottes')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.oracle-journal')).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Les anciennes réserves')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { oracleAnnouncements: string[] }).oracleAnnouncements))
    .not.toEqual(expect.arrayContaining([expect.stringContaining('Oracle — Un coffre')]));
});

test('l’indice attend la découverte libre et ne revient pas après F5', async ({ page }) => {
  const origin = new Date('2026-09-07T00:00:00Z');
  await page.clock.install({ time: origin });
  await enterWorld(page);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
  await page.getByRole('button', { name: "Ouvrir le grimoire de l'Oracle" }).click();
  await page.clock.fastForward(80_000);
  await expect(page.getByText(ORACLE_HINT)).toBeHidden();
  await page.clock.fastForward(10_000);
  await expect(page.getByText(ORACLE_HINT)).toBeVisible();
  await expect(page.getByText('Le grimoire ne porte encore aucune trace.')).toBeVisible();
  await page.clock.resume();
  await page.reload();
  await expect(page.getByTestId('village-canvas')).toBeVisible();
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
  await page.clock.fastForward(91_000);
  await expect(page.getByText(ORACLE_HINT)).toBeHidden();
});

test('une action réussie annule l’indice même après rechargement', async ({ page }) => {
  const origin = new Date('2026-09-07T00:00:00Z');
  await page.clock.install({ time: origin });
  await enterWorld(page);
  await page.getByRole('button', { name: 'Gérer les habitants' }).click();
  await page.getByRole('button', { name: 'Envoyer au repos' }).click();
  await expect(page.getByText('1 habitant(s) au repos', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('village-canvas')).toBeVisible();
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
  await page.clock.fastForward(91_000);
  await expect(page.getByText(ORACLE_HINT)).toBeHidden();
});
