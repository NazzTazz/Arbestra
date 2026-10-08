import {URL} from 'node:url';
/* global process, console, fetch, performance, setTimeout */
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {generateLandscape,DEFAULT_GENERATOR_PARAMETERS} from '../../packages/contracts/src/index.ts';
import {createDatabase} from '../../apps/api/src/database/connection.ts';
import {testDatabaseUrl} from '../../apps/api/src/database/test-environment.ts';
import {artifactChecksum,writeV3Chunks} from '../../apps/api/src/modules/world-generator/artifact.ts';
const fixture=JSON.parse(await readFile('test-results/world-generator-fixture.json','utf8')),url=testDatabaseUrl(),u=new URL(url);
if(u.hostname!=='127.0.0.1'||u.pathname!=='/arbestra_test')throw Error('Unexpected test target');
const db=createDatabase(url),exec=promisify(execFile),session='landscape-repair-'+Date.now();
const cli=resolve(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
const browser=async(...args)=>(await exec(cli,['--session',session,...args],{windowsHide:true,timeout:60000,maxBuffer:5000000})).stdout.trim();
const records={viewport:[1440,1000],build:'production',globalPose:{alpha:-Math.PI/2,beta:1.05,radius:8,phase:0,exaggeration:1},cases:[],health:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let cookie='';
async function request(path,method='GET',body){
 const r=await fetch('http://127.0.0.1:3180'+path,{method,headers:{cookie,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 if(!r.ok)throw Error('QA API '+r.status+' '+path);return r.json();
}
async function selectCandidate(id){
 const snap=await browser('snapshot','-i'),ref=snap.match(/combobox "Candidat"[^\n]*ref=(e\d+)/)[1];
 await browser('select','@'+ref,id);await browser('wait','--text','Résultat mesuré');await browser('wait','2200');
}
try{
 const login=await fetch('http://127.0.0.1:3180/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:fixture.email,password:fixture.password})});
 if(!login.ok)throw Error('QA login failed');cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
 // A closed, immutable baseline fixture; no regeneration of any user candidate.
 const baseline=generateLandscape(42,256,128,DEFAULT_GENERATOR_PARAMETERS,0),baselineId=randomUUID();
 await db.transaction().execute(async tx=>{
  await tx.insertInto('worlds').values({id:baselineId,slug:'candidate-'+baselineId,name:'Baseline r0 / 42 / 256',topology:'torus',widthCells:256,heightCells:128,chunkSize:32,seed:42,generationVersion:3,generationStatus:'ready',generatedAt:new Date(),isOpen:false}).execute();
  await writeV3Chunks(tx,baselineId,baseline);
  await tx.insertInto('worldGenerationCandidates').values({worldId:baselineId,commandId:randomUUID(),ownerAccountId:fixture.id,parameters:DEFAULT_GENERATOR_PARAMETERS,recipeRevision:0,status:'ready',artifact:baseline,metrics:baseline.metrics,checksum:artifactChecksum(baseline)}).execute();
 });
 const cases=[];
 for(const seed of [1,2,42])for(const [width,height]of [[64,64],[256,128],[512,256]]){
  if(seed===42&&width===256)continue;
  const c=await request('/api/admin/world-generator','POST',{commandId:randomUUID(),name:'Repair '+seed+' / '+width,seed,width,height,version:3,parameters:DEFAULT_GENERATOR_PARAMETERS});
  cases.push(c);
 }
 console.log('Eight queued fixtures and one legacy baseline created.');
 const until=Date.now()+180000;
 while(true){
  const start=performance.now();await request('/api/health');records.health.push(performance.now()-start);
  const list=await request('/api/admin/world-generator'),own=list.candidates.filter(c=>cases.some(x=>x.id===c.id));
  if(own.some(c=>c.status==='failed'))throw Error('Generation failed: '+own.filter(c=>c.status==='failed').map(c=>c.error).join('; '));
  if(own.every(c=>c.status==='ready'))break;if(Date.now()>until)throw Error('QA generation timeout');await pause(500);
 }
 await browser('open','http://127.0.0.1:5284/world-generator');await browser('set','viewport','1440','1000');
 await browser('wait','--text','Connexion avec un compte opérateur.');
 await browser('find','label','Adresse email','fill',fixture.email);await browser('find','label','Mot de passe','fill',fixture.password);
 await browser('find','role','button','click','--name','Se connecter');await browser('wait','--text','Paramètres de génération');
 await browser('find','label','Nom','fill','Repair UI 42 / 256');await browser('find','label','Seed','fill','42');
 await browser('find','role','button','click','--name','Générer l’aperçu');await browser('wait','--text','Résultat mesuré');await browser('wait','2200');
 const list=await request('/api/admin/world-generator'),ui=list.candidates.find(c=>c.name==='Repair UI 42 / 256');if(!ui||ui.status!=='ready')throw Error('UI generation not ready');cases.push(ui);
 await browser('select','select[aria-label="Couche"]','altitude');await browser('wait','2200');
 await selectCandidate(baselineId);await browser('screenshot','.generator-canvas','test-results/repair-baseline-altitude.png');records.baseline={stats:await browser('get','text','.generator-stats'),metrics:baseline.metrics};
 for(const candidate of cases.sort((a,b)=>a.seed-b.seed||a.width-b.width)){
  await selectCandidate(candidate.id);
  const capture='test-results/repair-'+candidate.seed+'-'+candidate.width+'-altitude.png';
  await browser('screenshot','.generator-canvas',capture);
  const current=(await request('/api/admin/world-generator')).candidates.find(c=>c.id===candidate.id);
  records.cases.push({candidate:current,capture,stats:await browser('get','text','.generator-stats')});
  console.log('Captured seed '+candidate.seed+' / '+candidate.width+', '+current.metrics.quality.plateauCount+' plateaus.');
 }
 await selectCandidate(ui.id);
 // Exercise camera movement through real input and compare the same terrain layer before/after switching.
 await browser('select','select[aria-label="Couche"]','terrain');await browser('wait','2200');
 const rect=JSON.parse(await browser('--json','eval',"(()=>{const r=document.querySelector('.generator-canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")).data.result;
 await browser('mouse','move',String(Math.round(rect.x)),String(Math.round(rect.y)));await browser('mouse','down');
 await browser('mouse','move',String(Math.round(rect.x+140)),String(Math.round(rect.y+30)));await browser('mouse','up');await browser('wait','4000');
 await browser('screenshot','.generator-canvas','test-results/repair-camera-before.png');
 await browser('select','select[aria-label="Couche"]','altitude');await browser('select','select[aria-label="Couche"]','terrain');await browser('wait','2200');
 await browser('screenshot','.generator-canvas','test-results/repair-camera-after.png');
 await browser('find','role','button','click','--name','Voir un escalier');await browser('wait','2200');
 await browser('screenshot','.generator-canvas','test-results/repair-local-stair.png');records.local=await browser('get','text','.generator-stats');
 await browser('select','select[aria-label="Couche"]','altitude');await browser('wait','2200');await browser('screenshot','.generator-canvas','test-results/repair-local-altitude.png');
 await browser('find','role','button','click','--name','Tore');await browser('select','select[aria-label="Couche"]','terrain');await browser('check','input[aria-label="Atmosphère"]');await browser('wait','3000');
 records.fog=await browser('get','text','.generator-stats');await browser('uncheck','input[aria-label="Atmosphère"]');await browser('check','input[aria-label="Éclairage solaire"]');await browser('wait','3000');
 records.solar=await browser('get','text','.generator-stats');await browser('uncheck','input[aria-label="Éclairage solaire"]');
 for(let i=0;i<3;i++){await browser('find','role','button','click','--name','Inspection locale');await browser('find','role','button','click','--name','Tore');}
 await browser('wait','2200');records.afterCycles=await browser('get','text','.generator-stats');
 records.hardware=JSON.parse(await browser('--json','eval',"(()=>{const gl=document.querySelector('.generator-canvas').getContext('webgl2'),e=gl?.getExtension('WEBGL_debug_renderer_info');return e?{vendor:gl.getParameter(e.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(e.UNMASKED_RENDERER_WEBGL)}:{unavailable:true}})()")).data.result;
 records.errors=JSON.parse(await browser('--json','errors')).data.errors;if(records.errors.length)throw Error('Browser errors: '+JSON.stringify(records.errors));
 await writeFile('test-results/landscape-repair-browser.json',JSON.stringify(records,null,2));console.log('Production matrix, UI generation, layer/camera, local stairs, fog, solar and view cycles complete.');
}finally{await browser('close');await db.destroy();}
