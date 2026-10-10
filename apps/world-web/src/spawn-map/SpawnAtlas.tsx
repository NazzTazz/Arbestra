import { useEffect, useRef, useState } from 'react';
import { unwrapTerritory, type AtlasPresentation, type SpawnMap as MapData, type SpawnPoint, type SpawnTerrainResult, type SpawnResourcePreflight } from '@arbestra/contracts';
import { AtlasMap } from './AtlasMap';
import { Luminosity } from './Luminosity';
import { createInspectionQueue } from './inspection-queue';
import './atlas.css';

const labels={water:'Eau sous une emprise',rock:'Roche sous une emprise',relief:'Relief au-delà de ±2 niveaux',neighbor:'Un hôtel de ville est à 50 cases ou moins',occupation:'Occupation ou passage à préserver',territory:'Territoire d’un village existant'};
interface PresentationSettings { presentation: AtlasPresentation; canEdit: boolean; ownVillageId: string | null }
async function response<T>(r:Response):Promise<T>{const body=await r.json();if(!r.ok)throw Error(body.message??'La carte est momentanément indisponible.');return body as T;}
export function SpawnMap(){
  const slug=new URLSearchParams(location.search).get('world')??'', base=`/api/worlds/${encodeURIComponent(slug)}/spawn-map`;
  const atlasUrl=`/api/worlds/${encodeURIComponent(slug)}/spawn-atlas`;
  const [map,setMap]=useState<Omit<MapData,'landscape'>|null>(null),[settings,setSettings]=useState<PresentationSettings|null>(null);
  const [error,setError]=useState(''),[reload,setReload]=useState(0);
  const [hover,setHover]=useState<SpawnPoint|null>(null),[selected,setSelected]=useState<SpawnPoint|null>(null),[turns,setTurns]=useState(0);
  const [disk,setDisk]=useState<SpawnTerrainResult|null>(null),[inspection,setInspection]=useState<SpawnTerrainResult|null>(null);
  const [resources,setResources]=useState<SpawnResourcePreflight|null>(null),[checking,setChecking]=useState(false);
  const [villageId,setVillageId]=useState<string|null>(null);
  const [villagePosition,setVillagePosition]=useState({x:30,y:150});
  const villageLeave=useRef<ReturnType<typeof setTimeout>|null>(null);
  const hideVillage=()=>{if(villageLeave.current)clearTimeout(villageLeave.current);villageLeave.current=setTimeout(()=>setVillageId(null),250);};
  const showVillage=(id:string|null,screen?:{x:number;y:number})=>{if(villageLeave.current)clearTimeout(villageLeave.current);if(!id){hideVillage();return;}setVillageId(id);if(screen)setVillagePosition(screen);};
  const [editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[draftTitle,setDraftTitle]=useState(''),[draftSlogan,setDraftSlogan]=useState('');
  const [drawing,setDrawing]=useState(false),[vertices,setVertices]=useState<SpawnPoint[]>([]);
  const request=useRef<AbortController|null>(null),sequence=useRef(0),queue=useRef<ReturnType<typeof createInspectionQueue>|null>(null);
  const diskSequence=useRef(0),selectionSequence=useRef(0),worker=useRef<Worker|null>(null);
  const cursor=hover??selected;
  const currentDisk=disk&&disk.point.x===cursor?.x&&disk.point.y===cursor.y&&disk.quarterTurns===turns?disk:null;
  const currentInspection=inspection&&inspection.point.x===selected?.x&&inspection.point.y===selected.y&&inspection.quarterTurns===turns?inspection:null;
  const ownVillage=map?.villages.find(v=>v.id===settings?.ownVillageId);
  useEffect(()=>{
    const abort=new AbortController();setError('');setMap(null);
    if(!slug){setError('Le lien doit indiquer le monde à explorer.');return;}
    Promise.all([fetch(atlasUrl,{signal:abort.signal}).then(response<Omit<MapData,'landscape'>>),fetch(base+'/presentation',{signal:abort.signal}).then(response<PresentationSettings>)])
      .then(([m,s])=>{if(!abort.signal.aborted){setMap(m);setSettings(s);}}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return()=>abort.abort();
  },[atlasUrl,base,slug,reload]);
  useEffect(()=>()=>request.current?.abort(),[]);
  useEffect(()=>()=>{if(villageLeave.current)clearTimeout(villageLeave.current);},[]);
  useEffect(()=>{
    if(!map)return;
    setDisk(null);setInspection(null);
    const instance=new Worker(new URL('./terrain-worker.ts',import.meta.url),{type:'module'});worker.current=instance;
    const current=createInspectionQueue(task=>instance.postMessage(task));queue.current=current;
    instance.onmessage=(e:MessageEvent<{channel:'ready'}|{channel:'disk'|'selection';sequence:number;result:SpawnTerrainResult;milliseconds:number}>)=>{
      const m=e.data;if(m.channel==='ready'){current.ready();return;}
      const task=current.complete(m.channel,m.sequence);if(!task)return;
      if(m.channel==='disk'&&m.sequence===diskSequence.current)setDisk(m.result);
      if(m.channel==='selection'&&m.sequence===selectionSequence.current)setInspection(m.result);
      document.querySelector('.spawn-workspace')?.setAttribute(`data-${m.channel}-compute-ms`,m.milliseconds.toFixed(1));
    };
    instance.onerror=()=>{setError('Diagnostic interrompu. Rechargez la carte pour réessayer.');setDisk(null);setInspection(null);};
    const abort=new AbortController();
    fetch(base,{signal:abort.signal}).then(response<MapData>).then(full=>{if(!abort.signal.aborted)instance.postMessage({kind:'init',map:full});}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return()=>{abort.abort();instance.terminate();queue.current=null;worker.current=null;};
  },[map,base]);
  const cx=cursor?.x,cy=cursor?.y;
  useEffect(()=>{
    const id=++diskSequence.current;queue.current?.cancel('disk');
    if(cx===undefined||cy===undefined||!map||drawing)return;
    const timer=setTimeout(()=>queue.current?.request({kind:'inspect',channel:'disk',sequence:id,point:{x:cx,y:cy},turns,requestedAt:performance.now()}),90);
    return()=>clearTimeout(timer);
  },[cx,cy,turns,map,drawing]);
  useEffect(()=>{
    const id=++selectionSequence.current;queue.current?.cancel('selection');
    if(selected&&map)queue.current?.request({kind:'inspect',channel:'selection',sequence:id,point:selected,turns,requestedAt:performance.now()});
  },[selected,turns,map]);
  const invalidate=()=>{request.current?.abort();sequence.current++;setResources(null);setChecking(false);setError('');};
  const select=(p:SpawnPoint)=>{if(drawing){if(vertices.length<32)setVertices(v=>[...v,p]);return;}invalidate();setSelected(p);};
  const rotate=()=>{invalidate();setTurns(v=>(v+1)%4);};
  const close=()=>{invalidate();setSelected(null);document.querySelector<SVGSVGElement>('.atlas-canvas')?.focus();};
  const check=async()=>{
    if(!map||!selected)return;invalidate();const abort=new AbortController();request.current=abort;const id=++sequence.current;setChecking(true);
    try{const result=await fetch(base+'/resource-check',{method:'POST',signal:abort.signal,headers:{'content-type':'application/json'},body:JSON.stringify({point:selected,quarterTurns:turns,artifactChecksum:map.artifactChecksum})}).then(response<SpawnResourcePreflight>);
      if(id===sequence.current)setResources(result);
    }catch(e){if(!abort.signal.aborted&&id===sequence.current)setError((e as Error).message);}finally{if(id===sequence.current)setChecking(false);}
  };
  const savePresentation=async()=>{setSaving(true);setError('');try{const p=await fetch(base+'/presentation',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({title:draftTitle,slogan:draftSlogan})}).then(response<AtlasPresentation>);setSettings(s=>s&&({...s,presentation:p}));setEditing(false);}catch(e){setError((e as Error).message);}finally{setSaving(false);}};
  const saveTerritory=async(clear=false)=>{if(!ownVillage)return;setSaving(true);setError('');try{
    await fetch(base+'/territory',{method:clear?'DELETE':'PUT',...(!clear?{headers:{'content-type':'application/json'},body:JSON.stringify({points:vertices})}:{})}).then(response<{ok:boolean}>);
    setDrawing(false);setVertices([]);const fresh=await fetch(atlasUrl).then(response<Omit<MapData,'landscape'>>);setMap(fresh);
  }catch(e){setError((e as Error).message);}finally{setSaving(false);}};
  const activeVillage=map?.villages.find(v=>v.id===villageId);
  return <main className="spawn-map">
    <header className="atlas-heading"><span className="atlas-eyebrow">Atlas du monde</span><h1>{settings?.presentation.title??'Arbestra'}</h1><p>{settings?.presentation.slogan??'Choisissez où commencer votre cité'}</p>
      {settings?.canEdit&&<button className="atlas-edit" onClick={()=>{setDraftTitle(settings.presentation.title);setDraftSlogan(settings.presentation.slogan);setEditing(true);}}>Modifier les textes</button>}
    </header>
    {editing&&<form className="atlas-editor" onSubmit={e=>{e.preventDefault();void savePresentation();}}><label>Titre<input value={draftTitle} onChange={e=>setDraftTitle(e.target.value)} maxLength={80} required/></label><label>Slogan<input value={draftSlogan} onChange={e=>setDraftSlogan(e.target.value)} maxLength={180}/></label><button disabled={saving}>Enregistrer</button><button type="button" onClick={()=>setEditing(false)}>Annuler</button></form>}
    {error&&<div className="atlas-error"><p role="alert">{error}</p><button onClick={()=>{if(map&&selected)void check();else setReload(v=>v+1);}}>Réessayer</button></div>}
    {!map&&!error&&<p className="atlas-loading" role="status">Déplions la carte…</p>}
    {map&&<>
      <div className="spawn-workspace" data-disk-state={cursor?currentDisk?'ready':'pending':'idle'} data-terrain-compatible={currentDisk?.terrainCompatible??false}>
        <AtlasMap cursor={drawing?null:cursor} selected={selected} result={currentDisk} villages={map.villages} surfaces={map.surfaces} turns={turns} territories={map.territories??[]}
          draft={ownVillage?unwrapTerritory(vertices,ownVillage,512,256):[]} onHover={p=>setHover(old=>old?.x===p?.x&&old?.y===p?.y?old:p)} onPick={select} onVillage={showVillage}
          onKey={key=>{if(key==='Escape'){if(drawing){setDrawing(false);setVertices([]);}else if(villageId)setVillageId(null);else close();return;}if(key.toLowerCase()==='r'){rotate();return;}const p=cursor??{x:256,y:128};if(key==='Enter'){select(p);return;}setHover({x:(p.x+(key==='ArrowLeft'?-1:key==='ArrowRight'?1:0)+512)%512,y:(p.y+(key==='ArrowUp'?1:key==='ArrowDown'?-1:0)+256)%256});}}/>
        {selected&&!drawing&&<aside className="spawn-panel" aria-label="Zone sélectionnée"><button className="spawn-close" aria-label="Fermer le panneau" onClick={close}>×</button><span className="atlas-eyebrow">Votre future cité</span><h2>Explorer ce lieu</h2><p className="atlas-coordinates">{selected.x} E · {selected.y} N</p>
          <Luminosity point={selected} width={512} height={256}/>
          <dl>{['Humidité','Température','Vent','Précipitations'].map(n=><div key={n}><dt>{n}</dt><dd>En attente d’instrumentation</dd></div>)}</dl>
          <div className="atlas-installation"><h3>Préparer le terrain</h3><p>Seules les emprises du kit seront aplanies, jusqu’à ±2 niveaux. Les arbres sous les emprises seront retirés sans gain de bois. Eau et rochers seront conservés.</p><button onClick={rotate}>Tourner le kit · {turns*90}° <kbd>R</kbd></button>
          <p role="status">{!currentInspection?'Lecture du terrain…':currentInspection.terrainCompatible?'Le terrain accueille les emprises du kit.':currentInspection.reasons.map(r=>labels[r]).join(' · ')}</p></div>
          <button disabled={!currentInspection?.terrainCompatible||checking} onClick={()=>void check()}>{checking?'Vérification de la dotation…':'Vérifier cet emplacement'}</button>
          {resources&&<p role="status">{!resources.terrain.terrainCompatible?resources.terrain.reasons.map(r=>labels[r]).join(' · '):resources.planningStatus==='planned'?'Terrain et dotation vérifiés.':'La dotation ne peut pas encore être confirmée ici.'}</p>}
          {resources?.poorInResources&&<p>Zone pauvre en ressources</p>}
          {resources?.cleaning&&<p>Nettoyage prévu : {resources.cleaning.treesToRemove} arbre{resources.cleaning.treesToRemove===1?'':'s'} sous les emprises. Aucun bois crédité.</p>}
          <button className="atlas-primary" disabled={!currentInspection?.terrainCompatible} onClick={()=>{if(selected){const q=new URLSearchParams(location.search);q.set('x',String(selected.x));q.set('y',String(selected.y));q.set('turns',String(turns));location.assign('/spawn?'+q);}}}>Choisir cet emplacement</button>
        </aside>}
      </div>
      <div className="atlas-caption"><p>Déplacez le cercle pour explorer · cliquez pour inspecter · <span>rayon de 8 cases</span></p><p className="atlas-legend"><span>♧ Forêts</span><span>⌂ Villages</span><span className="atlas-territory-key">Territoires</span></p></div>
      <p className="atlas-status" aria-live="polite">{currentDisk&&!currentDisk.terrainCompatible?currentDisk.reasons.map(r=>labels[r]).join(' · '):currentDisk?'Emprises compatibles · confirmation serveur requise':'Glissez pour parcourir la carte · molette ou boutons pour zoomer'}</p>
      {activeVillage&&<p className="spawn-village-hover" style={{left:Math.max(8,Math.min(villagePosition.x+12,innerWidth-250)),top:Math.min(villagePosition.y+12,innerHeight-50)}} onPointerEnter={()=>showVillage(activeVillage.id)} onPointerLeave={hideVillage}>{activeVillage.playerName} · {activeVillage.population} habitants</p>}
      {ownVillage&&<section className="atlas-territory-editor" aria-label="Territoire du village">{!drawing?<button onClick={()=>{close();setDrawing(true);setVertices([]);}}>Tracer mon territoire</button>:<><p>Cliquez pour tracer les sommets. Incluez votre HDV et restez à 30 cases maximum. Aucun chevauchement. {vertices.length}/32 sommets.</p><button disabled={vertices.length<3||saving} onClick={()=>void saveTerritory()}>Enregistrer le territoire</button><button onClick={()=>setVertices(v=>v.slice(0,-1))}>Retirer le dernier point</button><button onClick={()=>{setDrawing(false);setVertices([]);}}>Annuler</button></>}{map.territories?.some(t=>t.villageId===ownVillage.id)&&<button disabled={saving} onClick={()=>void saveTerritory(true)}>Effacer mon territoire</button>}</section>}
      <nav className="spawn-villages" aria-label="Villages">{map.villages.map(v=><button key={v.id} onFocus={()=>setVillageId(v.id)} onBlur={()=>setVillageId(null)} onKeyDown={e=>{if(e.key==='Escape')setVillageId(null);}}>{v.playerName} · {v.population} habitants</button>)}</nav>
    </>}
  </main>;
}
