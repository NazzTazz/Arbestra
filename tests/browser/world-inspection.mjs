/* global process, console, Buffer */
// Actual WorldGenerator + Babylon, read-only HTTP fixtures. No account or DB writes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {generateGeographicLandscape,DEFAULT_GEOGRAPHY_PARAMETERS} from '../../packages/contracts/src/world-geography.ts';
const exec=promisify(execFile),base=resolve('apps/world-web');
const cli=resolve(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
const browser=async(...args)=>(await exec(cli,['--session','arbestra-inspection',...args],{windowsHide:true,timeout:60000,maxBuffer:4000000})).stdout.trim();
const evaluate=code=>browser('eval','-b',Buffer.from(code).toString('base64'));
await mkdir('test-results',{recursive:true});
const a=JSON.parse(await readFile('test-results/geology-42.json','utf8'));
const b=JSON.parse(await readFile('test-results/geology-7.json','utf8'));
const sea=generateGeographicLandscape(123,64,64,{...DEFAULT_GEOGRAPHY_PARAMETERS,waterPercent:100},9);
// Explicit all-sea UI regression with the historical misleading forest percentage.
// A request for 100% water alone is not a guarantee: real generation may leave dry slivers.
sea.geography={...sea.geography,cutoff:2,scale:1,positiveScale:1,negativeScale:1,rivers:[],lakes:[],lakeDepth:sea.geography.lakeDepth.map(()=>0),filled:sea.geography.filled.map(()=>0)};
sea.terrainCodes.fill(2);sea.elevations.fill(-16);sea.woodland.fill(0);sea.forest.trees=[];sea.stoneSites=[];
Object.assign(sea.metrics,{waterPercent:100,treePercent:50,meanElevation:-16,minElevation:-16,maxElevation:-16,amplitude:0});
const artifacts={a,b,sea};await writeFile('test-results/inspection-artifacts.json',JSON.stringify(artifacts));
const candidates=Object.entries(artifacts).map(([id,d])=>({id,name:'Inspection '+id,seed:d.seed,width:d.width,height:d.height,version:3,recipeRevision:d.recipeRevision,status:'ready',attempt:1,revision:1,checksum:'checksum-'+id,parameters:d.geography.parameters,metrics:d.metrics,durationMs:0,retained:false,opened:false,createdAt:'2026-10-08T12:00:00Z',error:null}));
const harness=`import React from 'react';
import {createRoot} from 'react-dom/client';
import {WorldGenerator} from './src/world-generator/WorldGenerator';
import './src/styles.css';
const artifacts=await(await fetch('/@fs/__ROOT__/test-results/inspection-artifacts.json')).json();
const candidates=${JSON.stringify(candidates)};
window.fetch=async(url,init)=>{
 if(init?.method!=='GET')throw Error('Unexpected mutation in read-only fixture');
 if(url==='/api/admin/world-generator')return Response.json({candidates,limits:{maxCells:131072}});
 const id=String(url).split('/')[4];
 if(!artifacts[id])throw Error('Unknown fixture '+url);
 // Deliberately ignore abort: the client must also reject a late response by identity/lifetime.
 if(id==='b'&&window.__holdB){await new Promise(r=>{window.__releaseB=r;});window.__bReturned=true;}
 return Response.json(artifacts[id]);
};
createRoot(document.getElementById('root')!).render(<React.StrictMode><WorldGenerator/></React.StrictMode>);`.replaceAll('__ROOT__',resolve('.').replaceAll('\\','/'));
await writeFile(resolve(base,'.inspection-review.tsx'),harness);
await writeFile(resolve(base,'inspection-review.html'),'<html><head><meta charset="UTF-8"/></head><body><div id="root"></div><script type="module" src="/.inspection-review.tsx"></script></body></html>');
const records={};
const waitReady=async(view,id='a',layer='terrain')=>{
 await browser('wait','--fn',`(()=>{const e=document.querySelector('.generator-render');return e?.dataset.renderStatus==='ready'&&e.dataset.view==='${view}'&&e.dataset.layer==='${layer}'&&e.dataset.candidate.startsWith('${id}:');})()`);
 records[view+'-'+id+'-'+layer]=await evaluate(`document.querySelector('.generator-render').dataset.renderKey`);
};
const click=name=>browser('find','role','button','click','--name',name,'--exact');
try{
 await browser('open','http://localhost:5174/inspection-review.html');await browser('set','viewport','1600','1100');
 await browser('select','select[aria-label="Candidat"]','a');await waitReady('torus');
 await click('Carte complète');await waitReady('map');
 await browser('scrollintoview','.generator-render');await browser('screenshot','test-results/inspection-map-terrain.png');
 if(!process.argv.includes('--race-only')){
 await click('Reprendre ces paramètres');
 await evaluate(`(()=>{const labels=[...document.querySelectorAll('label')];const seed=labels.find(l=>l.textContent==='Seed')?.querySelector('input');if(seed?.value!=='42')throw Error('Seed not copied');if(!document.querySelector('.generator-candidate').textContent.includes('Seed 42'))throw Error('Immutable parameters missing');return true;})()`);
 for(const layer of ['altitude','water','exposure','humidity','terrain']){await browser('select','select[aria-label="Couche"]',layer);await waitReady('map','a',layer);if(layer==='altitude'||layer==='water')await browser('screenshot','test-results/inspection-map-'+layer+'.png');}
 await browser('find','label','Grille et chunks','click');await waitReady('map');await browser('screenshot','test-results/inspection-map-grid.png');await browser('find','label','Grille et chunks','click');
 await browser('find','label','Maillage','click');await waitReady('map');await browser('find','label','Maillage','click');
 // Native controls exercise rapid layer/amplification changes, then assert the exact rendered identity.
 for(let i=0;i<3;i++){
  await browser('select','select[aria-label="Amplification globale"]','4');await waitReady('map');
  await browser('select','select[aria-label="Couche"]','altitude');await waitReady('map','a','altitude');
  await browser('select','select[aria-label="Amplification globale"]','1');
  await click('Tore');await waitReady('torus','a','altitude');
  await browser('select','select[aria-label="Couche"]','terrain');await click('Carte complète');await waitReady('map');
 }
 }
 // A late response for b must never replace the selected a.
 await evaluate('window.__holdB=true;window.__bReturned=false');
 await browser('select','select[aria-label="Candidat"]','b');await browser('wait','--fn','typeof window.__releaseB==="function"');
 await browser('select','select[aria-label="Candidat"]','a');await waitReady('map');
 await evaluate('window.__holdB=false;window.__releaseB();true');await browser('wait','--fn','window.__bReturned===true');
 await browser('wait','--fn',`document.querySelector('.generator-stats')?.textContent.includes('FPS')`);
 await evaluate(`(()=>{const e=document.querySelector('.generator-render');if(!e.dataset.candidate.startsWith('a:'))throw Error('Late artifact replaced selection');return true;})()`);
 await browser('click','canvas');await waitReady('local');await click('Carte complète');await waitReady('map');
 await browser('select','select[aria-label="Candidat"]','sea');await waitReady('map','sea');
 await browser('wait','--text','Non applicable : aucune terre');await browser('screenshot','test-results/inspection-map-sea.png');
 await browser('select','select[aria-label="Candidat"]','b');await waitReady('map','b');
 await browser('screenshot','test-results/inspection-map-seed7.png');
 records.errors=JSON.parse(await browser('--json','errors')).data.errors;
 await writeFile(process.argv.includes('--race-only')?'test-results/inspection-race-review.json':'test-results/inspection-review.json',JSON.stringify(records,null,2));
 if(records.errors.length)throw Error(JSON.stringify(records.errors));
 console.log(JSON.stringify(records));
}finally{await browser('close');await rm(resolve(base,'.inspection-review.tsx'));await rm(resolve(base,'inspection-review.html'));}
