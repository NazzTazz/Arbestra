// Actual App + Babylon on controlled RC1 transport; no persistent game commands.
/* global window,console,process,MessageEvent,EventTarget,URL */
import {chromium,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const url=new URL(process.env.RC1_BROWSER_URL??'http://localhost:5280/');
if(url.hostname!=='localhost')throw Error('Local presentation fixture only');
const state=JSON.parse(readFileSync('tests/fixtures/village-sync-state.json','utf8'));
state.serverTime=new Date().toISOString();
const mill=state.cells[1];Object.assign(mill,{id:'67:64',cellX:67,x:7.5});
Object.assign(mill.building,{type:'sawmill',status:'completed',constructionStartedAt:null,constructionCompletesAt:null});
Object.assign(mill.footprint,{buildingType:'sawmill',state:'active'});
const path=[64,65,66,67].map(cellX=>({cellX,cellY:64}));
state.travelRoutes=[{id:'mill',kind:'building',cells:path,destination:path.at(-1)},
 {id:'stone',kind:'stone',cells:[path[1],{cellX:65,cellY:65},{cellX:65,cellY:66}],destination:{cellX:65,cellY:66}}];
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1280,height:900}});
let release;const gate=new Promise(resolve=>release=resolve);
let failed=false,edits=false,fullReads=0,updateReads=0;const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const elevation=(x,y)=>1+.1*Math.sin(2*Math.PI*x/512)+.1*Math.cos(2*Math.PI*y/256);
try {
 await page.addInitScript(()=>{window.__sources=[];window.EventSource=class extends EventTarget{
  constructor(url){super();this.url=url;window.__sources.push(this);}close(){}emit(type,data){this.dispatchEvent(new MessageEvent(type,{data:JSON.stringify(data)}));}
 };});
 await page.route('**/api/**',async route=>{
  const request=route.request(),parsed=new URL(request.url()),path=parsed.pathname;
  if(path.endsWith('/village'))return route.fulfill({json:state});
  if(request.method()!=='GET')throw Error('Unexpected game mutation '+path);
  if(path.endsWith('/terrain')||path.endsWith('/terrain/updates')){
   const update=path.endsWith('/updates');if(update)updateReads++;else fullReads++;
   if(!update){await gate;if(!failed){failed=true;return route.abort('failed');}}
   else expect(request.headers()['x-arbestra-terrain-edits']).toBe('1');
   const chunks=(parsed.searchParams.get('chunks')??'').split(';').filter(Boolean).map(item=>{
    const [chunkX,chunkY]=item.split(',').map(Number),originCellX=chunkX*32,originCellY=chunkY*32;
    const terraces=edits&&chunkX===2&&chunkY===2?[{cellX:67,cellY:64,height:2}]:[];
    const common={chunkX,chunkY,originCellX,originCellY,features:[],occupiedCells:[]};
    if(update)return {...common,rc1Edits:{terraces}};
    return {...common,terrainCodes:Array(34**2).fill(1),elevations:Array(34**2).fill(0),rc1:{stride:65,heights:Array.from({length:65**2},(_,i)=>elevation(originCellX-.5+(i%65)/2,originCellY-.5+Math.floor(i/65)/2)),water:Array(65**2).fill(0),terraces}};
   });return route.fulfill({json:{world:state.world,chunks}});
  }
  const world=state.world;
  if(path.endsWith('/terrain/overview'))return route.fulfill({json:{world,overviewVersion:1,gridWidth:1,gridHeight:1,meanElevations:[100],minElevations:[100],maxElevations:[100],waterCoverage:[0],rockCoverage:[255]}});
  if(path.endsWith('/overview/villages'))return route.fulfill({json:{world,sampledAt:state.serverTime,truncated:false,villages:[]}});
  if(path.endsWith('/overview/vegetation'))return route.fulfill({json:{world,overviewVersion:1,gridWidth:1,gridHeight:1,woodlandCoverage:[255],sampledAt:state.serverTime,ageMs:0,maxAgeMs:30000}});
  return route.fulfill({json:{}});
 });
 url.pathname='/';url.searchParams.set('world',state.world.slug);await page.goto(url.href);
 const canvas=page.locator('canvas[data-building-count]');await expect(canvas).toHaveAttribute('data-building-count','2',{timeout:60000});
 const presentation=()=>canvas.evaluate(c=>JSON.parse(c.dataset.terrainPresentation||'null'));
 await expect.poll(async()=>Boolean(await presentation()),{timeout:60000}).toBe(true);
 const before=await presentation(),initialMill=before.buildings.find(b=>b.type==='sawmill');expect(initialMill.y).toBeCloseTo(.09);
 release();
 await expect.poll(async()=>{const p=await presentation();return p?.grass&&p.buildings.find(b=>b.type==='sawmill')?.base>2;},{timeout:60000}).toBe(true);
 const loaded=await presentation(),loadedMill=loaded.buildings.find(b=>b.type==='sawmill');
 expect(failed).toBe(true);expect(fullReads).toBeGreaterThan(2);
 expect(loadedMill.mesh).toBe(initialMill.mesh);expect(loadedMill.base).toBeCloseTo(elevation(67,64)*2.5,5);expect(loadedMill.y).toBeCloseTo(loadedMill.base+.09,5);
 await expect.poll(async()=>{const p=await presentation();return p.roads.some(r=>r.name==='village-road-paved')&&p.roads.some(r=>r.name==='village-road-earth');},{timeout:60000}).toBe(true);
 edits=true;
 await expect.poll(async()=>(await presentation()).buildings.find(b=>b.type==='sawmill').base,{timeout:60000}).toBe(5);
 const after=await presentation(),editedMill=after.buildings.find(b=>b.type==='sawmill');expect(editedMill.mesh).toBe(initialMill.mesh);expect(editedMill.y).toBeCloseTo(5.09);
 expect(updateReads).toBeGreaterThan(0);expect(after.anonymousMasses).toBe(false);expect(after.grass).toBe(true);
 await page.getByRole('button',{name:'Vue libre',exact:true}).click();
 await page.screenshot({path:'test-results/rc1-relief-browser.png'});
 expect(errors).toEqual([]);console.log(JSON.stringify({result:'passed',fullReads,updateReads,initialY:initialMill.y,loadedY:loadedMill.y,editedY:editedMill.y,sameMesh:editedMill.mesh===initialMill.mesh,roads:after.roads,grass:after.grass,errors}));
}finally{release();await browser.close();}
