/* global process,console,fetch */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const fixture=JSON.parse(await readFile('test-results/world-generator-fixture.json','utf8')),exec=promisify(execFile),session='hydro-orbit-'+Date.now(),cli=resolve(process.env.APPDATA,'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
const browser=async(...args)=>{try{return (await exec(cli,['--session',session,...args],{windowsHide:true,timeout:60000,maxBuffer:5000000})).stdout.trim();}catch{throw Error('Browser command failed: '+args[0]);}};
try{
 const login=await fetch('http://127.0.0.1:3180/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:fixture.email,password:fixture.password})});if(!login.ok)throw Error('QA login');
 const cookie=login.headers.getSetCookie()[0].split(';')[0],split=cookie.indexOf('=');
 const list=await (await fetch('http://127.0.0.1:3180/api/admin/world-generator',{headers:{cookie}})).json(),candidate=list.candidates.find(c=>c.name==='Hydrology 42 / 512');
 const data=await (await fetch('http://127.0.0.1:3180/api/admin/world-generator/'+candidate.id+'/preview',{headers:{cookie}})).json();
 const fall=data.hydrology.waterfalls.filter(f=>f.drop===2).sort((a,b)=>b.width-a.width)[0];
 await browser('cookies','set',cookie.slice(0,split),cookie.slice(split+1),'--url','http://127.0.0.1:5284','--httpOnly');
 await browser('open','http://127.0.0.1:5284/world-generator');await browser('set','viewport','1440','1000');await browser('wait','--text','Paramètres de génération');
 const main=list.candidates.find(c=>c.name==='Hydrology UI 42 / 256');
 const mainData=await (await fetch('http://127.0.0.1:3180/api/admin/world-generator/'+main.id+'/preview',{headers:{cookie}})).json();
 const initial=await browser('snapshot','-i'),initialRef=initial.match(/combobox "Candidat"[^\n]*ref=(e\d+)/)[1];
 await browser('select','@'+initialRef,main.id);await browser('wait','--text','R\u00e9sultat mesur\u00e9');
 await browser('find','role','button','click','--name','Voir une rivi\u00e8re');await browser('wait','2200');
 await browser('screenshot','.generator-canvas','test-results/hydro-meander-river-complete.png');
 const spring=mainData.hydrology.reaches.find(r=>r.kind==='lake'&&r.surface>0&&r.downstream!==null);
 await browser('find','label','X','fill',String(spring.anchor%mainData.width));await browser('find','label','Y','fill',String(Math.floor(spring.anchor/mainData.width)));
 await browser('find','role','button','click','--name','Zoom avant','--exact');await browser('wait','2200');
 await browser('screenshot','.generator-canvas','test-results/hydro-meander-spring.png');
 await browser('find','role','button','click','--name','Zoom arri\u00e8re','--exact');
 const snapshot=await browser('snapshot','-i'),ref=snapshot.match(/combobox "Candidat"[^\n]*ref=(e\d+)/)[1];await browser('select','@'+ref,candidate.id);await browser('wait','--text','Résultat mesuré');
 await browser('find','role','button','click','--name','Inspection locale');
 await browser('find','label','X','fill',String(fall.lanes[Math.floor(fall.width/2)].cell%data.width));await browser('find','label','Y','fill',String(Math.floor(fall.lanes[Math.floor(fall.width/2)].cell/data.width)));
 for(let z=0;z<2;z++)await browser('find','role','button','click','--name','Zoom avant','--exact');
 await browser('scrollintoview','.generator-canvas');
 const r=JSON.parse(await browser('--json','eval',"(()=>{const r=document.querySelector('.generator-canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")).data.result;
 const wrap=(v,size)=>((v+size*1.5)%size)-size/2;
 const dx=wrap(fall.nextCell%data.width-fall.cell%data.width,data.width),dy=wrap(Math.floor(fall.nextCell/data.width)-Math.floor(fall.cell/data.width),data.height);
 const drag=wrap(-Math.PI/2-Math.atan2(dy,dx)-.35,Math.PI*2)*100;
 await browser('mouse','move',String(Math.round(r.x)),String(Math.round(r.y)));await browser('mouse','down');await browser('mouse','move',String(Math.round(r.x+drag)),String(Math.round(r.y-15)));await browser('mouse','up');await browser('wait','2500');
 await browser('screenshot','.generator-canvas','test-results/hydro-meander-fall-2-orbit-terrain.png');
 const errors=JSON.parse(await browser('--json','errors')).data.errors;await writeFile('test-results/hydrology-meander-orbit.json',JSON.stringify({fall,errors,stats:await browser('get','text','.generator-stats')},null,2));if(errors.length)throw Error('Browser errors');console.log('Complete curved river, rounded spring and oblique waterfall inspected.');
}finally{await browser('close');}
