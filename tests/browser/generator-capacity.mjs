/* global process, console, Buffer */
// Real WorldGenerator component, isolated HTTP fixture: no API account or database writes.
// Requires Vite development server at localhost:5174. API acceptance has an integration test.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,rm,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const exec=promisify(execFile),base=resolve('apps/world-web');
const cli=resolve(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
const browser=async(...args)=>(await exec(cli,['--session','arbestra-capacity',...args],{windowsHide:true,timeout:45000,maxBuffer:4000000})).stdout.trim();
const evaluate=code=>browser('eval','-b',Buffer.from(code).toString('base64'));
const harness=`import React from 'react';
import {createRoot} from 'react-dom/client';
import {WorldGenerator} from './src/world-generator/WorldGenerator';
import './src/styles.css';
const candidates=Array.from({length:13},(_,i)=>({id:'fixture-'+i,name:'Candidat '+(i+1),seed:i,width:256,height:128,version:3,recipeRevision:9,status:'pending',attempt:0,revision:1,retained:false,opened:false,createdAt:'2026-10-08T12:00:00Z'}));
window.fetch=async(url,init)=>{if(String(url)!=='/api/admin/world-generator'||init?.method!=='GET')throw Error('Unexpected request in read-only UI fixture');return new Response(JSON.stringify({candidates,limits:{maxCells:131072}}),{status:200,headers:{'Content-Type':'application/json'}});};
createRoot(document.getElementById('root')!).render(<WorldGenerator/>);`;
await mkdir('test-results',{recursive:true});
await writeFile(resolve(base,'.capacity-review.tsx'),harness);
await writeFile(resolve(base,'capacity-review.html'),'<html><head><meta charset="UTF-8"/></head><body><div id="root"></div><script type="module" src="/.capacity-review.tsx"></script></body></html>');
try{
 await browser('open','http://localhost:5174/capacity-review.html');await browser('set','viewport','1440','1000');
 await browser('wait','--text','13 aperçus sauvegardés.');
 await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Générer l’aperçu');if(!b||b.disabled)throw Error('Generation disabled beyond twelve');if(document.body.textContent.includes('Limite d’aperçus atteinte'))throw Error('Legacy capacity message');return true;})()`);
 await browser('screenshot','test-results/generator-capacity-unlimited.png');
 const errors=JSON.parse(await browser('--json','errors')).data.errors;if(errors.length)throw Error(JSON.stringify(errors));
 await writeFile('test-results/generator-capacity-browser.json',JSON.stringify({candidates:13,generateEnabled:true,errors},null,2));
 console.log('Real panel accepts thirteen saved candidates; no capacity warning, no browser errors. HTTP fixture only.');
}finally{await browser('close');await rm(resolve(base,'.capacity-review.tsx'));await rm(resolve(base,'capacity-review.html'));}
