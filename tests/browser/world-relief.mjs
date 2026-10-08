/* global process, console, Buffer, performance */
// node --import tsx tests/browser/world-relief.mjs; requires world-web dev at 5174.
// Pure generated fixtures: no API, account or database writes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {generateGeographicLandscape} from '../../packages/contracts/src/world-geography.ts';
import {DEFAULT_GEOGRAPHY_PARAMETERS as parameters} from '../../packages/contracts/src/world-geography.ts';
const exec=promisify(execFile),base=resolve('apps/world-web');
const cli=resolve(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
const browser=async(...args)=>(await exec(cli,['--session','arbestra-relief',...args],{windowsHide:true,timeout:60000,maxBuffer:4000000})).stdout.trim();
const evaluate=code=>browser('eval','-b',Buffer.from(code).toString('base64'));
const recipe=process.argv.includes('--geology')?9:8,prefix=recipe===9?'geology':'relief';
const records={generation:[]};
await mkdir('test-results',{recursive:true});
for(const seed of [42,7]){const start=performance.now(),data=process.argv.includes('--reuse')?JSON.parse(await readFile('test-results/'+prefix+'-'+seed+'.json','utf8')):generateGeographicLandscape(seed,256,128,parameters,recipe);if(data.recipeRevision!==recipe||data.seed!==seed)throw Error('Wrong cached fixture');await writeFile('test-results/'+prefix+'-'+seed+'.json',JSON.stringify(data));records.generation.push({seed,reused:process.argv.includes('--reuse'),ms:performance.now()-start,trees:data.forest.trees.length,coverage:data.forest.coverage,sites:data.stoneSites.length,metrics:data.metrics});}
const harness="import React,{useState,useEffect} from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {PreviewScene} from './src/world-generator/PreviewScene';\nimport './src/styles.css';\nimport {illumination} from '@arbestra/contracts/cosmology';\nconst root=createRoot(document.getElementById('root')!);\nconst initial=await (await fetch('/@fs/__WORKSPACE__/test-results/relief-42.json')).json();\nfunction Review(){const [grid,setGrid]=useState(false),[wireframe,setWireframe]=useState(false);const [solar,setSolar]=useState(false);const [data,setData]=useState(initial),[local,setLocal]=useState(false),[center,setCenter]=useState({x:128,y:64}),[layer,setLayer]=useState<any>('terrain'),[phase,setPhase]=useState(0),[stats,setStats]=useState<any>(null);\nuseEffect(()=>setStats(null),[data,local,center,layer,solar,grid,wireframe]);\nreturn <main style={{maxWidth:1200,margin:'auto'}}><h1>Relief r8 \u2014 recette isol\u00e9e</h1><p>{data.forest.trees.length} arbres \u00b7 {data.forest.coverage.toFixed(2)} % habitat forestier</p><button onClick={()=>{const site=data.stoneSites[0];setCenter({x:site.x,y:site.y});setLocal(true);}}>Roche</button><button onClick={()=>{const i=data.elevations.indexOf(Math.max(...data.elevations));setCenter({x:i%data.width,y:Math.floor(i/data.width)});setLocal(true);}}>Sommet</button><button onClick={()=>{let best=0,max=-1;for(let t=0;t<360;t+=5){const light=illumination(center.x/data.width*Math.PI*2,center.y/data.height*Math.PI*2+Math.PI,t/360*Math.PI*2);if(light.direct>max){max=light.direct;best=t;}}setPhase(best);setSolar(v=>!v);}}>Soleil</button><button onClick={()=>setLocal(v=>!v)}>Tore / local</button><button onClick={()=>setPhase(v=>v+45)}>Tourner</button><button onClick={()=>setLayer(v=>v==='terrain'?'altitude':'terrain')}>Couche</button><button onClick={()=>{const t=data.forest.trees[0];setCenter({x:Math.floor(t.x),y:Math.floor(t.y)});setLocal(true);}}>Bosquet</button><button onClick={()=>{setCenter({x:0,y:0});setLocal(true);}}>Couture</button><button onClick={async()=>{setData(await(await fetch('/@fs/__WORKSPACE__/test-results/relief-7.json')).json());}}>Seed 7</button><button onClick={()=>setGrid(v=>!v)}>Grille</button><button onClick={()=>setWireframe(v=>!v)}>Maillage</button><PreviewScene grid={grid} wireframe={wireframe} data={data} local={local} center={center} layer={layer} fog={false} solar={solar} exaggeration={1} cycleDegrees={phase} onPick={(x,y)=>{setCenter({x,y});setLocal(true);}} onStats={v=>setStats({...v,seed:data.seed})}/><pre>{JSON.stringify(stats)}</pre></main>}\nroot.render(<Review/>);\n".replaceAll('__WORKSPACE__',resolve('.').replaceAll('\\','/')).replaceAll('relief-42.json',prefix+'-42.json').replaceAll('relief-7.json',prefix+'-7.json').replaceAll('Relief r8','Geologie r'+recipe);
await writeFile(resolve(base,'.relief-review.tsx'),harness);
await writeFile(resolve(base,'relief-review.html'),'<html><head><meta charset="UTF-8"/></head><body><div id="root"></div><script type="module" src="/.relief-review.tsx"></script></body></html>');
try{
 await browser('open','http://localhost:5174/relief-review.html');await browser('set','viewport','1440','1000');
 const resize=()=>evaluate("document.querySelector('canvas').style.cssText='width:1100px;height:640px;display:block';window.dispatchEvent(new Event('resize'));true");
 const capture=async(name,seed=42)=>{await resize();await evaluate(`(async()=>{for(let n=0;n<80;n++){const stats=JSON.parse(document.querySelector('pre').textContent);if(stats?.seed===${seed})return true;await new Promise(r=>setTimeout(r,100));}throw Error('Stats did not refresh');})()`);records[name]=await browser('get','text','pre');await browser('screenshot','test-results/'+prefix+'-r'+recipe+'-'+name+'.png');};
 await capture('torus');
 await browser('find','role','button','click','--name','Sommet');await capture('peak');
 await browser('find','role','button','click','--name','Roche');await capture('stone');
 if(recipe===9){await browser('find','role','button','click','--name','Grille');await capture('stone-grid');await browser('find','role','button','click','--name','Grille');await browser('find','role','button','click','--name','Maillage');await capture('stone-wireframe');await browser('find','role','button','click','--name','Maillage');}
 await browser('find','role','button','click','--name','Soleil');await capture('stone-sun');
 await browser('find','role','button','click','--name','Soleil');
 await browser('find','role','button','click','--name','Bosquet');await capture('local');
 await browser('find','role','button','click','--name','Couture');await capture('seam');
 for(let i=0;i<3;i++){await browser('find','role','button','click','--name','Couche');await browser('find','role','button','click','--name','Couche');await browser('find','role','button','click','--name','Tore / local');await browser('find','role','button','click','--name','Tourner');await browser('find','role','button','click','--name','Tore / local');}
 await browser('find','role','button','click','--name','Tore / local');await capture('return');
 await browser('find','role','button','click','--name','Seed 7');await capture('seed7',7);
 records.graphics=await evaluate("(()=>{const c=document.querySelector('canvas'),gl=c.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {width:c.width,height:c.height,renderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)};})()");
 records.errors=JSON.parse(await browser('--json','errors')).data.errors;
 await writeFile('test-results/'+prefix+'-r'+recipe+'-review.json',JSON.stringify(records,null,2));
 if(records.errors.length)throw Error(JSON.stringify(records.errors));
 console.log(JSON.stringify(records));
}finally{
 await browser('close');
 await rm(resolve(base,'.relief-review.tsx'));await rm(resolve(base,'relief-review.html'));
}
