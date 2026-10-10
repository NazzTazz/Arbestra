import {useEffect,useMemo,useRef,useState} from 'react';
import type {StarterInstallation,StarterKit,SpawnMap,SpawnPoint,TerrainResponse,VillageState,SpawnPoseRequest,StarterPoseRequest} from '@arbestra/contracts';
import {App} from '../App';
import {poseStarterElement} from '@arbestra/contracts';
import {previewCells} from '../scene/construction-selection';
import type {Cell} from '../scene/construction-selection';
import {preparationState} from './preparation-state';
import './placement.css';
async function read<T>(url:string,body?:unknown):Promise<T>{const response=await fetch(url,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.message??'Le serveur est indisponible.'),{definitive:response.status<500});return value as T;}
const label=(type:string)=>type==='town-hall'?'Hôtel de ville':type==='garden'?'Jardin':'Maison en troncs';
export function SpawnPlacement(){
 const params=new URLSearchParams(location.search),slug=params.get('world')??'',base=`/api/worlds/${encodeURIComponent(slug)}`;
 const initial=useRef<SpawnPoint>({x:Math.max(0,Math.min(511,Number(params.get('x'))||0)),y:Math.max(0,Math.min(255,Number(params.get('y'))||0))});
 const [center,setCenter]=useState(initial.current),[point,setPoint]=useState(initial.current),[turns,setTurns]=useState(Number(params.get('turns'))%4||0),[manual,setManual]=useState(false);
 const [kit,setKit]=useState<StarterKit|null>(null),[installation,setInstallation]=useState<StarterInstallation|null>(null),[terrain,setTerrain]=useState<TerrainResponse|null>(null),[map,setMap]=useState<SpawnMap|null>(null),[village,setVillage]=useState<VillageState|null>(null);
 const [key,setKey]=useState(''),[playerName,setPlayerName]=useState(params.get('playerName')??''),[villageName,setVillageName]=useState(params.get('villageName')??''),[error,setError]=useState(''),[pending,setPending]=useState(false),[ready,setReady]=useState(false),[reload,setReload]=useState(0);
 const [diagnostic,setDiagnostic]=useState<{key:string;valid:boolean;referenceHeight:number}|null>(null),[workerReady,setWorkerReady]=useState(0);
 const worker=useRef<Worker|null>(null),diagnosticSequence=useRef(0),diagnosticKey=useRef('');
 const request=useRef<{url:string;body:SpawnPoseRequest|StarterPoseRequest}|null>(null),busy=useRef(false),latestPoint=useRef(point);
 useEffect(()=>{let live=true;setError('');
  void (async()=>{const [start,m]=await Promise.all([read<{kit:StarterKit;installation:StarterInstallation|null}>(base+'/starter'),read<SpawnMap>(base+'/spawn-map')]);if(!live)return;
   const c=start.installation?.anchor??initial.current;setCenter(c);setPoint(c);latestPoint.current=c;setKit(start.installation?.kit??start.kit);setInstallation(start.installation);setMap(m);if(start.installation){setManual(true);setKey(start.installation.remaining[0]??'');}
   const chunks:string[]=[];const x0=Math.floor((c.x-16)/32),y0=Math.floor((c.y-16)/32);for(let y=0;y<2;y++)for(let x=0;x<2;x++)chunks.push(((x0+x+16)%16)+','+((y0+y+8)%8));
   const [ground,state]=await Promise.all([read<TerrainResponse>(base+'/starter/terrain?chunks='+encodeURIComponent(chunks.join(';'))),start.installation?read<VillageState>(base+'/village?villageId='+start.installation.villageId):Promise.resolve(null)]);if(live){setTerrain(ground);setVillage(state);setReady(true);}
  })().catch(e=>{if(live)setError((e as Error).message);});return()=>{live=false;};
 },[base,reload]);
 const elements=kit?.elements.filter(e=>installation?e.key===key:manual?e.type==='town-hall':true)??[];
 const geometryKey=JSON.stringify([point,turns,elements,installation?.referenceHeight,village?.serverTime]);
 const valid=diagnostic?.key===geometryKey?diagnostic.valid:null;
 useEffect(()=>{if(!map)return;setWorkerReady(0);const w=new Worker(new URL('./placement-worker.ts',import.meta.url),{type:'module'});worker.current=w;
  w.onmessage=e=>{if(e.data.ready){setWorkerReady(n=>n+1);return;}if(e.data.sequence===diagnosticSequence.current)setDiagnostic({key:diagnosticKey.current,valid:e.data.valid,referenceHeight:e.data.referenceHeight});};
  w.onerror=()=>setError('Le diagnostic du terrain a été interrompu. Rechargez la préparation.');w.postMessage({kind:'init',map});return()=>{w.terminate();worker.current=null;};
 },[map]);
 useEffect(()=>{if(!workerReady)return;const sequence=++diagnosticSequence.current;diagnosticKey.current=geometryKey;
  worker.current?.postMessage({kind:'inspect',sequence,point,turns,elements,grouped:!installation,referenceHeight:installation?.referenceHeight,occupied:village?.cells.filter(c=>c.footprint||c.building)??[]});
 },[workerReady,geometryKey]);
 const chooseManual=()=>{if(busy.current||request.current)return;setManual(true);setError('');request.current=null;};
 const rotate=()=>{if(busy.current||request.current)return;setTurns(t=>(t+1)%4);};
 const hover=(p:SpawnPoint)=>{if(busy.current||request.current)return;latestPoint.current=p;setPoint(p);};
 const pose=async()=>{
  if(busy.current||!kit||!map||!ready||valid!==true&&!request.current)return;
  if(!request.current){
   if(installation){if(!key)return;request.current={url:base+'/villages/'+installation.villageId+'/starter',body:{commandId:crypto.randomUUID(),elementKey:key,point:latestPoint.current,quarterTurns:turns}};}
   else {if(!playerName.trim()||!villageName.trim()){setError('Indiquez votre nom et celui du village.');return;}request.current={url:base+'/starter',body:{commandId:crypto.randomUUID(),artifactChecksum:map.artifactChecksum,kitVersion:kit.version,point:latestPoint.current,quarterTurns:turns,mode:manual?'manual':'grouped',playerName:playerName.trim(),villageName:villageName.trim()}};}
  }
  busy.current=true;setPending(true);setError('');
  try{const result=await read<StarterInstallation>(request.current.url,request.current.body);const state=await read<VillageState>(base+'/village?villageId='+result.villageId);setVillage(state);request.current=null;setInstallation(result);setKey(result.remaining[0]!);setManual(true);setReload(n=>n+1);}
  catch(e){if((e as {definitive?:boolean}).definitive)request.current=null;setError((e as Error).message+(request.current?' — résultat incertain, réessayez la même pose.':''));}
  finally{busy.current=false;setPending(false);}
 };

 const displayState=useMemo(()=>village??(terrain&&map?preparationState(terrain,map,center,villageName):null),[village,terrain,map,center,villageName]);
 const cells=elements.flatMap(e=>poseStarterElement(e,point,turns,!installation).cells);
 const preview=previewCells(cells,c=>valid===true&&!village?.cells.some(v=>v.cellX===c.cellX&&v.cellY===c.cellY&&(v.building||v.footprint)),valid===null?'Vérification du terrain…':undefined);
 const gesture=(cell:Cell,commit:boolean)=>{const same=cell.cellX===point.x&&cell.cellY===point.y;hover({x:cell.cellX,y:cell.cellY});if(commit&&same)void pose();};
 if(!displayState||!kit)return <main className="center-message">{error||'Préparation du terrain…'}</main>;
 const choices=installation?kit.elements.filter(e=>installation.remaining.includes(e.key)).map(e=>({key:e.key,label:label(e.type),code:e.type==='dwelling'?'dwelling-logs':e.type})).concat([{key:'',label:'Autres constructions',code:'dwelling'}]):[{key:'grouped',label:'Village initial',code:'town-hall'},{key:'manual',label:'Hôtel de ville',code:'town-hall'}];
 return <App starter={{state:displayState,beforeTownHall:!installation,active:!installation||installation.remaining.length>0&&!!key,pending,uncertain:!!request.current&&!pending,error:error||null,
  ghost:{elements,point,quarterTurns:turns,relativeToHall:!installation,...(installation?{referenceHeight:installation.referenceHeight}:{})},preview,choices,selected:installation?key:manual?'manual':'grouped',
  onChoose:choice=>{if(busy.current||request.current)return;if(installation)setKey(choice);else setManual(choice==='manual');},onGesture:gesture,onManual:chooseManual,onRotate:rotate,onRetry:()=>void pose(),
  names:!installation&&<section className="starter-names" aria-label="Noms du village"><label>Votre nom<input maxLength={40} value={playerName} disabled={pending||!!request.current} onChange={e=>setPlayerName(e.target.value)}/></label><label>Nom du village<input maxLength={60} value={villageName} disabled={pending||!!request.current} onChange={e=>setVillageName(e.target.value)}/></label><a aria-disabled={pending} onClick={e=>{if(pending||request.current)e.preventDefault();}} href={'/spawn-map?world='+encodeURIComponent(slug)}>Revenir à la carte</a></section>
 }}/>;
}
