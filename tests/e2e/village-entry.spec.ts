import {expect,test} from '@playwright/test';

test('entre directement dans le village et ne rejoue pas le survol après rechargement',async({page})=>{
  test.setTimeout(180000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const intro={seen:false};Object.assign(window,{entryIntro:intro});
    new MutationObserver(()=>{
      const canvas=document.querySelector<HTMLElement>('[data-testid="village-canvas"]');
      if(canvas?.dataset.flyover||canvas?.dataset.viewMode==='world'||document.querySelector('.village-arrival'))intro.seen=true;
    }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-flyover','data-view-mode']});
  });
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button',{name:'Se connecter'}).click();
  const href=await page.getByRole('link',{name:/Monde de l'Aube/}).getAttribute('href');
  const world=new URL(href!,page.url());world.searchParams.set('terrainPerf','1');await page.goto(world.href);
  for(let visit=0;visit<2;visit++){
    if(visit)await page.reload();
    const canvas=page.getByTestId('village-canvas');
    await expect(canvas).toHaveAttribute('data-terrain-streaming',/"frameP95"/,{timeout:60000});
    await page.waitForTimeout(3000);
    await expect(canvas).toHaveAttribute('data-view-mode','village');
    await expect(page.getByRole('button',{name:'Passer',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>(window as unknown as {entryIntro:{seen:boolean}}).entryIntro.seen)).toBe(false);
  }
  expect(errors).toEqual([]);
});
