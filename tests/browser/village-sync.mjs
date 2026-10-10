// Actual App + Babylon renderer; deterministic transport and terrain fixture.
// Server MVCC/commit/SSE guarantees are exercised separately by sync.integration.test.ts.
/* global window,console,process,MessageEvent,EventTarget,URL,structuredClone */
import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { villageFrame } from '../../packages/contracts/dist/index.js';
const url = new URL(process.env.RC1_BROWSER_URL ?? 'http://localhost:5279/');
if (url.hostname !== 'localhost') throw Error('Local synchronization fixture only');
const initial = JSON.parse(readFileSync('tests/fixtures/village-sync-state.json', 'utf8'));
initial.world.generationVersion = 1;
const after = structuredClone(initial); after.syncRevision = 2;
Object.assign(after.cells[1].building, { status: 'completed', completedAt: '2026-10-10T18:00:05.000Z' });
after.cells[1].footprint.state = 'active';
const browser = await chromium.launch({channel:'chrome'}), page = await browser.newPage({viewport:{width:1280,height:900}});
const errors = []; let villageReads = 0;
page.on('pageerror', e => errors.push(e.message));
try {
  await page.addInitScript(() => {
    window.__sources = [];
    window.EventSource = class extends EventTarget {
      constructor(url) { super(); this.url = url; this.closed = false; this.onerror = null; window.__sources.push(this); }
      close() { this.closed = true; }
      emit(type, data) { this.dispatchEvent(new MessageEvent(type, {data:JSON.stringify(data)})); }
    };
  });
  await page.route('**/api/**', async route => {
    const request = route.request(), parsed = new URL(request.url()), path = parsed.pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (path.endsWith('/village')) { villageReads++; return route.fulfill({json:initial}); }
    if (path.endsWith('/terrain') || path.endsWith('/terrain/updates')) {
      const chunks = (parsed.searchParams.get('chunks') ?? '').split(';').filter(Boolean).map(item => {
        const [chunkX,chunkY] = item.split(',').map(Number);
        return {chunkX,chunkY,originCellX:chunkX*32,originCellY:chunkY*32,terrainCodes:Array(34**2).fill(1),elevations:Array(34**2).fill(0),features:[],occupiedCells:[]};
      });
      return route.fulfill({json:{world:initial.world,chunks}});
    }
    if (request.method() !== 'GET') throw Error('Unexpected mutation: '+path);
    return route.fulfill({json:{}});
  });
  url.pathname = '/'; url.searchParams.set('world',initial.world.slug); await page.goto(url.href);
  const canvas = page.locator('canvas[data-building-count]');
  await expect(canvas).toHaveAttribute('data-building-count','2',{timeout:60000});
  await expect(canvas).toHaveAttribute('data-under-construction-count','1');
  await expect.poll(()=>page.evaluate(()=>window.__sources.length)).toBe(1);
  await page.getByRole('button',{name:'Vue libre',exact:true}).click();
  await page.getByRole('button',{name:'Population',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-camera',/.+/);
  const before = await canvas.evaluate(c => {window.__canvas=c;return {meshes:JSON.parse(c.dataset.buildingMeshIds),camera:c.dataset.camera,generations:Number(c.dataset.buildingGenerationCount)};});
  await page.evaluate(frame => window.__sources[0].emit('frame',frame),villageFrame(initial,after));
  await expect(canvas).toHaveAttribute('data-under-construction-count','0');
  const completed = await canvas.evaluate(c => ({same:c===window.__canvas,meshes:JSON.parse(c.dataset.buildingMeshIds),camera:c.dataset.camera,generations:Number(c.dataset.buildingGenerationCount)}));
  expect(completed.same).toBe(true); expect(completed.camera).toBe(before.camera);
  expect(completed.meshes[initial.cells[0].building.id]).toBe(before.meshes[initial.cells[0].building.id]);
  expect(completed.meshes[initial.cells[1].building.id]).not.toBe(before.meshes[initial.cells[1].building.id]);
  expect(completed.generations-before.generations).toBe(1);
  await expect(page.getByRole('button',{name:'Population',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.evaluate(frame => window.__sources[0].emit('frame',frame),villageFrame(initial,after));
  await expect(canvas).toHaveAttribute('data-building-generation-count',String(completed.generations));
  const recovered = structuredClone(after); recovered.syncRevision=5; recovered.village.wood=200;
  await page.evaluate(frame=>window.__sources[0].emit('frame',frame),{...villageFrame(initial,after),fromRevision:4,toRevision:5});
  await expect.poll(()=>page.evaluate(()=>window.__sources.length)).toBe(2);
  await page.evaluate(snapshot=>window.__sources[1].emit('snapshot',snapshot),recovered);
  await expect(canvas).toHaveAttribute('data-building-generation-count',String(completed.generations));
  expect(await canvas.getAttribute('data-camera')).toBe(before.camera);
  await expect(page.getByRole('button',{name:'Population',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.evaluate(snapshot=>window.__sources[0].emit('snapshot',snapshot),{...recovered,syncRevision:6,cells:[]});
  await expect(canvas).toHaveAttribute('data-building-count','2');
  await page.waitForTimeout(2500); expect(villageReads).toBe(1);
  expect(errors).toEqual([]);
  await page.screenshot({path:'test-results/village-sync-render.png'});
  console.log('VILLAGE_SYNC_RENDER',JSON.stringify({villageReads,unchangedHall:true,rebuiltBuildings:1,cameraRetained:true,duplicatesIgnored:true,staleSubscriptionIgnored:true}));
} finally { await browser.close(); }
