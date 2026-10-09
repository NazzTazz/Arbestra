/* global process, console, Buffer */
// The actual public read-only T1 route, no fake UI or database writes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const exec=promisify(execFile),cli=resolve(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
const browser=async(...args)=>(await exec(cli,['--session','arbestra-study-t1',...args],{windowsHide:true,timeout:60000,maxBuffer:4000000})).stdout.trim();
const evaluate=code=>browser('eval','-b',Buffer.from(code).toString('base64'));
const click=name=>browser('find','role','button','click','--name',name,'--exact'),records={};
async function capture(name,view,layer='terrain'){
 for(let attempt=0;;attempt++){
  try{await browser('wait','--fn',`(()=>{const e=document.querySelector('.generator-render');return e?.dataset.renderStatus==='ready'&&e.dataset.view==='${view}'&&e.dataset.layer==='${layer}';})()`);break;}
  catch(error){if(attempt>=2||!/timed out|Failed to read/.test(String(error)))throw error;console.log('Render still busy:',name);}
 }
 await browser('scrollintoview','.generator-render');
 await browser('screenshot','test-results/study-'+name+'.png');
 records[name]={location:await browser('get','text','[data-study-location]'),url:await browser('get','url')};console.log(name);
}
try{
 if(process.argv.includes('--stone-local')){
  const data=JSON.parse(await readFile('apps/world-web/public/studies/t1-alpha512.json','utf8')),site=data.stoneSites.reduce((a,b)=>a.rocks.length>b.rocks.length?a:b);
  await browser('open',`http://localhost:5174/terrain-study?world=t1-alpha512&view=local&x=${site.x}&y=${site.y}`);await browser('set','viewport','1440','1100');await capture('linked-stone','local');
  await click('Pierre en plaine');await capture('chunk-shared-stone','local');
 }else{
 await browser('open','http://localhost:5174/terrain-study?world='+ ((process.argv.includes('--large')||process.argv.includes('--stone'))?'t1-alpha512':process.argv.includes('--alpha')?'t1-alpha':'t1'));await browser('set','viewport','1440','1100');await capture('torus','torus');
 await click('Carte à plat');await capture('map','map');
 if(process.argv.includes('--stone')){
  await click('Pierre en plaine');await capture('chunk-shared-stone','local');
  const data=JSON.parse(await readFile('apps/world-web/public/studies/t1-alpha512.json','utf8')),site=data.stoneSites.reduce((a,b)=>a.rocks.length>b.rocks.length?a:b);
  await browser('fill','input[aria-label="X"]',String(site.x));await browser('fill','input[aria-label="Y"]',String(site.y));await click('Aller à ces coordonnées');await capture('linked-stone','local');
 }
 if(process.argv.includes('--large')){
  if(JSON.parse(await evaluate("document.querySelector('input[type=checkbox]').checked"))!==true)throw Error('Chunk grid not enabled');
  const before=await evaluate("document.querySelector('.generator-render').dataset.renderKey");
  await browser('find','label','Chunks serveur (32 × 32)','click');await capture('large-no-chunks','map');
  if(await evaluate("document.querySelector('.generator-render').dataset.renderKey")!==before)throw Error('Chunk visibility rebuilt the terrain');
  await browser('find','label','Chunks serveur (32 × 32)','click');
  await browser('fill','input[aria-label="X"]','-1');await browser('fill','input[aria-label="Y"]','257');await click('Aller à ces coordonnées');await capture('large-wrap','local');
  if(!records['large-wrap'].location.includes('X=511')||!records['large-wrap'].location.includes('Y=1'))throw Error('Large coordinates did not wrap');
 }
 if(process.argv.includes('--water')){
  await click('Chaîne A (70, 45)');await capture('water-c2','local');
  await browser('find','label','Eau au niveau 0','click');await capture('water-off','local');
  if(!(await browser('get','url')).includes('water=0'))throw Error('Water toggle URL lost');
  await browser('find','label','Eau au niveau 0','click');await capture('water-on','local');
 }
 if(!process.argv.includes('--alpha')&&!process.argv.includes('--large')&&!process.argv.includes('--stone')){
 await click('Montée F4–F3 (174, 100)');await capture('ramp-f4-f3','local');
 await click('Massif E3–F3 (155, 89)');await capture('massif-e3','local');
 if(process.argv.includes('--variation')){
  await click('Mer agrandie H–C');await capture('expanded-sea','local');
  await click('Chaîne A (70, 45)');await capture('emerging-peaks','local');
  await click('Plaine (80, 10)');await capture('low-plateaus','local');
  await click('Pierre en plaine');await capture('plain-stone','local');
  await browser('find','role','link','click','--name','Base sauvegardée','--exact');
  await browser('wait','--fn',`Boolean(document.querySelector('[data-study-world="t1-base"]'))`);await capture('saved-base','local');
  if(!(await browser('get','url')).includes('world=t1-base'))throw Error('Base identity lost');
  if(JSON.parse(await evaluate("Array.from(document.querySelectorAll('button')).filter(b=>b.textContent==='Pierre en plaine').length"))!==0)throw Error('Base unexpectedly includes new stone groups');
  await browser('find','role','link','click','--name','Variante plateaux et pierre','--exact');
  await browser('wait','--fn',`Boolean(document.querySelector('[data-study-world="t1"]'))`);await capture('variation-return','local');
 }
 if(!process.argv.includes('--ramp')&&!process.argv.includes('--variation')&&!process.argv.includes('--water')){
 await click('Bassin H/A3 (0, 80)');await capture('basin-seam','local');
 await click('Bassin H1–B1 (16, 16)');await capture('basin-south','local');
 await click('Trois bras G1–G2 (213, 31)');await capture('three-arms','local');
 await click('Coude E4 (146, 108)');await capture('bend-e4','local');
 await click('Passage F1 (177, 8)');await capture('passage-f1','local');
 }
 if(process.argv.includes('--water')||process.argv.includes('--basins')||process.argv.includes('--ramp')||process.argv.includes('--variation')){
  await click('Carte à plat');await browser('select','select[aria-label="Lecture"]','altitude');await capture('basins-altitude','map','altitude');
 }else{
 await click('Chaîne A (70, 45)');await capture('chain-a','local');
 await click('Chaîne B (171, 81)');await capture('chain-b','local');
 await click('Creux C (120, 80)');await capture('hollow','local');
 await browser('select','select[aria-label="Lecture"]','altitude');await capture('altitude','local','altitude');
 await browser('select','select[aria-label="Lecture"]','terrain');
 await browser('fill','input[aria-label="X"]','-1');await browser('fill','input[aria-label="Y"]','129');await click('Aller à ces coordonnées');await capture('wrapped','local');
 if(!records.wrapped.location.includes('X=255')||!records.wrapped.location.includes('Y=1'))throw Error('Coordinates did not wrap');
 const link=JSON.parse(await evaluate("document.querySelector('[data-study-link]').href"));
 await browser('open',link);await capture('deep-link','local');
 if(records['deep-link'].location!==records.wrapped.location)throw Error('Position did not survive reload');
 await click('Carte à plat');await capture('map-return','map');
 await browser('click','canvas');await capture('pick','map');
 if(records.pick.location===records['map-return'].location)throw Error('Picking did not change coordinates');
 await browser('find','label','Repères de coordonnées','click');await capture('no-grid','map');
 }
 }
 }
 records.errors=JSON.parse(await browser('--json','errors')).data.errors;
 records.graphics=await evaluate("(()=>{const c=document.querySelector('canvas'),gl=c.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {width:c.width,height:c.height,renderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)};})()");
 await writeFile('test-results/study-review.json',JSON.stringify(records,null,2));if(records.errors.length)throw Error(JSON.stringify(records.errors));console.log(JSON.stringify(records));
}finally{await browser('close');}
