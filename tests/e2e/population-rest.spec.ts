import { expect, test } from '@playwright/test';
import { createDatabase } from '../../apps/api/src/database/connection';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { DEVELOPMENT_IDS } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';

test.setTimeout(60_000);

test('un repos court rend les habitants disponibles sans attendre cinq heures', async ({ page }) => {
  await resetE2eState();
  const db = createDatabase(testDatabaseUrl());
  try {
    await db.updateTable('populationCohorts').set({ energy: 9, energyProgress: 79_000_000,
      foodUsedSinceRest: 2, energyUpdatedAt: new Date() })
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village).execute();
    await page.goto('/');
    await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
    await page.getByLabel('Mot de passe').fill('arbestra');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
    await page.getByRole('button', { name: 'Gérer les habitants' }).click();
    await page.getByRole('button', { name: 'Envoyer au repos' }).click();
    await expect(page.getByText('14 disponibles · 0 au travail · 1 au repos')).toBeVisible();
    await expect(page.getByText('15 disponibles · 0 au travail · 0 au repos')).toBeVisible({ timeout: 25_000 });
    const cohorts = await db.selectFrom('populationCohorts').select(['foodUsedSinceRest']).where('worldId', '=', DEVELOPMENT_IDS.world)
      .where('villageId', '=', DEVELOPMENT_IDS.village).execute();
    expect(cohorts.every((cohort) => cohort.foodUsedSinceRest === 2)).toBe(true);
  } finally { await db.destroy(); }
});
