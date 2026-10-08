/* global process, console, fetch, performance, setTimeout */
// Production preview QA via the agent-browser skill; run with the isolated QA API and Vite preview.
import {generateLandscape,DEFAULT_GENERATOR_PARAMETERS} from '../../packages/contracts/src/index.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const exec=promisify(execFile),fixture=JSON.parse(await readFile('test-results/world-generator-fixture.json','utf8'));
const cli=resolve(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'),session='arbestra-generator-'+Date.now();
const browser=async(...args)=>(await exec(cli,['--session',session,...args],{windowsHide:true,timeout:45000,maxBuffer:4000000})).stdout.trim();
const records={viewport:[1440,1000],poses:{global:{alpha:-Math.PI/2,beta:1.05,radius:8,phase:0,exaggeration:1},
 local:{alpha:-Math.PI/2,beta:.78,radius:23,window:32,phase:0,altitudeCellRatio:.25}},samples:{},health:[],errors:[]};
async function warmup(){await browser('wait','2200');}
async function health(n){for(let i=0;i<n;i++){const start=performance.now();const r=await fetch('http://127.0.0.1:3180/api/health');if(!r.ok)throw Error('Health failed');records.health.push(performance.now()-start);await new Promise(r=>setTimeout(r,100));}}
try{
 await browser('cookies','clear');await browser('errors','--clear');
 await browser('open','http://127.0.0.1:5284/world-generator');
 await browser('set','viewport','1440','1000');
 await browser('wait','--text','Connexion avec un compte opérateur.');
 await browser('find','label','Adresse email','fill',fixture.email);
 await browser('find','label','Mot de passe','fill',fixture.password);
 await browser('find','role','button','click','--name','Se connecter');
 await browser('wait','--text','Paramètres de génération');
 await browser('find','label','Nom','fill','Recette A-B 42');
 await browser('find','label','Seed','fill','42');
 await browser('find','role','button','click','--name','Générer l’aperçu');
 const monitoring=health(30);
 await browser('wait','--text','Résultat mesuré');await monitoring;await warmup();
 records.samples.global=await browser('get','text','.generator-stats');
 records.metrics=await browser('get','text','.generator-metrics');
 await browser('screenshot','.generator-canvas','test-results/world-generator-torus-final.png');
 await browser('find','role','button','click','--name','Voir un escalier');await warmup();
 records.samples.local=await browser('get','text','.generator-stats');

 const d=generateLandscape(42,256,128,DEFAULT_GENERATOR_PARAMETERS);records.stairPoses=[];
 for(const axis of [0,1])for(const ascending of [true,false]){
  const s=d.stairs.find(s=>s.direction===axis&&(d.elevations[s.to]>d.elevations[s.from])===ascending);if(!s)throw Error('Missing stair pose');
  await browser('find','label','X','fill',String(s.x));await browser('find','label','Y','fill',String(s.y));await warmup();
  const capture='test-results/stair-'+axis+'-'+(ascending?'up':'down')+'.png';
  await browser('screenshot','.generator-canvas',capture);records.stairPoses.push({axis,ascending,x:s.x,y:s.y,width:s.width,capture});
 }

 await browser('screenshot','.generator-canvas','test-results/world-generator-stairs-final.png');
 await browser('select','select[aria-label="Couche"]','accessibility');await warmup();
 await browser('screenshot','.generator-canvas','test-results/world-generator-access-final.png');
 await browser('select','select[aria-label="Couche"]','exposure');await warmup();
 await browser('screenshot','.generator-canvas','test-results/world-generator-exposure-final.png');
 await browser('select','select[aria-label="Couche"]','terrain');
 await browser('find','role','button','click','--name','Tore');await warmup();
 await browser('check','input[aria-label="Atmosphère"]');await warmup();
 for(let i=0;i<20;i++){records.samples.fog=await browser('get','text','.generator-stats');if(records.samples.fog.includes('3 passes'))break;await browser('wait','1000');}
 if(!records.samples.fog.includes('3 passes'))throw Error('Atmosphere did not initialize');
 await browser('screenshot','.generator-canvas','test-results/world-generator-fog-final.png');
 await browser('uncheck','input[aria-label="Atmosphère"]');
 await browser('check','input[aria-label="Éclairage solaire"]');await warmup();
 records.samples.solar=await browser('get','text','.generator-stats');
 await browser('screenshot','.generator-canvas','test-results/world-generator-solar-final.png');
 await browser('uncheck','input[aria-label="Éclairage solaire"]');
 for(let i=0;i<3;i++){
  await browser('find','role','button','click','--name','Inspection locale');
  await browser('find','role','button','click','--name','Tore');
 }
 await warmup();records.samples.afterCycles=await browser('get','text','.generator-stats');
 await browser('find','role','button','click','--name','Conserver ce monde');await browser('wait','--text','conservé');
 records.openDisabled=await browser('get','attr','button:disabled','disabled');
 records.console=await browser('console');
 records.gpu=await browser('eval','(() => { const gl=document.querySelector("canvas").getContext("webgl2"); const e=gl.getExtension("WEBGL_debug_renderer_info"); return {renderer:gl.getParameter(e?e.UNMASKED_RENDERER_WEBGL:gl.RENDERER),version:gl.getParameter(gl.VERSION)}; })()');
 records.errors=JSON.parse(await browser('--json','errors')).data.errors;if(records.errors.length)throw Error('Browser errors: '+JSON.stringify(records.errors));
 await browser('set','viewport','390','844');await browser('screenshot','--full','test-results/world-generator-mobile-final.png');
 records.mobile=JSON.parse(await browser('eval','({width:innerWidth,scroll:document.documentElement.scrollWidth})'));if(records.mobile.scroll>records.mobile.width)throw Error('Mobile horizontal overflow');
 await browser('set','viewport','1440','1000');
 await writeFile('test-results/world-generator-browser.json',JSON.stringify(records,null,2));
 console.log(JSON.stringify(records,null,2));
}catch(error){
 records.failure=String(error);records.errors=await browser('errors').catch(()=>[]);
 await writeFile('test-results/world-generator-browser.json',JSON.stringify(records,null,2));throw error;
}
