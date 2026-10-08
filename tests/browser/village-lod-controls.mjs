// DEV settings persistence and actual instanced barracks LOD; gameplay writes blocked.
// Requires the local lobby/API, world-web on 5174 and the saved profile fixture.
/* global console, window, navigator, structuredClone, performance, HTMLInputElement, Event */
import { chromium, expect as baseExpect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const expect = baseExpect.configure({ timeout: 30000 });
const fixture = JSON.parse(await readFile('test-results/lod-village.json', 'utf8'));
const snapshot = structuredClone(fixture);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], assets = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', r=>{if(r.status()>=400)console.log('HTTP',r.status(),r.url());});
page.on('response', response => { if (response.url().includes('/buildings/university-')) assets.push(response.url()); });
await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
try {
  await page.goto('http://localhost:5173');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).waitFor({timeout:120000});
  await page.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') return route.abort();
    if (route.request().url().split('?')[0].endsWith('/village')) return route.fulfill({ json: snapshot });
    return route.continue();
  });

  await page.goto('http://localhost:5174/?world=aube&barracksPreview=1');
  await page.getByTestId('village-canvas').waitFor({timeout:120000});
  await page.getByRole('button',{name:/^DEV/}).click();
  const near=page.getByLabel('Seuil LOD proche'),far=page.getByLabel('Seuil LOD lointain');
  await near.fill('60');await far.fill('35');
  expect(await page.evaluate(async()=> (await import('/src/scene/building-lod-settings.ts')).getBuildingLodSettings())).toEqual({near:60,far:35});
  await page.screenshot({path:'test-results/lod-general-controls.png'});
  await page.reload();await page.getByTestId('village-canvas').waitFor({timeout:120000});
  await page.getByRole('button',{name:/^DEV/}).click();
  await expect(near).toHaveValue('60');await expect(far).toHaveValue('35');
  await page.getByRole('button',{name:'Rétablir les seuils LOD'}).click();
  await expect(near).toHaveValue('45');await expect(far).toHaveValue('28');
  await page.getByRole('button',{name:/^DEV/}).click();
  await page.getByRole('button',{name:'Vue libre',exact:true}).click();
  await page.locator('[aria-label="Moment du cycle solaire"]').evaluate(input=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'540');
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForFunction(async()=>{
    const url=performance.getEntriesByType('resource').map(r=>r.name).find(name=>name.includes('/@babylonjs_core_Engines_engine.js'));
    if(!url)return false;
    const {Engine}=await import(url),scene=Engine.Instances.flatMap(e=>e.scenes).find(s=>s.getMeshByName('dev-barracks-preview'));
    if(!scene)return false;
    window.barracksAudit={scene,radius:25};
    scene.onBeforeRenderObservable.add(()=>{const a=window.barracksAudit,c=scene.activeCamera;c.target.copyFrom(scene.getMeshByName('dev-barracks-preview').position);Object.assign(c,{radius:a.radius,alpha:-.67,beta:.8,fov:.523,inertialRadiusOffset:0});});
    return true;
  },null,{timeout:120000});
  const states=[];
  for(const [radius,level] of [[25,'detailed'],[48,'peripheral'],[105,'distant']]){
    await page.evaluate(radius=>window.barracksAudit.radius=radius,radius);
    await expect.poll(()=>page.evaluate(()=>window.barracksAudit.scene.getMeshByName('dev-barracks-preview').metadata.buildingLod.active)).toBe(level);
    states.push(await page.evaluate(()=>{const r=window.barracksAudit.scene.getMeshByName('dev-barracks-preview');return {lod:r.metadata.buildingLod,vertices:r.getChildMeshes().filter(m=>m.isEnabled()).reduce((n,m)=>n+m.getTotalVertices(),0)};}));
    await page.screenshot({path:`test-results/lod-general-barracks-${level}.png`});
  }
  await writeFile('test-results/lod-general-controls.json',JSON.stringify({settings:true,states,errors},null,2));
  expect(errors).toEqual([]);console.log('LOD settings changed, persisted and restored');
}finally{await page.screenshot({path:'test-results/lod-controls-last.png'}).catch(()=>{});await browser.close();}
