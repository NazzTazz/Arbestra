import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {createDatabase} from '../../apps/api/src/database/connection';
import {testDatabaseUrl} from '../../apps/api/src/database/test-environment';
import {DEVELOPMENT_IDS} from '../../apps/api/src/database/seed';

test('fouille le coffre et ouvre le marché, les ateliers et les connaissances depuis la vue libre',async({page,isMobile},testInfo)=>{
  test.setTimeout(240000);
  const db=createDatabase(testDatabaseUrl()),worldId=randomUUID(),villageId=randomUUID(),slug=`free-view-${randomUUID()}`;
  const buildings=[{id:randomUUID(),type:'town-hall',x:63,y:64,level:2},{id:randomUUID(),type:'sawmill',x:56,y:64,level:1},
    {id:randomUUID(),type:'stonemason',x:72,y:64,level:1},{id:randomUUID(),type:'university',x:64,y:73,level:1}];
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const touch=async(locator:ReturnType<typeof page.getByRole>)=>{if(isMobile)await locator.tap();else await locator.click();};
  try{
    await db.transaction().execute(async tx=>{
      await tx.insertInto('worlds').values({id:worldId,slug,name:'Vue libre',topology:'torus',widthCells:128,heightCells:128,chunkSize:32,seed:1,generationVersion:1,generationStatus:'ready',generatedAt:new Date(),isOpen:false}).execute();
      for(let y=0;y<4;y++)for(let x=0;x<4;x++)await tx.insertInto('worldChunks').values({worldId,chunkX:x,chunkY:y,generationVersion:1,terrainCodes:Array(1024).fill(1),elevations:Array(1024).fill(1)}).execute();
      await tx.insertInto('worldMemberships').values({worldId,accountId:DEVELOPMENT_IDS.account,playerName:'Vue libre'}).execute();
      await tx.insertInto('villages').values({id:villageId,worldId,ownerAccountId:DEVELOPMENT_IDS.account,name:'Vue libre',anchorCellX:64,anchorCellY:64}).execute();
      for(const b of buildings){
        await tx.insertInto('buildings').values({id:b.id,worldId,villageId,buildingType:b.type,level:b.level,status:'completed',completedAt:new Date(),constructionStartedAt:null,constructionCompletesAt:null}).execute();
        const width=b.type==='university'?5:b.type==='stonemason'?2:1,height=b.type==='university'?6:b.type==='stonemason'||b.type==='town-hall'?2:1;
        for(let dy=0;dy<height;dy++)for(let dx=0;dx<width;dx++)await tx.insertInto('worldCellOccupancies').values({worldId,cellX:b.x+dx,cellY:b.y+dy,buildingId:b.id,featureId:null,role:dx===0&&dy===0?'anchor':'extension'}).execute();
      }
      await tx.insertInto('buildingHiddenSupplies').values({worldId,villageId,buildingId:buildings[0]!.id,resourceCode:'carrot',amount:2000,claimedAt:null}).execute();
      await tx.insertInto('villageResources').values(['wood','stone','timber','cut-stone','carrot'].map(resourceCode=>({worldId,villageId,resourceCode,amount:2000}))).onConflict(oc=>oc.columns(['worldId','villageId','resourceCode']).doUpdateSet({amount:2000})).execute();
      await tx.insertInto('villageResourceFlows').values({worldId,villageId,resourceCode:'wood',baseRatePerHour:0,remainder:0,productionUpdatedAt:new Date()}).execute();
      await tx.insertInto('populationCohorts').values({worldId,villageId,originVillageId:villageId,memberCount:15,activity:'idle',energy:10,energyProgress:0,energyUpdatedAt:new Date(),restingSince:null,foodUsedSinceRest:0,harvestId:null,extractionId:null}).execute();
    });
    await page.goto('/');await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');await page.getByLabel('Mot de passe').fill('arbestra');
    await touch(page.getByRole('button',{name:'Se connecter'}));await page.locator(`a[href$="world=${slug}"]`).click();
    const canvas=page.getByTestId('village-canvas');await expect(canvas).toBeVisible({timeout:120000});
    await expect(page.locator('.world-loading')).toBeHidden({timeout:120000});
    await expect(canvas).toHaveAttribute('data-world-interaction-ready','true',{timeout:40000});
    const oracleHint=page.getByRole('button',{name:'Masquer',exact:true});if(await oracleHint.isVisible())await touch(oracleHint);
    await expect(page.getByRole('button',{name:'Vue libre',exact:true})).toHaveAttribute('aria-pressed','true');
    const clickBuilding=async(type:string)=>{
      const building=buildings.find(b=>b.type===type)!,id=building.id;
      // Frame each building using the existing E2E camera hook; selection itself
      // always uses a native click/tap on the rendered canvas, including mobile.
      await canvas.evaluate((el,target)=>el.dispatchEvent(new CustomEvent('terrain-camera',{detail:target})),{cellX:building.x+(type==='university'?2:type==='stonemason'?.5:0),cellY:building.y+(type==='university'?2.5:type==='stonemason'||type==='town-hall'?.5:0),radius:isMobile&&type==='university'?60:30,beta:.35,alpha:-Math.PI/2});
      await canvas.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      await expect.poll(()=>canvas.evaluate((el,id)=>(JSON.parse(el.dataset.buildingScreens??'[]') as Array<{id:string}>).some(b=>b.id===id),id),{timeout:20000}).toBe(true);
      await expect.poll(()=>canvas.evaluate((el,id)=>{const b=(JSON.parse(el.dataset.buildingScreens??'[]') as Array<{id:string;x:number;y:number}>).find(b=>b.id===id);return !!b&&b.x>.05&&b.x<.95;},id),{timeout:20000}).toBe(true);
      const point=await canvas.evaluate((el,{id,type,x,y})=>{
        const ground=type==='stonemason'||type==='university';
        const points=JSON.parse(ground?el.dataset.cellScreens??'[]':el.dataset.buildingScreens??'[]') as Array<{id:string;x:number;y:number}>;
        const b=points.find(b=>b.id===(ground?`${x}:${y+(type==='university'?1:0)}`:id))!,r=el.getBoundingClientRect();return{x:r.x+r.width*b.x,y:r.y+r.height*b.y};
      },{id,type,x:building.x,y:building.y});
      const viewport=page.viewportSize()!;
      expect(point.x).toBeGreaterThan(0);expect(point.x).toBeLessThan(viewport.width);
      expect(point.y).toBeGreaterThan(0);expect(point.y).toBeLessThan(viewport.height-60);
      if(isMobile)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
    };
    await clickBuilding('town-hall');await expect(page.getByRole('region',{name:'Place de marché'})).toBeVisible();
    await touch(page.getByText('Hôtel de ville et réserves',{exact:true}));
    await touch(page.getByRole('button',{name:'Fouiller les réserves',exact:true}));
    await expect(page.getByLabel('4 000 carottes')).toBeVisible({timeout:20000});
    expect(Number((await db.selectFrom('villageResources').select('amount').where('worldId','=',worldId).where('villageId','=',villageId).where('resourceCode','=','carrot').executeTakeFirstOrThrow()).amount)).toBe(4000);
    expect((await db.selectFrom('buildingHiddenSupplies').select('claimedAt').where('worldId','=',worldId).where('buildingId','=',buildings[0]!.id).executeTakeFirstOrThrow()).claimedAt).not.toBeNull();
    expect(await db.selectFrom('villageAccomplishments').select('code').where('worldId','=',worldId).where('villageId','=',villageId).where('code','=','town-hall-supplies').execute()).toHaveLength(1);
    await expect(page.getByRole('button',{name:'Fouiller les réserves',exact:true})).toHaveCount(0);
    await page.keyboard.press('Escape');
    for(const [type,output] of [['sawmill','bois d’œuvre'],['stonemason','pierres taillées']]){
      await clickBuilding(type);
      const panel=page.getByRole('region',{name:'Fabrication de matières'});await expect(panel).toContainText(new RegExp(output,'i'));
      await expect(panel.getByRole('button',{name:'Produire',exact:true})).toBeEnabled();await page.keyboard.press('Escape');
    }
    await clickBuilding('university');
    const science=page.getByRole('dialog',{name:'Arbre des connaissances'});await expect(science).toBeVisible();await expect(science).toContainText('Mathématiques');
    await expect(page.locator('.population-toolbar')).toHaveCount(0);
    await page.screenshot({path:testInfo.outputPath('free-view-science.png')});
    await touch(science.getByRole('button',{name:'Fermer les connaissances'}));await expect(science).not.toBeVisible();
    await clickBuilding('town-hall');await expect(page.getByRole('region',{name:'Place de marché'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Vue libre',exact:true})).toHaveAttribute('aria-pressed','true');
    expect(errors).toEqual([]);
  }finally{
    await page.close().catch(()=>{});
    await db.deleteFrom('populationCohorts').where('worldId','=',worldId).execute();
    await db.deleteFrom('worlds').where('id','=',worldId).execute();await db.destroy();
  }
});
