import { expect, test } from '@playwright/test';

test('le zoom rapproche la caméra du plan du sol', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  const canvas = page.getByTestId('village-canvas');
  await expect(canvas).toBeVisible({ timeout: 40_000 });
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  for (let step = 0; step < 8; step++) await page.mouse.wheel(0, -1_000);
  await expect.poll(() => canvas.evaluate((element) =>
    (JSON.parse(element.dataset.camera ?? '[]') as number[])[2] ?? Infinity)).toBeLessThan(20);
  await expect.poll(() => canvas.evaluate((element) =>
    (JSON.parse(element.dataset.cameraLimits ?? '[]') as number[])[1] ?? 0)).toBeGreaterThan(1.2);
  await page.screenshot({ path: 'test-results/camera-angle.png' });
});
