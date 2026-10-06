import { expect, test } from '@playwright/test';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';

test('le showroom expose directement les trois maisons et leurs matières', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await resetE2eState();
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).click();
  await expect(page.getByTestId('village-canvas')).toBeVisible({timeout:40_000});
  await page.getByRole('button',{name:'Vue libre',exact:true}).click();
  await page.getByRole('button',{name:'Constructions',exact:true}).click();
  const showroom=page.getByRole('region',{name:'Modèles · Habitat'});
  await expect(showroom).toBeVisible();
  await expect(page.getByRole('group',{name:'Matériau des maisons'})).toHaveCount(0);
  const variants=[
    {name:'Maison en troncs',cost:'25 bois brut'},
    {name:'Maison en madriers',cost:'25 bois d’œuvre'},
    {name:'Maison en pierre',cost:'25 bois d’œuvre'},
  ];
  for(const variant of variants){
    const card=showroom.getByRole('button',{name:variant.name,exact:true});
    await expect(card).toBeVisible();await expect(card).toContainText(variant.cost);
    await card.click();await expect(card).toHaveAttribute('aria-pressed','true');
    const feedback=page.getByRole('complementary',{name:'Action de construction'});
    await expect(feedback).toContainText(variant.name);await expect(feedback).toContainText(variant.cost);
  }
  await expect(showroom.getByRole('button',{name:'Maison en pierre',exact:true})).toContainText('10 pierre taillée');
  await expect(showroom.getByRole('button',{name:'Maison en troncs',exact:true})).not.toContainText('bois d’œuvre');
  await page.screenshot({path:testInfo.outputPath('house-showroom.png')});
  expect(errors).toEqual([]);
});
