import { expect, test } from '@playwright/test';
import { createDatabase } from '../../apps/api/src/database/connection';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { DEVELOPMENT_IDS as ids } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { constructBuilding, getVillageState } from '../../apps/api/src/modules/villages/service';

test('le tailleur est inspectable en Exploitation et transforme un lot après sa pause', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Picking du toit vérifié avec le cadrage desktop.');
  test.setTimeout(150_000);
  const browserErrors:string[]=[];
  page.on('pageerror',error=>browserErrors.push(error.message));
  await resetE2eState();
  const db = createDatabase(testDatabaseUrl());
  try {
    await db.updateTable('villageResources').set({ amount: 100 }).where('worldId', '=', ids.world)
      .where('villageId', '=', ids.village).where('resourceCode', '=', 'stone').execute();
    const state = await getVillageState(db, ids.account, 'aube', ids.village);
    const free = new Set(state.cells.filter(cell => cell.canBuild).map(cell => `${cell.cellX}:${cell.cellY}`));
    const anchor = state.cells.filter(cell => [0, 1].every(dx => [0, 1].every(dy => free.has(`${cell.cellX + dx}:${cell.cellY + dy}`))))
      .sort((a, b) => Math.hypot(a.cellX - 1024, a.cellY - 512) - Math.hypot(b.cellX - 1024, b.cellY - 512))[0]!;
    await constructBuilding(db, ids.account, 'aube', ids.village, anchor.cellX, anchor.cellY, 'stonemason', 0);
    await db.updateTable('villageResources').set({ amount: 25 }).where('worldId', '=', ids.world)
      .where('villageId', '=', ids.village).where('resourceCode', '=', 'stone').execute();
    await page.goto('/');
    await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
    await page.getByLabel('Mot de passe').fill('arbestra');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
    const canvas = page.getByTestId('village-canvas');
    await expect(canvas).toBeVisible({ timeout: 40_000 });
    await page.getByRole('button', { name: 'Vue libre', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Exploitation', exact: true })).toBeEnabled({ timeout: 40_000 });
    await page.getByRole('button', { name: 'Exploitation', exact: true }).click();
    const cells = [0, 1].flatMap(dx => [0, 1].map(dy => `${anchor.cellX + dx}:${anchor.cellY + dy}`));
    await expect.poll(() => canvas.evaluate((element, ids) => {
      const points = JSON.parse(element.dataset.cellScreens ?? '[]') as Array<{ id: string }>;
      return ids.every(id => points.some(point => point.id === id));
    }, cells), { timeout: 30_000 }).toBe(true);
    const roof = await canvas.evaluate((element, ids) => {
      const points = (JSON.parse(element.dataset.cellScreens ?? '[]') as Array<{ id: string; x: number; y: number }>).filter(point => ids.includes(point.id));
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width * points.reduce((sum, point) => sum + point.x, 0) / 4,
        y: box.y + box.height * (points.reduce((sum, point) => sum + point.y, 0) / 4 - .165) };
    }, cells);
    // Clic ordinaire sur le toit visible au-dessus de la palette, sans Maj.
    await page.mouse.click(roof.x, roof.y);
    const panel = page.getByRole('region', { name: 'Fabrication de matières' });
    await expect(panel).toBeVisible();
    await panel.getByLabel('Nombre de lots').fill('2');
    await expect(panel.getByRole('button', { name: 'Fabriquer', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: 'Fabriquer', exact: true }).click();
    await panel.getByRole('button', { name: 'Pause après ce lot', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('Pause après ce lot');
    expect(Number((await db.selectFrom('villageResources').select('amount').where('villageId', '=', ids.village)
      .where('resourceCode', '=', 'stone').executeTakeFirstOrThrow()).amount)).toBe(0);
    // Échéance accélérée uniquement dans la base de test ; le rendement reste réel.
    await db.updateTable('processingLots').set({ completesAt: new Date(Date.now()-1000) })
      .where('worldId', '=', ids.world).where('villageId', '=', ids.village).where('completedAt', 'is', null).execute();
    await expect(panel).toContainText('En pause · 1/2 lots achevés', { timeout: 15_000 });
    await expect(panel.getByRole('button', { name: 'Reprendre', exact: true })).toBeDisabled();
    expect(Number((await db.selectFrom('villageResources').select('amount').where('villageId', '=', ids.village)
      .where('resourceCode', '=', 'cut-stone').executeTakeFirstOrThrow()).amount)).toBe(20);
    expect(browserErrors).toEqual([]);
  } finally { await db.destroy(); }
});
