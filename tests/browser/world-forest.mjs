/* global process, console, Buffer, performance */
// node --import tsx tests/browser/world-forest.mjs; requires world-web dev at 5174.
// Pure generated fixtures: no API, account or database writes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,rm,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {generateGeographicLandscape} from '../../packages/contracts/src/world-geography.ts';
import {DEFAULT_GENERATOR_PARAMETERS as parameters} from '../../packages/contracts/src/world-generator.ts';
const exec=promisify(execFile),base=resolve('apps/world-web');
const cli=resolve(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
const browser=async(...args)=>(await exec(cli,['--session','arbestra-forest',...args],{windowsHide:true,timeout:60000,maxBuffer:4000000})).stdout.trim();
const evaluate=code=>browser('eval','-b',Buffer.from(code).toString('base64'));
const records={generation:[]};
await mkdir('test-results',{recursive:true});
for(const seed of [42,7]){const start=performance.now(),data=generateGeographicLandscape(seed,256,128,parameters,7);await writeFile('test-results/forest-'+seed+'.json',JSON.stringify(data));records.generation.push({seed,ms:performance.now()-start,trees:data.forest.trees.length,coverage:data.forest.coverage,bytes:JSON.stringify(data.forest).length});}
const harness="import React,{useState} from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {PreviewScene} from './src/world-generator/PreviewScene';\nimport './src/styles.css';\nconst root=createRoot(document.getElementById('root')!);\nconst initial=await (await fetch('/@fs/__WORKSPACE__/test-results/forest-42.json')).json();\nfunction Review(){const [data,setData]=useState(initial),[local,setLocal]=useState(false),[center,setCenter]=useState({x:128,y:64}),[layer,setLayer]=useState<any>('terrain'),[phase,setPhase]=useState(0),[stats,setStats]=useState<any>(null);\nreturn <main style={{maxWidth:1200,margin:'auto'}}><h1>Forêts r7 — recette isolée</h1><p>{data.forest.trees.length} arbres · {data.forest.coverage.toFixed(2)} % habitat forestier</p><button onClick={()=>setLocal(v=>!v)}>Tore / local</button><button onClick={()=>setPhase(v=>v+45)}>Tourner</button><button onClick={()=>setLayer(v=>v==='terrain'?'altitude':'terrain')}>Couche</button><button onClick={()=>{const t=data.forest.trees[0];setCenter({x:Math.floor(t.x),y:Math.floor(t.y)});setLocal(true);}}>Bosquet</button><button onClick={()=>{setCenter({x:0,y:0});setLocal(true);}}>Couture</button><button onClick={async()=>{setData(await(await fetch('/@fs/__WORKSPACE__/test-results/forest-7.json')).json());}}>Seed 7</button><PreviewScene data={data} local={local} center={center} layer={layer} fog={false} solar={false} exaggeration={1} cycleDegrees={phase} onPick={(x,y)=>{setCenter({x,y});setLocal(true);}} onStats={setStats}/><pre>{JSON.stringify(stats)}</pre></main>}\nroot.render(<Review/>);\n".replaceAll('__WORKSPACE__',resolve('.').replaceAll('\\','/'));
await writeFile(resolve(base,'.forest-review.tsx'),harness);
await writeFile(resolve(base,'forest-review.html'),'<html><head><meta charset="UTF-8"/></head><body><div id="root"></div><script type="module" src="/.forest-review.tsx"></script></body></html>');
try{
 await browser('open','http://localhost:5174/forest-review.html');await browser('set','viewport','1440','1000');
 const resize=()=>evaluate("document.querySelector('canvas').style.cssText='width:1100px;height:640px;display:block';window.dispatchEvent(new Event('resize'));true");
 const capture=async(name)=>{await resize();await evaluate('(async()=>{await new Promise(r=>setTimeout(r,2300));return true;})()');records[name]=await browser('get','text','pre');await browser('screenshot','test-results/forest-r7-'+name+'.png');};
 await capture('torus');
 await browser('find','role','button','click','--name','Bosquet');await capture('local');
 await browser('find','role','button','click','--name','Couture');await capture('seam');
 for(let i=0;i<3;i++){await browser('find','role','button','click','--name','Couche');await browser('find','role','button','click','--name','Couche');await browser('find','role','button','click','--name','Tore / local');await browser('find','role','button','click','--name','Tourner');await browser('find','role','button','click','--name','Tore / local');}
 await browser('find','role','button','click','--name','Tore / local');await capture('return');
 await browser('find','role','button','click','--name','Seed 7');await capture('seed7');
 records.graphics=await evaluate("(()=>{const c=document.querySelector('canvas'),gl=c.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {width:c.width,height:c.height,renderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)};})()");
 records.errors=JSON.parse(await browser('--json','errors')).data.errors;
 await writeFile('test-results/forest-r7-review.json',JSON.stringify(records,null,2));
 if(records.errors.length)throw Error(JSON.stringify(records.errors));
 console.log(JSON.stringify(records));
}finally{
 await browser('close');
 await rm(resolve(base,'.forest-review.tsx'));await rm(resolve(base,'forest-review.html'));
}
