// Actual App, construction gesture, client HTTP adapter and Babylon cache.
// Controlled transport; economic/MVCC proofs live in sync.integration.test.ts.
/* global window,console,process,MessageEvent,EventTarget,URL,structuredClone */
import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { villageFrame } from '../../packages/contracts/dist/index.js';
const url=new URL(process.env.RC1_BROWSER_URL??'http://localhost:5279/');
if(url.hostname!=='localhost')throw Error('Local construction fixture only');
const initial=JSON.parse(readFileSync('tests/fixtures/village-sync-state.json','utf8'));
initial.world.generationVersion=1;
initial.buildingTypes=JSON.parse(readFileSync('test-results/http-construction-browser-state.json','utf8')).buildingTypes;
initial.village.wood=5000;initial.village.resources[0].amount=5000;
initial.cells.push({id:'66:64',cellX:66,cellY:64,x:5,z:0,canBuild:true,footprint:null,building:null});
initial.region.width=3;initial.region.height=1;initial.region.terrainCodes=[1,1,1];initial.region.elevations=[0,0,0];
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1280,height:900}});
let reads=0,posts=0,accepted,frame,after;const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(()=>{window.__sources=[];window.EventSource=class extends EventTarget{
 constructor(url){super();this.url=url;this.closed=false;this.onerror=null;window.__sources.push(this);}close(){this.closed=true;}
 emit(type,data){this.dispatchEvent(new MessageEvent(type,{data:JSON.stringify(data)}));}};});
 await page.route('**/api/**',async route=>{
  const request=route.request(),parsed=new URL(request.url()),path=parsed.pathname;
  if(path.endsWith('/village')){reads++;return route.fulfill({json:initial});}
  if(path.endsWith('/terrain')||path.endsWith('/terrain/updates')){
   const chunks=(parsed.searchParams.get('chunks')??'').split(';').filter(Boolean).map(item=>{const [chunkX,chunkY]=item.split(',').map(Number);
   return {chunkX,chunkY,originCellX:chunkX*32,originCellY:chunkY*32,terrainCodes:Array(34**2).fill(1),elevations:Array(34**2).fill(0),features:[],occupiedCells:[]};});
   return route.fulfill({json:{world:initial.world,chunks}});
  }
  if(request.method()==='POST'&&path.endsWith('/buildings')){
   posts++;accepted=request.postDataJSON();
   expect(accepted.cells).toEqual([{cellX:66,cellY:64}]);expect(accepted.houseVariant).toBe('logs');
   expect(request.headers()['x-village-sync']).toBe('1');expect(request.headers()['x-village-revision']).toBe('1');
   expect(request.headers()['x-village-server-time']).toBe(initial.serverTime);
   after=structuredClone(initial);after.syncRevision=2;after.serverTime='2026-10-10T18:00:01.000Z';
   after.village.wood-=25;after.village.resources[0].amount-=25;
   Object.assign(after.cells[2],{canBuild:false,footprint:{buildingId:'55555555-5555-4555-8555-555555555555',buildingType:'dwelling',role:'anchor',state:'reserved'},
    building:{...after.cells[1].building,id:'55555555-5555-4555-8555-555555555555',visualLayout:{recipe:'log-house',version:1,quarterTurns:0,entranceFace:'-z',offset:[0,0]}}});
   frame=villageFrame(initial,after);return route.fulfill({json:{kind:'frame',commandId:accepted.commandId,commandTime:after.serverTime,serverTime:after.serverTime,frame}});
  }
  if(request.method()!=='GET')throw Error('Unexpected mutation '+path);
  return route.fulfill({json:{}});
 });
 url.pathname='/';url.searchParams.set('world',initial.world.slug);await page.goto(url.href);
 const canvas=page.locator('canvas[data-building-count]');await expect(canvas).toHaveAttribute('data-building-count','2',{timeout:60000});
 await page.getByRole('button',{name:'Vue libre',exact:true}).click();
 await page.getByRole('button',{name:'Constructions',exact:true}).click();
 await page.getByRole('button',{name:'Maison en troncs',exact:true}).click();
 await expect(canvas).toHaveAttribute('data-world-interaction-ready','true',{timeout:20000});
 const box=await canvas.boundingBox(),cell=await canvas.evaluate(c=>JSON.parse(c.dataset.cellScreens).find(p=>p.id==='66:64'));
 if(!box||!cell)throw Error('Missing projected construction cell');
 await page.mouse.move(box.x+cell.x*box.width,box.y+cell.y*box.height);await page.waitForTimeout(200);
 const before=await canvas.evaluate(c=>{window.__canvas=c;return {camera:c.dataset.camera,meshes:JSON.parse(c.dataset.buildingMeshIds),generations:Number(c.dataset.buildingGenerationCount)};});
 await page.mouse.down();await page.mouse.up();
 await expect(canvas).toHaveAttribute('data-building-count','3',{timeout:15000});
 expect(posts).toBe(1);
 await expect(canvas).toHaveAttribute('data-building-generation-count',String(before.generations+1));
 const current=await canvas.evaluate(c=>({same:c===window.__canvas,camera:c.dataset.camera,meshes:JSON.parse(c.dataset.buildingMeshIds),generations:Number(c.dataset.buildingGenerationCount)}));
 expect(current.same).toBe(true);expect(current.camera).toBe(before.camera);expect(current.generations-before.generations).toBe(1);
 for(const item of initial.cells.filter(c=>c.building))expect(current.meshes[item.building.id]).toBe(before.meshes[item.building.id]);
 await page.evaluate(f=>window.__sources[0].emit('frame',f),frame);
 await expect(canvas).toHaveAttribute('data-building-generation-count',String(current.generations));
 await page.evaluate(f=>window.__sources[0].emit('frame',f),{...frame,fromRevision:4,toRevision:5});
 await expect.poll(()=>page.evaluate(()=>window.__sources.length)).toBe(2);
 await page.evaluate(s=>window.__sources[1].emit('snapshot',s),{...after,syncRevision:5});
 await expect(canvas).toHaveAttribute('data-building-count','3');expect(await canvas.getAttribute('data-camera')).toBe(before.camera);
 const recovered={...after,syncRevision:5},finished=structuredClone(recovered);finished.syncRevision=6;finished.cells[2].building.status='completed';finished.cells[2].building.completedAt=finished.serverTime;finished.cells[2].footprint.state='active';
 await page.evaluate(f=>window.__sources[1].emit('frame',f),villageFrame(recovered,finished));
 await expect(canvas).toHaveAttribute('data-under-construction-count','1');
 await page.waitForTimeout(300);expect(reads).toBe(1);expect(errors).toEqual([]);
 await page.screenshot({path:'test-results/construction-http-render.png'});
 console.log('CONSTRUCTION_HTTP_RENDER',JSON.stringify({posts,reads,addedMeshes:1,unchangedMeshes:true,cameraRetained:true,httpSseDuplicateIgnored:true,gapRecovered:true}));
}finally{if(errors.length)console.error(errors);await browser.close();}
