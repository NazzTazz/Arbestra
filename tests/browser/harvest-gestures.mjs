// UI integration: actual App and harvest hook, scene gestures stubbed, API held.
// Does not mutate a world and does not certify Babylon picking or economics.
/* global process,console,URL,getComputedStyle */
import {chromium,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const url=new URL(process.env.RC1_BROWSER_URL??'http://localhost:5279/');
if(url.hostname!=='localhost')throw Error('Local UI fixture only');
const snapshot=JSON.parse(readFileSync(process.env.RC1_BROWSER_SNAPSHOT??'test-results/player-state.json','utf8'));
const targets=['wood','stone'].map(resource=>snapshot.region.features.filter(f=>f.deposit?.resourceCode===resource).sort((a,b)=>Math.hypot(a.cellX-snapshot.village.anchorCellX,a.cellY-snapshot.village.anchorCellY)-Math.hypot(b.cellX-snapshot.village.anchorCellX,b.cellY-snapshot.village.anchorCellY))[0]);
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1280,height:900}}),commands=[],errors=[],receipts=new Map(),focuses=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.exposeFunction('recordExploitationFocus',cell=>focuses.push(cell));
 await page.route('**/src/scene/VillageScene.tsx*',r=>r.fulfill({contentType:'application/javascript',body:`
 import React from '/node_modules/.vite/deps/react.js';
 export function VillageScene(p){const targets=${JSON.stringify(targets)};React.useImperativeHandle(p.terrainRef,()=>({selectRepresentative:()=>{},resetCosmology:()=>{},ready:()=>true,cancelGesture:()=>{},setWorldMode:()=>{},showVillage:()=>{},viewCenter:()=>({cellX:p.state.village.anchorCellX,cellY:p.state.village.anchorCellY}),naturalFeatures:()=>targets,focusCell:cell=>window.recordExploitationFocus(cell),featuresAt:cell=>targets.filter(f=>f.cellX===cell.cellX&&f.cellY===cell.cellY),projectCell:cell=>({x:cell.cellX===targets[0].cellX?450:750,y:350})}));
 return React.createElement('div',{style:{padding:180,color:'white',background:'#172013',height:600}},targets.map(t=>React.createElement('button',{key:t.id,'data-resource':t.deposit.resourceCode,onPointerMove:e=>p.onGardenHarvest(t,true,true),onPointerDown:e=>p.onGardenHarvest(t,true),onPointerUp:e=>p.onGardenHarvest(null,false)},t.deposit.resourceCode)));}
 `}));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;if(!path.startsWith('/api/'))return route.continue();
  if(path.endsWith('/harvest-intents')&&route.request().method()==='GET'){const ids=new URL(route.request().url()).searchParams.get('ids').split(',');return route.fulfill({json:ids.map(id=>receipts.get(id)??{commandId:id,pending:true,accepted:[],refused:[]})});}
  if(path.endsWith('/harvest-intents')){commands.push({body:route.request().postDataJSON(),route});return;}
  if(path.endsWith('/village'))return route.fulfill({json:snapshot});
  if(route.request().method()!=='GET')throw Error('Unexpected mutation or preview: '+path);
  return route.fulfill({json:{}});
 });
 url.pathname='/';url.searchParams.set('world',snapshot.world.slug);await page.goto(url.href);
 await page.getByRole('button',{name:'Vue libre',exact:true}).click();
 await page.getByRole('button',{name:'Exploitation',exact:true}).click();
 await expect(page.getByLabel('Récolte',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Palette d’exploitation')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Tout',exact:true})).toHaveCount(0);
 await expect(page.getByText('Clic gauche + glisser pour récolter · Maj + clic pour inspecter')).toHaveCount(0);
 await page.getByRole('button',{name:'Bois brut',exact:true}).click();
 await expect.poll(()=>focuses.length).toBe(1);expect(focuses[0]).toEqual({cellX:targets[0].cellX,cellY:targets[0].cellY});expect(commands).toHaveLength(0);
 const wood=page.locator('[data-resource=wood]'),stone=page.locator('[data-resource=stone]');
 await wood.hover();await page.waitForTimeout(200);expect(commands).toHaveLength(0);
 await wood.click();await expect.poll(()=>commands.length).toBe(1);expect(commands[0].body.wood).toEqual([targets[0].id]);
 expect(commands[0].body).not.toHaveProperty('workerCap');
 // While the first response is held, a second gesture is retained, no form blocks it.
 await page.getByRole('button',{name:'Pierre brute',exact:true}).click();
 await stone.click();expect(commands).toHaveLength(1);
 const ack=(entry,target)=>entry.route.fulfill({json:{commandId:entry.body.commandId,accepted:[{key:target.id,cellX:target.cellX,cellY:target.cellY,resource:target.deposit.resourceCode,amount:100}],refused:[]}});
 await commands[0].route.fulfill({json:{commandId:commands[0].body.commandId,pending:true,accepted:[],refused:[]}});
 await expect.poll(()=>commands.length).toBe(2);
 await commands[1].route.fulfill({json:{commandId:commands[1].body.commandId,pending:true,accepted:[],refused:[]}});
 expect(await page.locator('.harvest-feedback span').count()).toBe(0);
 for(let i=0;i<2;i++)receipts.set(commands[i].body.commandId,{commandId:commands[i].body.commandId,accepted:[{key:targets[i].id,cellX:targets[i].cellX,cellY:targets[i].cellY,resource:targets[i].deposit.resourceCode,amount:100}],refused:[]});
 await expect(page.locator('.harvest-feedback--wood')).toHaveText('+100');await expect(page.locator('.harvest-feedback--stone')).toHaveText('+100');
 await page.screenshot({path:'test-results/harvest-feedback.png'});
 expect(await page.locator('.harvest-feedback--wood').evaluate(e=>getComputedStyle(e).webkitTextStrokeWidth)).toBe('1px');
 // An uncertain response is retried with exactly the same identity after reload.
 await page.getByRole('button',{name:'Bois brut',exact:true}).click();
 await wood.click();await expect.poll(()=>commands.length).toBe(3);const uncertain=commands[2].body;
 await commands[2].route.abort('failed');await page.reload();await expect.poll(()=>commands.length,{timeout:15000}).toBe(4);
 expect(commands[3].body).toEqual(uncertain);await ack(commands[3],targets[0]);
 await page.getByRole('button',{name:'Vue libre',exact:true}).click();
 await page.getByRole('button',{name:'Exploitation',exact:true}).click();
 await page.getByRole('button',{name:'Artisanat',exact:true}).click();
 await expect(page.getByRole('button',{name:'Scierie',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Tailleur de pierre',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Bois brut',exact:true})).toHaveCount(0);
 await wood.click();expect(commands).toHaveLength(4);
 // Returning from craft must show the resource filter that will execute.
 await page.getByRole('button',{name:'Exploiter',exact:true}).click();
 await page.getByRole('button',{name:'Bois brut',exact:true}).click();
 await page.getByRole('button',{name:'Artisanat',exact:true}).click();
 await page.getByRole('button',{name:'Scierie',exact:true}).click();
 await page.getByRole('button',{name:'Exploiter',exact:true}).click();
 await expect(page.getByRole('button',{name:'Bois brut',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.exploitation-showroom button[aria-pressed=true]')).toHaveCount(1);
 await wood.click();await expect.poll(()=>commands.length).toBe(5);
 expect(commands[4].body.wood).toEqual([targets[0].id]);await ack(commands[4],targets[0]);
 await page.getByRole('button',{name:'Artisanat',exact:true}).click();
 await expect(page.getByRole('button',{name:'Scierie',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(errors).toEqual([]);console.log(JSON.stringify({hoverCommands:0,gestures:4,categorySelection:true,idempotentRecovery:true,previewRequests:0,forwardedMutations:0,errors}));
 }catch(error){console.log('UI_ERRORS',errors);console.log('BODY',await page.locator('body').innerText());throw error;}finally{await browser.close();}
