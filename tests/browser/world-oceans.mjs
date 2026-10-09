/* global process, console, Buffer */
// Actual WorldGenerator + Babylon, read-only HTTP fixtures. No account or DB writes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {generateGeographicLandscape,DEFAULT_GEOGRAPHY_PARAMETERS} from '../../packages/contracts/src/world-geography.ts';
const exec=promisify(execFile),base=resolve('apps/world-web');
const cli=resolve(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
const browser=async(...args)=>(await exec(cli,['--session','arbestra-oceans',...args],{windowsHide:true,timeout:60000,maxBuffer:4000000})).stdout.trim();
const evaluate=code=>browser('eval','-b',Buffer.from(code).toString('base64'));
await mkdir('test-results',{recursive:true});
if(!process.argv.includes('--reuse'))for(const seed of [42,7])await writeFile('test-results/oceans-'+seed+'.json',JSON.stringify(generateGeographicLandscape(seed,256,128,DEFAULT_GEOGRAPHY_PARAMETERS,11)));
const a=JSON.parse(await readFile('test-results/oceans-42.json','utf8')),b=JSON.parse(await readFile('test-results/oceans-7.json','utf8'));
const artifacts={a,b};await writeFile('test-results/oceans-artifacts.json',JSON.stringify(artifacts));
const candidates=Object.entries(artifacts).map(([id,d])=>({id,name:'Océans '+id,seed:d.seed,width:d.width,height:d.height,version:3,recipeRevision:d.recipeRevision,status:'ready',attempt:1,revision:1,checksum:'checksum-'+id,parameters:d.geography.parameters,metrics:d.metrics,durationMs:0,retained:false,opened:false,createdAt:'2026-10-08T12:00:00Z',error:null}));
const harness=`import React from 'react';
import {createRoot} from 'react-dom/client';
import {WorldGenerator} from './src/world-generator/WorldGenerator';
import './src/styles.css';
const artifacts=await(await fetch('/@fs/__ROOT__/test-results/oceans-artifacts.json')).json();
const candidates=${JSON.stringify(candidates)};
window.fetch=async(url,init)=>{
 if(init?.method!=='GET')throw Error('Unexpected mutation in read-only fixture');
 if(url==='/api/admin/world-generator')return Response.json({candidates,limits:{maxCells:131072}});
 const id=String(url).split('/')[4];
 if(!artifacts[id])throw Error('Unknown fixture '+url);
 // Deliberately ignore abort: the client must also reject a late response by identity/lifetime.
 return Response.json(artifacts[id]);
};
createRoot(document.getElementById('root')!).render(<React.StrictMode><WorldGenerator/></React.StrictMode>);`.replaceAll('__ROOT__',resolve('.').replaceAll('\\','/'));
await writeFile(resolve(base,'.oceans-review.tsx'),harness);
await writeFile(resolve(base,'oceans-review.html'),'<html><head><meta charset="UTF-8"/></head><body><div id="root"></div><script type="module" src="/.oceans-review.tsx"></script></body></html>');
const records={};
const click=name=>browser('find','role','button','click','--name',name,'--exact');
async function capture(name,view,layer='terrain',id='a'){
 await browser('wait','--fn',`(()=>{const e=document.querySelector('.generator-render');return e?.dataset.renderStatus==='ready'&&e.dataset.view==='${view}'&&e.dataset.layer==='${layer}'&&e.dataset.candidate.startsWith('${id}:');})()`);
 await browser('scrollintoview','.generator-render');
 await browser('wait','--fn',"!!document.querySelector('.generator-stats')?.textContent.includes('FPS')");
 records[name]={inspection:await browser('get','text','[data-ocean-inspection]'),stats:await browser('get','text','.generator-stats')};
 await browser('screenshot','test-results/oceans-'+name+'.png');console.log(name);
}
try{
 await browser('open','http://localhost:5174/oceans-review.html');await browser('set','viewport','1600','1100');
 await browser('wait','--fn',"!!document.querySelector('select[aria-label=Candidat] option[value=a]')");
 await browser('select','select[aria-label="Candidat"]','a');await capture('torus','torus');
 await click('Carte complète');await capture('map','map');
 await browser('select','select[aria-label="Couche"]','accessibility');await capture('land','map','accessibility');
 await click('Plateau relié');await capture('plateau','local','accessibility');
 await browser('select','select[aria-label="Couche"]','terrain');await capture('plateau-terrain','local');
 for(let i=0;i<2;i++){await click('Voir un détroit');await capture('strait-'+i,'local','water');}
 await click('Océan intérieur');await capture('inner','local','water');
 await click('Océan extérieur');await capture('outer','local','water');
 await click('Tore');await browser('select','select[aria-label="Couche"]','terrain');await capture('return','torus');
 await browser('select','select[aria-label="Candidat"]','b');await click('Carte complète');await capture('seed7','map','terrain','b');
 records.graphics=await evaluate("(()=>{const c=document.querySelector('canvas'),gl=c.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {width:c.width,height:c.height,renderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)};})()");
 records.errors=JSON.parse(await browser('--json','errors')).data.errors;
 await writeFile('test-results/oceans-review.json',JSON.stringify(records,null,2));
 if(records.errors.length)throw Error(JSON.stringify(records.errors));console.log(JSON.stringify(records));
}finally{await browser('close');await rm(resolve(base,'.oceans-review.tsx'));await rm(resolve(base,'oceans-review.html'));}
