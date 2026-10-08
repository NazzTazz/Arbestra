// Capture before/after builds with the same saved village and three fixed poses.
// node tests/browser/village-lod-profile.mjs <tag> <port> <dist-directory>
/* global navigator, window, HTMLInputElement, Event, URL, performance, console, process */
import {chromium} from '@playwright/test';
import {readdir,readFile,writeFile} from 'node:fs/promises';
const [tag='before',port='5188',dist='test-results/lod-before-dist']=process.argv.slice(2);
const moduleName=(await readdir(dist+'/assets')).find(f=>f.startsWith('infrastructure-factory-')&&f.endsWith('.js'));
const browser=await chromium.launch({channel:'chrome',args:['--use-angle=d3d11']}),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
await page.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>false}));
page.on('pageerror',e=>errors.push(e.message));
let fixture;
try{fixture=JSON.parse(await readFile('test-results/lod-village.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
try{
 await page.goto('http://localhost:5173');await page.getByLabel('Adresse e-mail').fill('player@arbestra.local');await page.getByLabel('Mot de passe').fill('arbestra');await page.getByRole('button',{name:'Se connecter'}).click();await page.getByRole('link',{name:/Monde de l'Aube/}).waitFor();
 await page.route('**/api/**',async route=>{const req=route.request();if(req.method()!=='GET')return route.abort();if(new URL(req.url()).pathname.endsWith('/village')){if(!fixture){fixture=await(await route.fetch()).json();await writeFile('test-results/lod-village.json',JSON.stringify(fixture));}return route.fulfill({json:fixture});}return route.continue();});
 const loadStarted=Date.now();
 await page.goto(`http://localhost:${port}/?world=aube&terrainPerf=1`);await page.getByTestId('village-canvas').waitFor({timeout:120000});await page.getByRole('button',{name:'Vue libre',exact:true}).click();
 await page.waitForFunction(async file=>{const mod=await import('/assets/'+file),Engine=Object.values(mod).find(v=>v?.Instances);const s=Engine.Instances.flatMap(e=>e.scenes).find(s=>s.meshes.some(m=>m.name.startsWith('university-')&&m.metadata?.assetState==='ready'));if(!s)return false;window.lodScene=s;return !s.meshes.some(m=>!m.parent&&(m.metadata?.assetState==='loading'||m.metadata?.lodAssetState==='loading'));},moduleName,{timeout:120000});
 await page.locator('[aria-label="Moment du cycle solaire"]').evaluate(input=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'540');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.evaluate(()=>{
  const s=window.lodScene,e=s.getEngine(),campus=s.meshes.find(m=>m.name.startsWith('university-')&&!m.parent),hall=(()=>{let root=s.getMeshByName('hall-market-ground-floor');while(root.parent)root=root.parent;return root;})();
  if(e.maxFPS!==45||e.getRenderWidth()!==1200)throw Error('Invalid benchmark render settings');const a=window.lodAudit={s,e,rows:[],gpu:[],last:0,pose:null,inventory:[],pending:[]};
  a.poses=[{name:'detail',target:campus.position.asArray(),radius:25,beta:1,alpha:-.67,fov:.505},{name:'close',target:campus.position.asArray(),radius:40,beta:1,alpha:-.67,fov:.505},{name:'management',target:hall.position.asArray(),radius:65,beta:.85,alpha:-.67,fov:.51},{name:'far',target:hall.position.asArray(),radius:105,beta:.8,alpha:-.67,fov:.523}];
  for(const root of s.meshes.filter(m=>!m.parent&&m.metadata?.siteId)){const children=[root,...root.getChildMeshes()];a.inventory.push({name:root.name,id:root.metadata.siteId,meshes:children.filter(m=>m.getTotalVertices()).length,vertices:children.reduce((n,m)=>n+m.getTotalVertices(),0),indices:children.reduce((n,m)=>n+m.getTotalIndices(),0),materials:new Set(children.map(m=>m.material?.uniqueId)).size,position:root.position.asArray()});}
  s.onBeforeRenderObservable.add(()=>{if(a.pose){const c=s.activeCamera;c.target.copyFromFloats(...a.pose.target);Object.assign(c,{radius:a.pose.radius,beta:a.pose.beta,alpha:a.pose.alpha,fov:a.pose.fov});}});
  for(const m of s.meshes){const original=m.render;if(typeof original!=='function')continue;m.render=function(...args){const previous=a.mesh;a.mesh=m;try{return original.apply(this,args)}finally{a.mesh=previous;}};}
  for(const name of ['drawElementsType','drawArraysType']){const original=e[name];e[name]=function(...args){a.draws++;const instances=args[3]??1;if(name==='drawElementsType')a.indices+=args[2]*instances;else a.arrayVertices+=args[2]*instances;a.vertices+=(a.mesh?.getTotalVertices()??0)*instances;const key=a.mesh?.name??'other';a.batches[key]=(a.batches[key]??0)+1;return original.apply(this,args);};}
  const gl=e._gl,ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');a.gpuSupported=!!ext;
  const original=s.render;s.render=function(...args){for(let i=a.pending.length-1;i>=0;i--){const q=a.pending[i];if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)){if(!gl.getParameter(ext.GPU_DISJOINT_EXT))a.gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);a.pending.splice(i,1);}}
   const q=ext&&a.pending.length<4?gl.createQuery():null;if(q)gl.beginQuery(ext.TIME_ELAPSED_EXT,q);const t=performance.now();try{return original.apply(this,args);}finally{a.render=performance.now()-t;if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);a.pending.push(q);}}};
  e.onBeginFrameObservable.add(()=>{const t=performance.now();a.frame=a.last?t-a.last:0;a.last=t;a.begin=t;a.draws=0;a.indices=0;a.arrayVertices=0;a.vertices=0;a.batches={};});
  e.onEndFrameObservable.add(()=>{if(a.frame)a.rows.push({frame:a.frame,cpu:performance.now()-a.begin,render:a.render,draws:a.draws,indices:a.indices,arrayVertices:a.arrayVertices,vertices:a.vertices,active:s.getActiveMeshes().length,batches:a.batches});});
 });
 const modelReadyMs=Date.now()-loadStarted;console.log('ready',tag,modelReadyMs);await page.waitForTimeout(20000);
 const results=[];
 for(let index=0;index<4;index++){
  await page.evaluate(index=>window.lodAudit.pose=window.lodAudit.poses[index],index);await page.waitForTimeout(18000);await page.locator('.terrain-loading').waitFor({state:'hidden',timeout:120000});
  await page.waitForFunction(()=>{const a=window.lodAudit,s=a.s,key=[s.meshes.length,s.getTotalVertices(),s.getGeometries().length,s.materials.length].join(':');if(key!==a.stableKey){a.stableKey=key;a.stableSince=performance.now();}return performance.now()-a.stableSince>6000;},null,{timeout:120000});
  await page.evaluate(()=>{window.lodAudit.rows=[];window.lodAudit.gpu=[];});await page.waitForTimeout(6000);
  const result=await page.evaluate(()=>{const a=window.lodAudit,e=a.e,s=a.s,gl=e._gl,ext=gl.getExtension('WEBGL_debug_renderer_info');const stats=xs=>{xs.sort((a,b)=>a-b);return {n:xs.length,mean:xs.reduce((a,b)=>a+b,0)/xs.length,p50:xs[Math.floor(xs.length*.5)],p95:xs[Math.floor(xs.length*.95)]};};const metrics=Object.fromEntries(['frame','cpu','render','draws','indices','arrayVertices','vertices','active'].map(k=>[k,stats(a.rows.map(r=>r[k]))]));const geometries=new Set(s.meshes.map(m=>m.geometry).filter(Boolean));return {pose:a.pose,...metrics,gpu:stats(a.gpu),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,resolution:[e.getRenderWidth(),e.getRenderHeight()],maxFPS:e.maxFPS,lod:s.meshes.find(m=>m.name.startsWith('university-')&&!m.parent)?.metadata?.buildingLod,lodCounts:Object.fromEntries(['detailed','peripheral','distant'].map(level=>[level,s.meshes.filter(m=>!m.parent&&m.metadata?.buildingLod?.active===level).length])),logicalVertices:s.getTotalVertices(),meshes:s.meshes.length,geometries:geometries.size,geometryBytes:[...new Set([...geometries].flatMap(g=>g.getVerticesDataKinds().map(k=>g.getVertexBuffer(k)?.getData())))].reduce((n,data)=>n+(data?(data.byteLength??data.length*4):0),0)+[...geometries].reduce((n,g)=>{const data=g.getIndices();return n+(data?(data.byteLength??data.length*4):0);},0),materials:s.materials.length,textures:s.textures.length,targets:s.customRenderTargets.length,batches:a.rows.at(-1)?.batches,inventory:a.inventory,lights:s.lights.map(l=>({name:l.name,intensity:l.intensity,enabled:l.isEnabled()}))};});
  result.mode=await page.getByTestId('village-canvas').getAttribute('data-view-mode');results.push(result);await page.screenshot({path:`test-results/lod-${tag}-${result.pose.name}.png`});console.log(result.pose.name,JSON.stringify({draws:result.draws,indices:result.indices,frame:result.frame,gpu:result.gpu,mode:result.mode,lod:result.lod}));
  await writeFile(`test-results/lod-${tag}.json`,JSON.stringify({results,errors,modelReadyMs},null,2));
 }
 if(errors.length)throw Error(JSON.stringify(errors));
}finally{await browser.close();}
