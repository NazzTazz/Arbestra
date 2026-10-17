import {useEffect,useMemo,useRef,useState} from 'react';
import {applyVillageFrame,villageSnapshotIsValid,type ObservationLease,type ObservationSource,type ObservationStatus,type VillageState} from '@arbestra/contracts';
import {VillageScene,type TerrainHandle} from './scene/VillageScene';
import type {SceneTransport} from './scene/scene-transport';
import type {InitialLoadProgress} from './scene/initial-village-load';
import {WorldLoading} from './ui/WorldLoading';
import {Hud} from './ui/Hud';
import {ObservationError,observationRequest,observationTransport,startObservation} from './api/observation-client';
import {setStatisticsEnabled,statisticsEnabled} from './dev/statistics';
import './observation-view.css';

const outcomes={unknown:'Résultat non établi',pending:'Préparation en attente',accepted:'Ordre accepté',partial:'Partiellement accepté',rejected:'Ordre refusé'};
const nothing=()=>{};
const empty:never[]=[];
export default function ObservationEntry(){
 const [lease,setLease]=useState<ObservationLease|null>(null),[state,setState]=useState<VillageState|null>(null),[status,setStatus]=useState<ObservationStatus|null>(null),[transport,setTransport]=useState<SceneTransport|null>(null);
 const [error,setError]=useState<string|null>(null),[delayed,setDelayed]=useState(false),[stopped,setStopped]=useState(false),[source,setSource]=useState<string|null>(null),[following,setFollowing]=useState(true),[journal,setJournal]=useState(false),[selected,setSelected]=useState<string|null>(null),[progress,setProgress]=useState<InitialLoadProgress|null>(null),[stats,setStats]=useState(statisticsEnabled);
 const terrain=useRef<TerrainHandle|null>(null),stateRef=useRef<VillageState|null>(null),eventsRef=useRef<EventSource|null>(null),leaseRef=useRef<ObservationLease|null>(null),autoSource=useRef(true),endRef=useRef(nothing);
 const serverOffsetMs=useMemo(()=>state?Date.parse(state.serverTime)-Date.now():0,[state?.serverTime]);
 useEffect(()=>{
  let closed=false,events:EventSource|undefined,heartbeat:ReturnType<typeof setInterval>|undefined,retry:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController();
  const end=()=>{closed=true;controller.abort();events?.close();if(heartbeat)clearInterval(heartbeat);if(retry)clearTimeout(retry);setStopped(true);setState(null);stateRef.current=null;};endRef.current=end;
  const failure=(e:unknown)=>{if(closed)return;setError(e instanceof Error?e.message:'Observation indisponible.');if(e instanceof ObservationError&&[401,403,404,409].includes(e.status))end();};
  const parse=(event:Event):unknown=>{try{return JSON.parse((event as MessageEvent).data);}catch{return null;}};
  const connect=(l:ObservationLease):void=>{
   if(closed)return;const socket=new EventSource('/api/observation/'+l.id+'/events');events=socket;eventsRef.current=socket;const current=()=>!closed&&events===socket;
   const resync=()=>{if(!current())return;socket.close();events=undefined;stateRef.current=null;setError('Reprise de la synchronisation…');retry=setTimeout(()=>connect(l),200);};
   socket.addEventListener('snapshot',e=>{if(!current())return;const next=parse(e);if(villageSnapshotIsValid(next)&&next.world.id===l.worldId&&next.village.id===l.villageId){stateRef.current=next;setState(next);setError(null);}else resync();});
   socket.addEventListener('frame',e=>{if(!current())return;if(!stateRef.current){resync();return;}const result=applyVillageFrame(stateRef.current,parse(e));if(result.kind==='applied'){stateRef.current=result.state;setState(result.state);setError(null);}else if(result.kind==='resync')resync();});
   socket.addEventListener('status',e=>{if(!current())return;const next=parse(e) as ObservationStatus|null;if(next?.lease?.id!==l.id){resync();return;}setStatus(next);setDelayed(next.degraded);});
   socket.addEventListener('cameras',e=>{if(!current())return;const sources=parse(e) as ObservationSource[];if(Array.isArray(sources))setStatus(previous=>previous?{...previous,sources}:previous);});
   socket.addEventListener('degraded',()=>{if(current())setDelayed(true);});
   socket.addEventListener('expired',()=>{if(current()){setError('Autorisation d’observation expirée. Rouvrez depuis le NOC.');end();}});
   socket.onerror=()=>{if(current())void observationRequest('/api/observation/'+l.id,{signal:controller.signal}).catch(failure);};
  };
  void startObservation().then(l=>{
   if(closed)return;leaseRef.current=l;setLease(l);setTransport(observationTransport(l.id,controller.signal));connect(l);
   heartbeat=setInterval(()=>{if(!closed&&!document.hidden)void observationRequest('/api/observation/'+l.id+'/heartbeat',{method:'POST',signal:controller.signal}).catch(failure);},15000);
  }).catch(failure);
  return()=>{closed=true;controller.abort();events?.close();if(heartbeat)clearInterval(heartbeat);if(retry)clearTimeout(retry);};
 },[]);
 useEffect(()=>{
  if(!autoSource.current||!lease)return;const candidates=status?.sources.filter(s=>s.fresh&&s.visible)??[];
  if(candidates.length===1){autoSource.current=false;const id=candidates[0]!.id;setSource(id);void observationRequest('/api/observation/'+lease.id+'/follow',{method:'POST',body:JSON.stringify({sourceId:id})}).catch(()=>{});}
 },[status?.sources,lease]);
 function chooseSource(id:string|null){autoSource.current=false;setSource(id);setFollowing(Boolean(id));if(lease)void observationRequest('/api/observation/'+lease.id+'/follow',{method:'POST',body:JSON.stringify({sourceId:id})}).catch(e=>setError(e instanceof Error?e.message:'Source indisponible.'));}
 function free(){if(following){setFollowing(false);autoSource.current=false;if(lease)void observationRequest('/api/observation/'+lease.id+'/follow',{method:'POST',body:JSON.stringify({sourceId:null})}).catch(()=>{});}}
 function toggleFollowing(){if(following)free();else if(source)chooseSource(source);else{setFollowing(true);autoSource.current=true;}}
 async function stop(){try{if(leaseRef.current)await observationRequest('/api/observation/'+leaseRef.current.id,{method:'DELETE'});setError(null);}catch(e){setError(e instanceof Error?e.message:'Arrêt indisponible.');}finally{endRef.current();}}
 const active=status?.sources.find(s=>s.id===source),pose=following&&active?.fresh&&active.visible?active.pose:null;
 const site=state?.cells.find(c=>c.id===selected),buildingId=site?.building?.id??site?.footprint?.buildingId,building=state?.cells.find(c=>c.building?.id===buildingId)?.building;
 if(stopped)return <WorldLoading error={error??'Observation arrêtée. Vous pouvez fermer cet onglet.'}/>;
 const readError=error??(delayed?state?'Observation retardée — dernier état conservé.':'Lecture initiale retardée — nouvelle tentative automatique.':null);
 if(!state||!lease||!transport)return <WorldLoading worldName={lease?.villageName} message="Autorisation et lecture du village" error={readError} onRetry={()=>location.reload()}/>;
 const ready=progress?.phase==='ready';
 return <><main className="game-shell observation-game" data-observation-id={lease.id} data-initial-loading={!ready} inert={!ready} aria-hidden={!ready}>
  <VillageScene transport={transport} observationPose={pose} worldMode="exploration" state={state} serverOffsetMs={serverOffsetMs} terrainRef={terrain} pendingHarvestCells={empty} highlightedSiteIds={empty} selectingArea={false} preview={null} previewInvalid={false} paletteOpen={false} onAreaGesture={nothing} onGardenHarvest={nothing} onSiteSelected={setSelected} onCameraMoved={nothing} onManualCamera={free} onInitialLoad={setProgress}/>
  <Hud readOnly state={state} displayedWood={state.village.wood} notifications={[]} onPopulation={nothing} onJournal={()=>setJournal(v=>!v)} devOpen={stats} devActive={stats} onDev={()=>{const next=!stats;setStatisticsEnabled(next);setStats(next);}}/>
  <section className="observation-controls" aria-label="Observation du village"><strong>Observation — lecture seule</strong><span>{lease.villageName}</span><button onClick={toggleFollowing}>{following?'Caméra libre':'Suivre le joueur'}</button><select aria-label="Onglet joueur suivi" value={source??''} onChange={e=>chooseSource(e.target.value||null)}><option value="">{status?.sources.length?'Choisir un onglet':'Caméra indisponible'}</option>{status?.sources.map(s=><option key={s.id} value={s.id} disabled={!s.fresh}>{s.id.slice(0,8)} · {s.visible?s.fresh?s.pose?.mode:'Ancienne':'Arrière-plan'}</option>)}</select><span>{pose?.mode==='inhabitant'?'Vue habitant non suivie':pose?.mode==='transition'?'Transition joueur':pose?'Suivi actif':following?'Suivi en attente':'Caméra libre'}</span><button onClick={()=>setJournal(v=>!v)} aria-expanded={journal}>Journal</button><button onClick={()=>void stop()}>Arrêter</button><small>État : {new Date(state.serverTime).toLocaleString('fr-FR')} · Caméra : {active?new Date(active.lastSourceSeenAt).toLocaleTimeString('fr-FR'):'inconnue'}</small>{readError&&<p role="alert">{readError}</p>}</section>
  {building&&<aside className="observation-inspection"><button onClick={()=>setSelected(null)} aria-label="Fermer l’inspection">×</button><strong>{building.type}</strong><p>Niveau {building.level} · {building.status}</p><small>Lecture seule</small></aside>}
  {journal&&<aside className="observation-journal"><button onClick={()=>setJournal(false)} aria-label="Fermer le journal">×</button><h2>Actions reçues par le serveur</h2><p>Collecte depuis {status?new Date(status.coverageStartedAt).toLocaleTimeString('fr-FR'):'…'}. Les menus et gestes locaux ne sont pas capturés.</p>{status?.truncated&&<p>Historique tronqué.</p>}{status?.degraded&&<p>État retardé.</p>}{!status?.actions.length&&<p>Aucune action conservée.</p>}{status?.actions.slice().reverse().map(a=><article key={a.id}><time>{new Date(a.at).toLocaleTimeString('fr-FR')}</time><strong>{a.kind}</strong><p>{outcomes[a.businessOutcome]} {a.code}</p><small>HTTP {a.httpOutcome==='finished'?a.statusCode:a.httpOutcome==='interrupted'?'interrompu':'en cours'}</small>{a.activityStatus&&<p>Activité : {a.activityStatus}</p>}{a.target&&<p>Cible : {a.target.cellX}, {a.target.cellY}</p>}{a.accepted?.map(k=><p key={k}>{k} : accepté</p>)}{a.refused?.map(r=><p key={r.key}>{r.key} : {r.reason}</p>)}<small>Visibilité dans la scène non établie</small><code>{(a.commandId??a.requestId).slice(0,8)}</code></article>)}</aside>}
 </main>{!ready&&<WorldLoading worldName={state.world.name} progress={progress??undefined} error={readError} onRetry={()=>location.reload()}/>}</>;
}
