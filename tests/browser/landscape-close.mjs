/* global process, console, fetch */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const fixture=JSON.parse(await readFile('test-results/world-generator-fixture.json','utf8')),matrix=JSON.parse(await readFile('test-results/landscape-repair-browser.json','utf8'));
const candidate=matrix.cases.find(c=>c.candidate.seed===42&&c.candidate.width===256).candidate;
const exec=promisify(execFile),session='landscape-close-'+Date.now(),cli=resolve(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
async function browser(...args){try{return (await exec(cli,['--session',session,...args],{windowsHide:true,timeout:60000,maxBuffer:4000000})).stdout.trim();}catch{throw Error('Browser failed: '+args[0]);}}
const records={poses:[]};
try{
 const response=await fetch('http://127.0.0.1:3180/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:fixture.email,password:fixture.password})});
 if(!response.ok)throw Error('QA login failed');
 const cookie=response.headers.getSetCookie()[0].split(';')[0],split=cookie.indexOf('=');
 await browser('cookies','set',cookie.slice(0,split),cookie.slice(split+1),'--url','http://127.0.0.1:5284','--httpOnly');
 const data=await (await fetch('http://127.0.0.1:3180/api/admin/world-generator/'+candidate.id+'/preview',{headers:{cookie}})).json();
 await browser('open','http://127.0.0.1:5284/world-generator');await browser('set','viewport','1440','1000');
 await browser('wait','--text','Paramètres de génération');
 let snapshot=await browser('snapshot','-i'),ref=snapshot.match(/combobox "Candidat"[^\n]*ref=(e\d+)/)[1];await browser('select','@'+ref,candidate.id);
 await browser('wait','--text','Résultat mesuré');await browser('select','select[aria-label="Couche"]','altitude');
 snapshot=await browser('snapshot','-i');ref=snapshot.match(/combobox "Amplification globale"[^\n]*ref=(e\d+)/)[1];await browser('select','@'+ref,'4');await browser('wait','2200');
 await browser('screenshot','.generator-canvas','test-results/repair-altitude-x4.png');
 await browser('find','role','button','click','--name','Inspection locale');await browser('select','select[aria-label="Couche"]','terrain');
 let first=true;
 for(const direction of [0,1])for(const ascending of [true,false]){
  const stair=data.stairs.find(s=>s.direction===direction&&(data.elevations[s.to]>data.elevations[s.from])===ascending);
  if(!stair)throw Error('Missing stair pose');
  const x=stair.x+(direction===0?1:2),y=stair.y+(direction===1?1:2);
  await browser('find','label','X','fill',String(x));await browser('find','label','Y','fill',String(y));await browser('wait','1000');
  if(first){
   await browser('scrollintoview','.generator-canvas');
   const r=JSON.parse(await browser('--json','eval',"(()=>{const r=document.querySelector('.generator-canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")).data.result;
   await browser('mouse','move',String(Math.round(r.x)),String(Math.round(r.y)));
   await browser('screenshot','.generator-canvas','test-results/repair-before-wheel.png');for(let z=0;z<4;z++)await browser('find','role','button','click','--name','Zoom avant','--exact');await browser('wait','4000');first=false;
  }
  await browser('wait','2200');const capture='test-results/repair-close-'+direction+'-'+(ascending?'up':'down')+'.png';
  await browser('screenshot','.generator-canvas',capture);if(first===false&&records.poses.length===0){records.zoomChanged=!(await readFile('test-results/repair-before-wheel.png')).equals(await readFile(capture));if(!records.zoomChanged)throw Error('Zoom controls did not change the view');}records.poses.push({direction,ascending,x,y,low:stair.low,high:stair.high,capture});console.log('Close pose '+direction+' / '+ascending);
 }
 await browser('screenshot','.generator-canvas','test-results/repair-close-camera-before.png');
 await browser('select','select[aria-label="Couche"]','altitude');await browser('select','select[aria-label="Couche"]','terrain');await browser('wait','2200');
 await browser('screenshot','.generator-canvas','test-results/repair-close-camera-after.png');
 records.cameraPreserved=(await readFile('test-results/repair-close-camera-before.png')).equals(await readFile('test-results/repair-close-camera-after.png'));
 if(!records.cameraPreserved)throw Error('Local framing changed across layers');
 records.errors=JSON.parse(await browser('--json','errors')).data.errors;if(records.errors.length)throw Error('Browser errors');
 await writeFile('test-results/landscape-close-browser.json',JSON.stringify(records,null,2));console.log('Close stair poses and unchanged framing verified.');
}finally{await browser('close');}
