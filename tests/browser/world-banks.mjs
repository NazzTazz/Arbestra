/* global process, console, Buffer */
// Read-only fixtures and actual PreviewScene. Run --before prior to rendering changes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
const exec=promisify(execFile),base=resolve('apps/world-web');
const cli=resolve(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
const browser=async(...args)=>(await exec(cli,['--session','arbestra-banks',...args],{windowsHide:true,timeout:60000,maxBuffer:4000000})).stdout.trim();
const evaluate=code=>browser('eval','-b',Buffer.from(code).toString('base64'));
const stage=process.argv.includes('--before')?'before':'after',records={stage};
await readFile('test-results/geology-42.json');
const harness=`import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PreviewScene} from './src/world-generator/PreviewScene';
import './src/styles.css';
const data=await(await fetch('/@fs/WORKSPACE/test-results/geology-42.json')).json();
function Review(){const [pose,setPose]=useState('river'),[wire,setWire]=useState(false),[grid,setGrid]=useState(false),[stats,setStats]=useState<any>(null);
const poses={river:{x:159.5,y:56.5},stone:{x:103.68,y:1.36},lake:{x:136,y:0},seam:{x:0,y:64},torus:{x:128,y:64},map:{x:128,y:64}};
return <main style={{maxWidth:1200,margin:'auto'}}><h1>Berges et affleurements — seed 42 / r9</h1>{Object.keys(poses).map(p=><button onClick={()=>{setStats(null);setPose(p);}}>{p}</button>)}<button onClick={()=>setWire(!wire)}>Maillage</button><button onClick={()=>setGrid(!grid)}>Grille</button><PreviewScene candidateKey={'fixture42:'+pose} data={data} local={!['torus','map'].includes(pose)} flat={pose==='map'} center={poses[pose]} layer='terrain' fog={false} solar={false} exaggeration={1} cycleDegrees={0} grid={grid} wireframe={wire} onPick={()=>{}} onStats={v=>setStats(v)}/><pre>{JSON.stringify({pose,stats})}</pre></main>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Review/></React.StrictMode>);`.replace('WORKSPACE',resolve('.').replaceAll('\\','/'));
await writeFile(resolve(base,'.banks-review.tsx'),harness);
await writeFile(resolve(base,'banks-review.html'),'<html><head><meta charset="UTF-8"/></head><body><div id="root"></div><script type="module" src="/.banks-review.tsx"></script></body></html>');
try{
 await browser('open','http://localhost:5174/banks-review.html');await browser('set','viewport','1440','1000');
 const capture=async(name)=>{
 await evaluate("document.querySelector('canvas').style.cssText='width:1100px;height:640px;display:block';window.dispatchEvent(new Event('resize'));true");
 await browser('wait','--fn',`document.querySelector('[data-render-status="ready"]') && JSON.parse(document.querySelector('pre').textContent).stats?.renderKey===document.querySelector('.generator-render').dataset.renderKey`);
 records[name]=JSON.parse(await browser('get','text','pre'));
 console.log(stage+': '+name);
 await writeFile('test-results/banks-'+stage+'.json',JSON.stringify(records,null,2));
 await browser('screenshot','test-results/banks-'+stage+'-'+name+'.png');
 };
 for(const pose of ['river','stone','lake','seam','torus','map']){await browser('find','role','button','click','--name',pose,'--exact');await capture(pose);}
 if(stage==='after'){
  await browser('find','role','button','click','--name','river','--exact');
  await browser('find','role','button','click','--name','Grille');await capture('grid');
  await browser('find','role','button','click','--name','Grille');
  await browser('find','role','button','click','--name','Maillage');await capture('wireframe');
  await browser('find','role','button','click','--name','Maillage');
  for(let i=0;i<2;i++)for(const p of ['torus','map','river']){await browser('find','role','button','click','--name',p,'--exact');await browser('wait','--fn',"!!document.querySelector('[data-render-status=ready]')");}
  await capture('return');
  for(const key of ['draws','meshes','indices','residentVertices','materials','textures'])if(records.river.stats[key]!==records.return.stats[key])throw Error('Resources changed after navigation: '+key);

 }
 records.graphics=await evaluate("(()=>{const c=document.querySelector('canvas'),gl=c.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {width:c.width,height:c.height,renderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)};})()");
 records.errors=JSON.parse(await browser('--json','errors')).data.errors;
 await writeFile('test-results/banks-'+stage+'.json',JSON.stringify(records,null,2));
 if(records.errors.length)throw Error(JSON.stringify(records.errors));
 console.log(JSON.stringify(records));
}finally{await browser('close');await rm(resolve(base,'.banks-review.tsx'));await rm(resolve(base,'banks-review.html'));}
