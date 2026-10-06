import { expect, test } from '@playwright/test';
import { createDatabase } from '../../apps/api/src/database/connection';
import { resetE2eState } from '../../apps/api/src/database/reset-e2e';
import { DEVELOPMENT_IDS as ids } from '../../apps/api/src/database/seed';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment';
import { getVillageState } from '../../apps/api/src/modules/villages/service';

test('le marché Oracle débloque le niveau 2 et livre des carottes après un troc', async ({page,isMobile},testInfo)=>{
  test.skip(isMobile,'Prototype desktop ; présentation mobile à concevoir.');
  test.setTimeout(300000);
  await resetE2eState();
  const db=createDatabase(testDatabaseUrl()), errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await db.updateTable('villageResources').set({amount:500}).where('villageId','=',ids.village).where('resourceCode','=','timber').execute();
    await db.updateTable('villageResources').set({amount:120}).where('villageId','=',ids.village).where('resourceCode','=','cut-stone').execute();
    await page.goto('/');
    await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
    await page.getByLabel('Mot de passe').fill('arbestra');
    await page.getByRole('button',{name:'Se connecter'}).click();
    await page.getByRole('link',{name:/Monde de l'Aube/}).click();
    const canvas=page.getByTestId('village-canvas');
    await expect(canvas).toBeVisible({timeout:40000});
    await page.getByRole('button',{name:'Vue libre',exact:true}).click();
    await page.getByRole('button',{name:'Exploitation',exact:true}).click();
    await expect(canvas).toHaveAttribute('data-world-interaction-ready','true',{timeout:40000});
    await expect.poll(()=>canvas.evaluate((element,id)=>{
      const points=JSON.parse(element.dataset.buildingScreens??'[]') as Array<{id:string}>;
      return points.some(p=>p.id===id);
    },ids.townHall),{timeout:30000}).toBe(true);
    const roof=await canvas.evaluate((element,id)=>{
      const point=(JSON.parse(element.dataset.buildingScreens??'[]') as Array<{id:string;x:number;y:number}>).find(p=>p.id===id)!;
      const box=element.getBoundingClientRect();
      return {x:box.x+box.width*point.x,y:box.y+box.height*point.y};
    },ids.townHall);
    await page.screenshot({path:testInfo.outputPath('oracle-market-before-click.png')});
    await page.mouse.click(roof.x,roof.y);
    const panel=page.getByRole('region',{name:'Place de marché'});
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('500 bois d’œuvre + 120 pierres taillées');
    await panel.getByRole('button',{name:'Améliorer l’hôtel de ville'}).click();
    await expect(panel.getByLabel('Ressource offerte')).toBeVisible({timeout:30000});
    expect((await getVillageState(db,ids.account,'aube')).village.population.housingCapacity).toBe(30);
    await panel.getByLabel('Ressource demandée').selectOption('carrot');
    await panel.getByLabel('Quantité offerte').fill('100');
    await expect(panel.getByRole('status')).toContainText('280 Carottes');
    const confirmation=page.waitForResponse(response=>response.url().endsWith(`/villages/${ids.village}/market`)&&response.request().method()==='POST',{timeout:60000});
    await panel.getByRole('button',{name:'Confirmer le troc',exact:true}).click();
    expect((await confirmation).status()).toBe(200);
    await expect(panel).toContainText('En livraison',{timeout:30000});
    expect(Number((await db.selectFrom('villageResources').select('amount').where('villageId','=',ids.village).where('resourceCode','=','carrot').executeTakeFirstOrThrow()).amount)).toBe(50);
    expect(Number((await db.selectFrom('villageResources').select('amount').where('villageId','=',ids.village).where('resourceCode','=','wood').executeTakeFirstOrThrow()).amount)).toBe(1900);
    await page.screenshot({path:testInfo.outputPath('oracle-market-pending.png')});
    // Accelerate the already-frozen deadline only on the isolated test database.
    const deliveredAt=new Date(Date.now()-1000);
    await db.updateTable('marketExchanges').set({startedAt:new Date(deliveredAt.getTime()-600000),completesAt:deliveredAt})
      .where('worldId','=',ids.world).where('villageId','=',ids.village).where('completedAt','is',null).execute();
    await expect(panel).toContainText('Livré',{timeout:30000});
    expect(Number((await db.selectFrom('villageResources').select('amount').where('villageId','=',ids.village).where('resourceCode','=','carrot').executeTakeFirstOrThrow()).amount)).toBe(330);
    await panel.getByLabel('Ressource offerte').selectOption('carrot');
    await panel.getByLabel('Ressource demandée').selectOption('stone');
    await panel.getByLabel('Quantité offerte').fill('40');
    await expect(panel.getByRole('status')).toContainText('7 Pierre brute');
    await page.screenshot({path:testInfo.outputPath('oracle-market-delivered.png')});
    expect(errors).toEqual([]);
  } finally {await db.destroy();}
});
