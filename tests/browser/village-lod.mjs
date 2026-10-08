// Production browser regression. GET snapshots are mocked; gameplay writes are blocked.
// Requires the local lobby/API and village-lod-server.mjs on 5189, plus a profile fixture.
/* global console, window, navigator, structuredClone, HTMLInputElement, Event, performance, process */
import { chromium, expect as baseExpect } from '@playwright/test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
const expect = baseExpect.configure({ timeout: 30000 });
const fixture = JSON.parse(await readFile('test-results/lod-village.json', 'utf8'));
let snapshot = structuredClone(fixture);
const campusId = fixture.cells.find(c => c.building?.type === 'university').building.id;
const file = (await readdir('apps/world-web/dist/assets')).find(f => f.startsWith('infrastructure-factory-') && f.endsWith('.js'));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], assets = [], report = {};
const reportFile=process.argv.includes('--families-only')?'test-results/lod-general-families.json':'test-results/lod-browser.json';
page.on('pageerror', e => errors.push(e.message));
page.on('response', response => { if (response.url().includes('/buildings/university-')) assets.push(response.url()); });
await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
try {
  await page.goto('http://localhost:5173');
  await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');
  await page.getByLabel('Mot de passe').fill('arbestra');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('link', { name: /Monde de l'Aube/ }).waitFor();
  await page.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') return route.abort();
    if (route.request().url().split('?')[0].endsWith('/village')) return route.fulfill({ json: snapshot });
    return route.continue();
  });
  await page.goto('http://localhost:5189/?world=aube&terrainPerf=1');
  await page.getByTestId('village-canvas').waitFor({ timeout: 120000 });
  await page.waitForFunction(async ({ file, campusId }) => {
    const mod = await import('/assets/' + file), Engine = Object.values(mod).find(v => v?.Instances);
    const scene = Engine.Instances.flatMap(e => e.scenes).find(s => s.getMeshByName('university-' + campusId)?.metadata?.lodAssetState === 'ready');
    if (!scene) return false;
    window.lodTest = { scene, campusId }; return true;
  }, { file, campusId }, { timeout: 120000 });
  await page.getByRole('button', { name: 'Vue libre', exact: true }).click();
  await page.locator('[aria-label="Moment du cycle solaire"]').evaluate(input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '540');
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.evaluate(async ({file,campusId}) => {
    const mod=await import('/assets/'+file),Engine=Object.values(mod).find(v=>v?.Instances);
    const s=Engine.Instances.flatMap(e=>e.scenes).find(s=>s.getMeshByName('university-'+campusId)?.metadata?.lodAssetState==='ready');
    if(!s)throw Error('Village scene no longer ready');
    const t=window.lodTest={scene:s,campusId},campus=s.getMeshByName('university-'+campusId);
    t.original = campus; t.target = campus.position.clone(); t.offset = campus.position.clone().setAll(0); t.radius = 65; t.history = [];
    s.onBeforeRenderObservable.add(() => {
      if (!t.hold) return;
      const root = t.focusSite ? s.meshes.find(m=>!m.parent&&m.metadata?.siteId===t.focusSite&&m.metadata?.buildingLod) : s.getMeshByName('university-' + t.campusId);
      if (root) t.target.copyFrom(root.position).addInPlace(t.offset);
      const c = s.activeCamera; c.target.copyFrom(t.target);
      Object.assign(c, { radius: t.radius, alpha: -.67, beta: .8, fov: .523, inertialRadiusOffset: 0 });
    });
    s.onAfterRenderObservable.add(() => {
      const root = s.getMeshByName('university-' + t.campusId);
      if (root?.metadata.buildingLod) t.history.push({ active: root.metadata.buildingLod.active, diameter: root.metadata.buildingLod.diameter });
    });
    t.hold = true;
  },{file,campusId});
  const lod = () => page.evaluate(() => window.lodTest.scene.getMeshByName('university-' + window.lodTest.campusId)?.metadata?.buildingLod?.active);
  const radius = async value => { await page.evaluate(value => window.lodTest.radius = value, value); await page.waitForTimeout(1000); };
  const ready = () => page.waitForFunction(() => window.lodTest.scene.getMeshByName('university-' + window.lodTest.campusId)?.metadata?.lodAssetState === 'ready', null, { timeout: 120000 });
  const refresh = async () => {
    const response = page.waitForResponse(r => r.url().split('?')[0].endsWith('/village'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await response; await page.waitForTimeout(1000);
  };
  const resources = () => page.evaluate(() => {
    const s = window.lodTest.scene, r = s.getMeshByName('university-' + window.lodTest.campusId);
    return { geometries: s.getGeometries().length, materials: s.materials.length, textures: s.textures.length,
      observers: s.onBeforeActiveMeshesEvaluationObservable.observers.length,
      campusGeometries: new Set(r?.getChildMeshes().map(m => m.geometry).filter(Boolean)).size,
      campusChildren: r?.getChildMeshes().length, active: r?.getChildMeshes().filter(m => m.getTotalVertices() && m.isEnabled()).length };
  });
  await radius(105); await expect.poll(lod).toBe('distant');
  console.log('LOD scene ready');
  await page.waitForTimeout(18000); await page.locator('.terrain-loading').waitFor({ state: 'hidden', timeout: 120000 });
  const selected = () => page.evaluate(() => window.lodTest.scene.getMeshByName('selection-marker')?.isVisible);
  if (!process.argv.includes('--families-only')) {
  // Real pointer selection and the same predicate used by the Village renderer.
  await page.getByRole('button', { name: 'Constructions', exact: true }).click();
  const point = await page.evaluate(() => {
    const t = window.lodTest, s = t.scene, root = s.getMeshByName('university-' + t.campusId);
    const children = new Set(root.getChildMeshes());
    for (let y = 230; y <= 600; y += 12) for (let x = 400; x <= 1050; x += 12) {
      const hit = s.pick(x, y, m => m.isEnabled() && m.isVisible && m.isPickable && typeof m.metadata?.siteId === 'string');
      if (children.has(hit.pickedMesh)) return { x, y, mesh: hit.pickedMesh.name, site: hit.pickedMesh.metadata.siteId };
    }
    throw Error('Campus not pickable');
  });
  await page.keyboard.down('Shift'); await page.mouse.click(point.x, point.y); await page.keyboard.up('Shift');
  await expect(page.locator('.world-context-menu')).toContainText('Université');
  report.selectionPoint = point; report.selectionBefore = await selected();
  console.log('Selected campus');
  // A wheel event must not discard the logical selection when crossing a LOD threshold.
  await page.mouse.move(1150, 650); await page.mouse.wheel(0, -80); await page.waitForTimeout(700);
  expect(await selected()).toBe(true);
  await page.evaluate(() => window.lodTest.hold = false);
  for (let step = 0; step < 16 && await lod() !== 'detailed'; step++) { await page.mouse.wheel(0, -360); await page.waitForTimeout(1000); console.log('Wheel',await page.evaluate(()=>({radius:window.lodTest.scene.activeCamera.radius,lod:window.lodTest.scene.getMeshByName('university-'+window.lodTest.campusId).metadata.buildingLod})));  }
  await expect.poll(lod).toBe('detailed');
  expect(await selected()).toBe(true);
  report.wheelZoom = await page.evaluate(() => ({ radius: window.lodTest.scene.activeCamera.radius,
    lod: window.lodTest.scene.getMeshByName('university-' + window.lodTest.campusId).metadata.buildingLod }));
  await page.evaluate(() => window.lodTest.hold = true); await radius(105);
  report.memoryWarm = await resources();
  for (let cycle = 0; cycle < 4; cycle++) {
    await radius(25); await expect.poll(lod).toBe('detailed');
    await radius(48); await expect.poll(lod).toBe('peripheral');
    expect(await selected()).toBe(true);
    await radius(105); await expect.poll(lod).toBe('distant');
    expect(await selected()).toBe(true);
  }
  await expect(page.locator('.world-context-menu')).toContainText('Université');
  expect(await page.evaluate(() => window.lodTest.original === window.lodTest.scene.getMeshByName('university-' + window.lodTest.campusId))).toBe(true);
  report.memoryAfterZoom = await resources();
  for (const key of ['materials', 'textures', 'observers', 'campusChildren', 'campusGeometries', 'active']) expect(report.memoryAfterZoom[key]).toBe(report.memoryWarm[key]);
  report.assetRequestsAfterZoom = assets.length;
  console.log('Repeated zoom passed');
  // A continuous zoom records both threshold crossings without alternating at a fixed pose.
  await page.evaluate(async () => {
    const t = window.lodTest; t.history = [];
    for (const end of [25, 105]) {
      const start = t.radius, began = performance.now();
      await new Promise(resolve => { const step = () => {
        const p = Math.min(1, (performance.now() - began) / 2500); t.radius = start + (end - start) * p;
        if (p < 1) window.requestAnimationFrame(step); else resolve();
      }; step(); });
    }
  });
  report.crossings = await page.evaluate(() => window.lodTest.history.filter((r, i, all) => !i || r.active !== all[i - 1].active));
  await page.screenshot({ path: 'test-results/lod-selected-far.png' });
  // Fixed off-screen pan, then restore using the campus's rebased position.
  await page.evaluate(() => { window.lodTest.offset.x = 400; }); await page.waitForTimeout(2500);
  await page.evaluate(() => { window.lodTest.offset.x = 0; });
  await page.waitForTimeout(2500); await expect.poll(lod).toBe('distant');
  report.afterPan = await resources();
  console.log('Pan/rebase passed');
  await radius(130); await expect(page.getByTestId('village-canvas')).toHaveAttribute('data-view-mode', 'region');
  await radius(85); await expect(page.getByTestId('village-canvas')).toHaveAttribute('data-view-mode', 'village');
  await page.waitForTimeout(6000); await radius(105); await expect.poll(lod).toBe('distant');
  console.log('Region return passed');
  // State/level/orientation changes through the normal snapshot update, without a DB command.
  for (const [level, status, targetLevel, quarterTurns] of [[2, 'under-construction', 3, 1], [1, 'completed', null, 2], [3, 'completed', null, 0]]) {
    snapshot = structuredClone(fixture);
    const building = snapshot.cells.find(c => c.building?.id === campusId).building;
    Object.assign(building, { level, status, targetLevel, quarterTurns });
    await refresh(); await ready(); await expect.poll(lod).toBe('distant');
    const actual = await page.evaluate(() => { const t = window.lodTest, r = t.scene.getMeshByName('university-' + t.campusId); return { rotation: r.rotation.y, children: r.getChildMeshes().length, lod: r.metadata.buildingLod }; });
    expect(actual.rotation).toBeCloseTo(quarterTurns * Math.PI / 2);
    report.states ??= []; report.states.push({ level, status, ...actual });
    console.log('State passed', level, status);
    await page.screenshot({ path: `test-results/lod-state-${level}-${status}.png` });
  }
  snapshot = structuredClone(fixture);
  for (const cell of snapshot.cells) if (cell.building?.id === campusId || cell.footprint?.buildingId === campusId) { cell.building = null; cell.footprint = null; }
  await refresh();
  await page.waitForFunction(() => !window.lodTest.scene.getMeshByName('university-' + window.lodTest.campusId));
  snapshot = structuredClone(fixture); await refresh(); await ready(); await expect.poll(lod).toBe('distant');
  report.afterReplacement = await resources();
  for (let cycle = 0; cycle < 3; cycle++) {
    snapshot = structuredClone(fixture);
    for (const cell of snapshot.cells) if (cell.building?.id === campusId || cell.footprint?.buildingId === campusId) { cell.building = null; cell.footprint = null; }
    await refresh(); snapshot = structuredClone(fixture); await refresh(); await ready();
  }
  report.afterRepeatedReplacement = await resources();
  for (const key of ['materials', 'textures', 'observers', 'campusChildren', 'campusGeometries', 'active']) expect(report.afterRepeatedReplacement[key]).toBe(report.afterReplacement[key]);
  console.log('Replacement/resource cycles passed');

  } else await page.getByRole('button', { name: 'Constructions', exact: true }).click();
  report.families = [];
  for (const type of ['stone-house','beam-house','log-house','town-hall','sawmill','stonemason']) {
    const site = fixture.cells.find(c=>c.building?.type===type||c.building?.visualLayout?.recipe===type);
    await page.evaluate(id=>window.lodTest.focusSite=id,site.id);
    const rootState = () => page.evaluate(id=>{
      const s=window.lodTest.scene,r=s.meshes.find(m=>!m.parent&&m.metadata?.siteId===id&&m.metadata?.buildingLod);
      return r ? {name:r.name,lod:r.metadata.buildingLod,meshes:r.getChildMeshes().filter(m=>m.getTotalVertices()&&m.isEnabled()).length} : null;
    },site.id);
    const states=[];
    for(const [distance,level] of [[25,'detailed'],[48,'peripheral'],[105,'distant']]) {
      await radius(distance);await expect.poll(async()=> (await rootState())?.lod.active).toBe(level);
      states.push(await rootState());await page.screenshot({path:`test-results/lod-general-${type}-${level}.png`});
    }
    const pick=await page.evaluate(id=>{
      const s=window.lodTest.scene;
      for(let y=260;y<=640;y+=8)for(let x=480;x<=970;x+=8){
        const hit=s.pick(x,y,m=>m.isEnabled()&&m.isVisible&&m.isPickable&&typeof m.metadata?.siteId==='string');
        if(hit?.pickedMesh?.metadata.siteId===id)return {x,y,name:hit.pickedMesh.name};
      }
      throw Error('No active picking point for '+id);
    },site.id);
    await page.keyboard.down('Shift');await page.mouse.click(pick.x,pick.y);await page.keyboard.up('Shift');
    expect(await selected()).toBe(true);
    await radius(25);expect(await selected()).toBe(true);await radius(105);expect(await selected()).toBe(true);
    const before=await page.evaluate(()=>{const s=window.lodTest.scene;return [s.materials.length,s.textures.length,s.onBeforeRenderObservable.observers.length,s.onBeforeActiveMeshesEvaluationObservable.observers.length,s.particleSystems.length,s.lights.length];});
    for(let cycle=0;cycle<2;cycle++){
      snapshot=structuredClone(fixture);
      for(const cell of snapshot.cells)if(cell.building?.id===site.building.id||cell.footprint?.buildingId===site.building.id){cell.building=null;cell.footprint=null;}
      await refresh();
      await expect.poll(rootState).toBe(null);
      snapshot=structuredClone(fixture);await refresh();
      await expect.poll(async()=> (await rootState())?.lod.active).toBe('distant');
    }
    const after=await page.evaluate(()=>{const s=window.lodTest.scene;return [s.materials.length,s.textures.length,s.onBeforeRenderObservable.observers.length,s.onBeforeActiveMeshesEvaluationObservable.observers.length,s.particleSystems.length,s.lights.length];});
    expect(after).toEqual(before);report.families.push({type,states,pick,before,after});console.log('Family passed',type);
  }
  await page.evaluate(()=>window.lodTest.focusSite=null);await radius(105);
  // Changing to exploration collapses its toolbar; choosing it again opens it.
  for (let attempt = 0; attempt < 2 && !await page.locator('[aria-label="Moment du cycle solaire"]').count(); attempt++) {
    await page.getByRole('button', { name: 'Vue libre', exact: true }).click(); await page.waitForTimeout(300);
  }
  await page.locator('[aria-label="Moment du cycle solaire"]').evaluate(input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '0');
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(3000); await page.screenshot({ path: 'test-results/lod-night-far.png' });
  report.passes = await page.evaluate(() => {
    const s = window.lodTest.scene;
    return { targets: s.customRenderTargets.length, lights: s.lights.map(l => ({ name: l.name, enabled: l.isEnabled(), intensity: l.intensity })),
      glass: s.meshes.filter(m => m.isEnabled() && m.isVisible && m.metadata?.buildingAttachment === 'glass' && m.name.includes('distant')).map(m => ({ alpha: m.material.alpha, pickable: m.isPickable })) };
  });
  expect(report.passes.glass.length).toBeGreaterThan(0);
  expect(report.passes.glass.every(g => g.alpha === .22 && !g.pickable)).toBe(true);
  expect(errors).toEqual([]); report.errors = errors; report.assetRequests = assets; report.complete = true;
  await writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await page.screenshot({path:'test-results/lod-browser-last.png'}).catch(()=>{}); await writeFile(reportFile, JSON.stringify({ ...report, errors }, null, 2)); await browser.close(); }
