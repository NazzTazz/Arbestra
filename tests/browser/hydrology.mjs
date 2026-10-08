/* global process,console,fetch,setTimeout,performance */
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DEFAULT_GENERATOR_PARAMETERS,basinTide,LANDSCAPE_RECIPE_REVISION} from '../../packages/contracts/src/index.ts';
const fixture=JSON.parse(await readFile('test-results/world-generator-fixture.json','utf8'));
const exec=promisify(execFile),session='hydrology-'+Date.now(),cli=resolve(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
const browser=async(...args)=>{try{return (await exec(cli,['--session',session,...args],{windowsHide:true,timeout:60000,maxBuffer:5000000})).stdout.trim();}catch{throw Error('Browser command failed: '+args[0]);}};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let cookie='';const records={viewport:[1440,1000],build:'production',health:[],poses:[],candidates:[]};
async function api(path,method='GET',body){
 const r=await fetch('http://127.0.0.1:3180'+path,{method,headers:{cookie,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 if(!r.ok)throw Error('QA API '+r.status+' '+path);return r.json();
}
async function ready(id){
 const until=Date.now()+180000;
 while(Date.now()<until){const t=performance.now();await api('/api/health');records.health.push(performance.now()-t);
 const c=(await api('/api/admin/world-generator')).candidates.find(c=>c.id===id);if(c.status==='failed')throw Error(c.error);if(c.status==='ready')return c;await pause(500);}
 throw Error('Candidate timeout');
}
async function choose(id){const snap=await browser('snapshot','-i'),ref=snap.match(/combobox "Candidat"[^\n]*ref=(e\d+)/)[1];await browser('select','@'+ref,id);await browser('wait','--text','Résultat mesuré');await browser('wait','2200');}
async function capture(name){console.log('Capture '+name);await browser('wait','2200');await browser('screenshot','.generator-canvas','test-results/hydro-meander-'+name+'.png');return await browser('get','text','.generator-stats');}
try{
 const login=await fetch('http://127.0.0.1:3180/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:fixture.email,password:fixture.password})});
 if(!login.ok)throw Error('QA login failed');cookie=login.headers.getSetCookie()[0].split(';')[0];const split=cookie.indexOf('=');
 await browser('cookies','set',cookie.slice(0,split),cookie.slice(split+1),'--url','http://127.0.0.1:5284','--httpOnly');
 await browser('open','http://127.0.0.1:5284/world-generator');await browser('set','viewport','1440','1000');await browser('wait','--text','Paramètres de génération');
 await browser('find','label','Nom','fill','Hydrology UI 42 / 256');await browser('find','label','Seed','fill','42');
 const existing=(await api('/api/admin/world-generator')).candidates.find(c=>c.name==='Hydrology UI 42 / 256');if(existing)await choose(existing.id);else await browser('find','role','button','click','--name','Générer l’aperçu');
 await browser('wait','--text','Résultat mesuré');const main=(await api('/api/admin/world-generator')).candidates.find(c=>c.name==='Hydrology UI 42 / 256');
 if(!main)throw Error('UI candidate missing');const complete=await ready(main.id);records.candidates.push(complete);
 const data=await api('/api/admin/world-generator/'+main.id+'/preview');if(!data.hydrology?.waterfalls.length)throw Error('No waterfall');
 records.hydrology=data.hydrology.metrics;
 if(data.recipeRevision!==LANDSCAPE_RECIPE_REVISION||data.hydrology.waterfalls.some(f=>f.width<5||f.width>8||f.lanes?.length!==f.width))throw Error('Invalid broad fronts');
 await browser('select','select[aria-label="Couche"]','water');records.global=await capture('global-water');
 await browser('select','select[aria-label="Couche"]','altitude');records.altitude=await capture('global-altitude');
 await browser('find','role','button','click','--name','Voir une rivi\u00e8re');records.river=await capture('river-terrain');
 await browser('find','role','button','click','--name','Voir une cascade');for(let z=0;z<2;z++)await browser('find','role','button','click','--name','Zoom avant','--exact');
 for(const drop of [...new Set(data.hydrology.waterfalls.map(f=>f.drop))]){
  const f=data.hydrology.waterfalls.find(f=>f.drop===drop);if(!f)throw Error('Missing waterfall '+drop);
  const middle=f.lanes?.[Math.floor(f.width/2)]?.cell??f.cell;const x=middle%data.width,y=Math.floor(middle/data.width);
  await browser('find','label','X','fill',String(x));await browser('find','label','Y','fill',String(y));await browser('select','select[aria-label="Couche"]','water');
  records.poses.push({drop,x,y,fall:f,stats:await capture('fall-'+drop)});
 }
 // The exact phase control drives the same persisted sea anchor used by the shared tide function.
 const sea=data.hydrology.reaches.find(r=>r.kind==='sea'),phases=Array.from({length:361},(_,i)=>({phase:i,level:basinTide(data,sea,i/360*Math.PI*2)})).sort((a,b)=>a.level-b.level);
 const foot=data.hydrology.waterfalls.find(f=>data.hydrology.reaches[f.to].kind==='sea'||data.hydrology.reaches[f.to].tideAnchor!==undefined);
 const cell=foot?.nextCell??sea.anchor;
 await browser('find','label','X','fill',String(cell%data.width));await browser('find','label','Y','fill',String(Math.floor(cell/data.width)));
 for(const [name,sample]of [['low',phases[0]],['high',phases.at(-1)]]){
  await browser('find','label','Phase exacte','fill',String(sample.phase));
  records[name]={...sample,stats:await capture('tide-'+name)};
 }
 await browser('find','label','Phase exacte','fill','0');await browser('select','select[aria-label="Couche"]','altitude');await capture('camera-before');
 await browser('select','select[aria-label="Couche"]','water');await browser('select','select[aria-label="Couche"]','altitude');await capture('camera-after');
 records.cameraPreserved=(await readFile('test-results/hydro-meander-camera-before.png')).equals(await readFile('test-results/hydro-meander-camera-after.png'));if(!records.cameraPreserved)throw Error('Camera changed across layers');
 const oldLarge=(await api('/api/admin/world-generator')).candidates.find(c=>c.name==='Hydrology 42 / 512');const large=oldLarge??await api('/api/admin/world-generator','POST',{commandId:randomUUID(),name:'Hydrology 42 / 512',seed:42,width:512,height:256,version:3,parameters:DEFAULT_GENERATOR_PARAMETERS});
 const largeReady=await ready(large.id);records.candidates.push(largeReady);await choose(large.id);const largeData=await api('/api/admin/world-generator/'+large.id+'/preview');
 await browser('find','role','button','click','--name','Tore','--exact');await browser('select','select[aria-label="Couche"]','water');records.large=await capture('large-water');records.largeHydrology=largeData.hydrology.metrics;
 const broad=largeData.hydrology.waterfalls.filter(f=>f.drop===2).sort((a,b)=>b.width-a.width)[0];if(!broad)throw Error('Missing broad drop2');
 const middle=broad.lanes[Math.floor(broad.width/2)].cell;
 await browser('find','role','button','click','--name','Inspection locale');await browser('find','label','X','fill',String(middle%largeData.width));await browser('find','label','Y','fill',String(Math.floor(middle/largeData.width)));
 records.broadFall={fall:broad,stats:await capture('broad-fall')};
 const channel=largeData.hydrology.channels[0];
 if(channel){const i=channel.cells[Math.floor(channel.cells.length/2)];await browser('find','role','button','click','--name','Inspection locale');await browser('find','label','X','fill',String(i%largeData.width));await browser('find','label','Y','fill',String(Math.floor(i/largeData.width)));records.channel=await capture('channel');}
 await choose(main.id);
 for(let i=0;i<3;i++){await browser('find','role','button','click','--name','Tore','--exact');await browser('find','role','button','click','--name','Inspection locale');}
 await browser('select','select[aria-label="Couche"]','terrain');await browser('check','input[aria-label="Éclairage solaire"]');records.solar=await capture('solar');
 await browser('uncheck','input[aria-label="Éclairage solaire"]');await browser('find','role','button','click','--name','Tore','--exact');await browser('check','input[aria-label="Atmosphère"]');records.fog=await capture('fog');await browser('uncheck','input[aria-label="Atmosphère"]');records.afterCycles=await capture('after-cycles');
 records.hardware=JSON.parse(await browser('--json','eval',"(()=>{const gl=document.querySelector('canvas').getContext('webgl2');const e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:e?gl.getParameter(e.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR)}})()")).data.result;
 records.errors=JSON.parse(await browser('--json','errors')).data.errors;records.console=JSON.parse(await browser('--json','console')).data;
 await writeFile('test-results/hydrology-meander-browser.json',JSON.stringify(records,null,2));
 if(records.errors.length||/INVALID_OPERATION|Unable to compile|Error.*shader|WebGL: INVALID/i.test(JSON.stringify(records.console)))throw Error('Browser or shader errors');
 console.log('Hydrology browser recipe complete: broad falls, tidal phases, global/local cycles and shaders.');
}finally{await browser('close');}
