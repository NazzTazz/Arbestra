/* global process, console, Buffer, performance */
// Read-only fixtures and actual PreviewScene. --before compares the retained r9 recipe.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {generateGeographicLandscape} from '../../packages/contracts/src/world-geography.ts';
const exec=promisify(execFile),base=resolve('apps/world-web');
const cli=resolve(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
const browser=async(...args)=>(await exec(cli,['--session','arbestra-solar-banks',...args],{windowsHide:true,timeout:60000,maxBuffer:4000000})).stdout.trim();
const evaluate=code=>browser('eval','-b',Buffer.from(code).toString('base64'));
const stage=process.argv.includes('--before')?'before':'after',records={stage};
const reference=JSON.parse(await readFile('test-results/geology-42.json','utf8'));
if(stage==='after'&&!process.argv.includes('--reuse')){
 for(const seed of [42,7]){const started=performance.now(),data=generateGeographicLandscape(seed,256,128,reference.geography.parameters,10);await writeFile('test-results/solar-'+seed+'.json',JSON.stringify(data));console.log('generated',seed,Math.round(performance.now()-started),data.metrics);}
}
const fixture=stage==='before'?'geology-42.json':'solar-42.json';
await readFile('test-results/geology-42.json');
const harness=`import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PreviewScene} from './src/world-generator/PreviewScene';
import './src/styles.css';
const initial=await(await fetch('/@fs/WORKSPACE/test-results/FIXTURE')).json();
function Review(){const [data,setData]=useState(initial),[phase,setPhase]=useState(0),[layer,setLayer]=useState<any>('terrain'),[fog,setFog]=useState(false);const [pose,setPose]=useState('river'),[wire,setWire]=useState(false),[grid,setGrid]=useState(false),[stats,setStats]=useState<any>(null);
const poses={river:{x:159.5,y:56.5},stone:{x:103.68,y:1.36},lake:{x:136,y:0},seam:{x:0,y:64},torus:{x:128,y:64},map:{x:128,y:64}};
return <main style={{maxWidth:1200,margin:'auto'}}><h1>Circulation solaire et berges — ${stage==='before'?'r9':'r10'}</h1>{Object.keys(poses).map(p=><button onClick={()=>{setStats(null);setPose(p);}}>{p}</button>)}<button onClick={()=>setWire(!wire)}>Maillage</button><button onClick={()=>setGrid(!grid)}>Grille</button><button onClick={()=>setLayer(layer==='terrain'?'water':'terrain')}>Courants</button><button onClick={()=>setPhase((phase+90)%360)}>Phase</button><button onClick={()=>setFog(!fog)}>Nuages</button><button onClick={async()=>{setStats(null);setData(await(await fetch('/@fs/WORKSPACE/test-results/solar-7.json')).json());}}>Seed 7</button><PreviewScene candidateKey={'fixture'+data.seed+':'+pose} data={data} local={!['torus','map'].includes(pose)} flat={pose==='map'} center={poses[pose]} layer={layer} fog={fog} solar={false} exaggeration={1} cycleDegrees={phase} grid={grid} wireframe={wire} onPick={()=>{}} onStats={v=>setStats(v)}/><pre>{JSON.stringify({pose,stats})}</pre></main>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Review/></React.StrictMode>);`.replaceAll('WORKSPACE',resolve('.').replaceAll('\\','/')).replace('FIXTURE',fixture);
await writeFile(resolve(base,'.solar-banks-review.tsx'),harness);
await writeFile(resolve(base,'solar-banks-review.html'),'<html><head><meta charset="UTF-8"/></head><body><div id="root"></div><script type="module" src="/.solar-banks-review.tsx"></script></body></html>');
try{
 await browser('open','http://localhost:5174/solar-banks-review.html');await browser('set','viewport','1440','1000');
 await browser('wait','--fn',"!!document.querySelector('button')");
 const capture=async(name)=>{
 await evaluate("document.querySelector('canvas').style.cssText='width:1100px;height:640px;display:block';window.dispatchEvent(new Event('resize'));true");
 await browser('wait','--fn',`document.querySelector('[data-render-status="ready"]') && JSON.parse(document.querySelector('pre').textContent).stats?.renderKey===document.querySelector('.generator-render').dataset.renderKey`);
 records[name]=JSON.parse(await browser('get','text','pre'));
 console.log(stage+': '+name);
 await writeFile('test-results/solar-banks-'+stage+'.json',JSON.stringify(records,null,2));
 await browser('screenshot','test-results/solar-banks-'+stage+'-'+name+'.png');
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
  await browser('find','role','button','click','--name','Courants','--exact');await capture('currents-0');
  const count=JSON.parse(await evaluate("Number(document.querySelector('canvas').dataset.flowCount)"));if(count<=0)throw Error('No current arrows');
  await browser('find','role','button','click','--name','Phase','--exact');
  await browser('wait','--fn',"Number(document.querySelector('canvas').dataset.renderPhase)===90");await capture('currents-90');
  await browser('find','role','button','click','--name','Courants','--exact');
  await capture('return-from-currents');
  for(const key of ['draws','meshes','indices','residentVertices','materials','textures'])if(records.river.stats[key]!==records['return-from-currents'].stats[key])throw Error('Resources changed after currents: '+key);
  await browser('find','role','button','click','--name','Seed 7','--exact');await capture('seed7');
  await browser('find','role','button','click','--name','torus','--exact');
  await browser('find','role','button','click','--name','Nuages','--exact');
  await browser('wait','--fn',"Number(document.querySelector('canvas').dataset.weatherTime)===1767247200000");await capture('clouds-90');
  for(let i=0;i<3;i++)await browser('find','role','button','click','--name','Phase','--exact');
  await browser('wait','--fn',"Number(document.querySelector('canvas').dataset.weatherTime)===1767225600000");await capture('clouds-return-0');


 }
 records.graphics=await evaluate("(()=>{const c=document.querySelector('canvas'),gl=c.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {width:c.width,height:c.height,renderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)};})()");
 records.errors=JSON.parse(await browser('--json','errors')).data.errors;
 await writeFile('test-results/solar-banks-'+stage+'.json',JSON.stringify(records,null,2));
 if(records.errors.length)throw Error(JSON.stringify(records.errors));
 console.log(JSON.stringify(records));
}catch(error){records.failure=String(error);records.errors=await browser('--json','errors');await writeFile('test-results/solar-banks-failure.json',JSON.stringify(records,null,2));await browser('screenshot','test-results/solar-banks-failure.png');throw error;}finally{await browser('close');await rm(resolve(base,'.solar-banks-review.tsx'));await rm(resolve(base,'solar-banks-review.html'));}
