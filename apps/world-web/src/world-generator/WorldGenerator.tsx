import {candidateIdentity,forestHabitatLabel,renderIdentity} from './preview-inspection';
import { DEFAULT_GEOGRAPHY_PARAMETERS } from '@arbestra/contracts/world-geography';
import { useEffect, useRef, useState } from 'react';
import { oceanCenter, waterLevel, type GeneratedLandscape, type GeneratorParameters, type WorldCandidate } from '@arbestra/contracts';
import { randomUUID } from '../random-uuid';
import { PreviewScene, type PreviewLayer, type PreviewStats, type PreviewRenderState } from './PreviewScene';
import './world-generator.css';
import { ALTITUDE_LEGEND } from './altitude-color';
const BASE='/api/admin/world-generator';
async function request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
  const response=await fetch(path,{method,credentials:'include',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),...(signal?{signal}:{})});
  if(!response.ok){const error=await response.json().catch(()=>({message:'Erreur réseau.'}));throw new Error(error.message??'Requête refusée.');}
  return response.json() as Promise<T>;
}
export function GeneratorEntry(){
  const [allowed,setAllowed]=useState(false);
  useEffect(()=>{const abort=new AbortController();request(BASE,'GET',undefined,abort.signal).then(()=>setAllowed(true)).catch(()=>{});return()=>abort.abort();},[]);
  return allowed?<a className="generator-entry" href="/world-generator">World generator</a>:null;
}
const labels:Record<keyof GeneratorParameters,string>={
  waterPercent:'Eau (% de l’aire au sol)',amplitude:'Hauteur et profondeur (± unités)',meanElevation:'Altitude moyenne',
  channelWidth:'Largeur des canaux',treePercent:'Couverture boisée (%)',solarInfluence:'Influence solaire (%)',
};
const warnings:Record<string,string>={
  'Ocean loop fails the requested width/depth inspection.':'Boucle maritime non qualifiée pour cette largeur et profondeur.',
  'Fewer than two connected dry plateau sites: colonisation layout not qualified.':'Moins de deux plateaux secs reliés : implantation à pied non qualifiée.',
  'Geographic preview only: traversal, spawn, tides and waterfalls are not certified for this recipe.':'Aperçu géographique : accès et spawn non qualifiés. Marées et cascades restent à réintégrer. Le monde reste fermé.',
  'No feasible maritime channel at requested width.':'Aucun chenal compatible avec cette largeur et les accès terrestres.',
  'No descending river fits the relief and dry access constraints.':'Aucune rivière descendante compatible avec le relief et les accès secs.',
  'Local spawn is not implemented: v3 remains closed.':'Le spawn local v3 reste à implémenter : ce candidat demeure fermé.',
  'Water area target outside 1 percentage point tolerance.':'La cible d’eau dépasse la tolérance de 1 point.',
  'Mean altitude target outside 0.25 unit tolerance.':'L’altitude moyenne dépasse la tolérance de 0,25 unité.',
  'Relief amplitude constrained by plateaus, sea and accessibility.':'L’amplitude est contrainte par les plateaux, l’eau et les passages.',
  'Tree coverage limited by preserved natural passages.':'La couverture boisée est limitée par les passages préservés.',
  'Isolated walkable zones: candidate cannot open.':'Des zones accessibles sont isolées.',
  'Hydrology and local spawn are not implemented: v3 remains closed.':'Hydrologie et spawn v3 attendent les prochaines tranches : ce candidat reste fermé.',
  'Legacy v2: current terrain recipe; climate and natural stairs are not applied.':'Recette v2 actuelle ; les nouveaux réglages de relief et climat ne s’appliquent pas.',
};
export function WorldGenerator(){
  const [candidates,setCandidates]=useState<WorldCandidate[]>([]),[selected,setSelected]=useState<string|null>(null);
  const [loaded,setLoaded]=useState<{key:string;data:GeneratedLandscape}|null>(null),[error,setError]=useState(''),[authorized,setAuthorized]=useState(false);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false);
  const [name,setName]=useState('Monde exploratoire'),[seed,setSeed]=useState(1),[version,setVersion]=useState<2|3>(3);
  const [width,setWidth]=useState(256),[height,setHeight]=useState(128),[parameters,setParameters]=useState({...DEFAULT_GEOGRAPHY_PARAMETERS});
  const [fallIndex,setFallIndex]=useState(0),[riverIndex,setRiverIndex]=useState(0);
  const [flat,setFlat]=useState(false);
  const [local,setLocal]=useState(false),[center,setCenter]=useState({x:128,y:64});
  const [layer,setLayer]=useState<PreviewLayer>('terrain'),[fog,setFog]=useState(false),[solar,setSolar]=useState(false),[exaggeration,setExaggeration]=useState(1);
  const [cycleDegrees,setCycleDegrees]=useState(0);
  const selectedCandidate=candidates.find(c=>c.id===selected);
  const selectedKey=selectedCandidate?candidateIdentity(selectedCandidate):'';
  const data=selectedCandidate?.status==='ready'&&loaded?.key===selectedKey?loaded.data:null;
  // At small torus sizes, large visual multipliers can invert the submerged tube.
  const maxAmplification=!flat&&!local&&data?.geography?.relief?.halfRange
    ? .9/(data.geography.relief.halfRange*Math.PI*2/data.height):Infinity;
  const effectiveAmplification=exaggeration<=maxAmplification?exaggeration:1;
  const [stats,setStats]=useState<PreviewStats|null>(null),[limits,setLimits]=useState({maxCells:131072});
  const [renderState,setRenderState]=useState<PreviewRenderState|null>(null);
  const [stoneIndex,setStoneIndex]=useState(0);
  const [lakeIndex,setLakeIndex]=useState(0),[wireframe,setWireframe]=useState(false),[grid,setGrid]=useState(false);
  const inspectRiver=()=>{
    if(data?.geography){
      const rivers=data.geography.rivers.filter(r=>r.points.length>12);
      const river=rivers[riverIndex%(rivers.length||1)];if(!river)return;
      const p=river.points[Math.floor(river.points.length/2)]!;
      setCenter({x:((p[0]%data.width)+data.width)%data.width,y:((p[1]%data.height)+data.height)%data.height});
      setLocal(true);setLayer('terrain');setRiverIndex(riverIndex+1);return;
    }
    const hydro=data?.hydrology;if(!hydro)return;
    const sources=hydro.reaches.filter(r=>r.kind==='lake'&&r.surface>0&&r.downstream!==null);
    const source=sources[riverIndex%sources.length];if(!source)return;
    const chain:typeof hydro.reaches=[];let id=source.downstream;
    while(id!==null&&chain.length<hydro.reaches.length){const r=hydro.reaches[id]!;if(r.kind!=='river')break;chain.push(r);id=r.downstream;}
    const reach=chain[Math.floor(chain.length/2)];if(!reach)return;
    const cell=reach.cells[Math.floor(reach.cells.length/2)]!,w=data!.width,h=data!.height;
    const wrap=(v:number,size:number)=>((v+size*1.5)%size)-size/2;
    const cells=[...source.cells,...chain.flatMap(r=>r.cells)],anchor=source.anchor;
    const xs=cells.map(i=>wrap(i%w-anchor%w,w)),ys=cells.map(i=>wrap(Math.floor(i/w)-Math.floor(anchor/w),h));
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const fits=maxX-minX<=29&&maxY-minY<=29;
    setCenter(fits?{x:((anchor%w+Math.ceil((minX+maxX)/2))%w+w)%w,y:((Math.floor(anchor/w)+Math.ceil((minY+maxY)/2))%h+h)%h}
      :{x:cell%w,y:Math.floor(cell/w)});setLocal(true);setLayer('terrain');setRiverIndex(riverIndex+1);
  };
  const command=useRef<string|null>(null);
  const refresh=async(signal?:AbortSignal)=>{
    const result=await request<{candidates:WorldCandidate[];limits:typeof limits}>(BASE,'GET',undefined,signal);
    setCandidates(result.candidates);setLimits(result.limits);setAuthorized(true);
  };
  useEffect(()=>{
    const abort=new AbortController();let stopped=false;
    const poll=async()=>{try{await refresh(abort.signal);}catch(e){if(!stopped)setError((e as Error).message);}if(!stopped)timer=setTimeout(poll,2000);};
    let timer:ReturnType<typeof setTimeout>;void poll();
    return()=>{stopped=true;abort.abort();clearTimeout(timer);};
  },[]);
  useEffect(()=>{
    setLoaded(null);setStats(null);setFallIndex(0);setRiverIndex(0);setLakeIndex(0);setStoneIndex(0);
    if(!selected||selectedCandidate?.status!=='ready')return;
    const abort=new AbortController();
    request<GeneratedLandscape>(BASE+'/'+selected+'/preview','GET',undefined,abort.signal).then(result=>{
      if(abort.signal.aborted)return;
      setLoaded({key:selectedKey,data:result});setCenter({x:Math.floor(result.width/2),y:Math.floor(result.height/2)});
    }).catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return()=>abort.abort();
  },[selected,selectedKey,selectedCandidate?.status]);
  const action=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const login=()=>action(async()=>{await request('/api/auth/login','POST',{email,password});setPassword('');});
  const generate=()=>action(async()=>{
    command.current??=randomUUID();
    const result=await request<WorldCandidate>(BASE,'POST',{commandId:command.current,name,seed,width,height,version,parameters});
    setSelected(result.id);command.current=null;
  });
  const candidateAction=(kind:'retain'|'open')=>action(()=>request(BASE+'/'+selected+'/'+kind,'POST',{checksum:selectedCandidate!.checksum,revision:selectedCandidate!.revision}));
  const view=local?'local':flat?'map':'torus';
  const renderKey=renderIdentity({candidate:selectedKey,view,layer,x:center.x,y:center.y,fog:fog&&view==='torus',solar:solar&&view!=='map',exaggeration:local?1:effectiveAmplification,grid,wireframe});
  const reuseParameters=()=>{if(!selectedCandidate)return;const c=selectedCandidate;setName(c.name);setSeed(c.seed);setWidth(c.width);setHeight(c.height);setVersion(c.version);setParameters({...c.parameters});command.current=null;};
  const chooseStair=()=>{const s=data?.stairs[0];if(s){setCenter({x:s.x,y:s.y});setLocal(true);}};
  return <main className="generator-screen">
    <header><div><h1>World generator</h1><p>Prévisualiser, conserver, puis ouvrir un univers.</p></div><a href="/geography-preview">Prototype géographique</a><a href="/terrain-kit">Kit de terrain</a><a href="/">Retour au village</a></header>
    {error&&!authorized&&<p role="alert" className="generator-error">{error}</p>}
    {!authorized?<form className="generator-login" onSubmit={e=>{e.preventDefault();void login();}}>
      <p>Connexion avec un compte opérateur.</p>
      <label>Adresse email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username" required/></label>
      <label>Mot de passe<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/></label>
      <button disabled={busy}>Se connecter</button>
    </form>:<div className="generator-layout"><aside>
      <h2>Paramètres de génération</h2><p className="generator-note">Formulaire du prochain candidat ; indépendant du monde affiché.</p>
      <label>Nom<input value={name} maxLength={80} onChange={e=>{setName(e.target.value);command.current=null;}}/></label>
      <label>Seed<input type="number" min={0} max={2147483647} value={seed} onChange={e=>{setSeed(Number(e.target.value));command.current=null;}}/></label>
      <label>Recette<select value={version} onChange={e=>{setVersion(Number(e.target.value) as 2|3);command.current=null;}}>
        <option value={3}>v3 r11 — deux océans et terres reliées</option><option value={2}>v2 — recette actuelle</option></select></label>
      <div className="generator-dimensions">{[['Largeur',width,setWidth],['Hauteur',height,setHeight]].map(([label,value,set])=>
        <label key={String(label)}>{String(label)}<select value={Number(value)} onChange={e=>{(set as typeof setWidth)(Number(e.target.value));command.current=null;}}>
          {[64,128,256,512].map(n=><option key={n}>{n}</option>)}</select></label>)}</div>
      <p>{width*height} cases / {limits.maxCells} maximum.</p>
      {(Object.keys(labels) as Array<keyof GeneratorParameters>).map(key=><label key={key}>
        {labels[key]} : <strong>{parameters[key]}</strong>
        <input aria-label={labels[key]} type="range" disabled={version===2} min={key==='amplitude'?8:key==='meanElevation'?-8:key==='channelWidth'?1:0}
          max={key==='amplitude'?16:key==='meanElevation'?8:key==='channelWidth'?32:100} step={key==='meanElevation'?.25:1} value={parameters[key]}
          onChange={e=>{setParameters(p=>({...p,[key]:Number(e.target.value)}));command.current=null;}}/>

      </label>)}
      <p className="generator-note">1 unité de hauteur = ¼ de case. Relief ±{parameters.amplitude} = −{parameters.amplitude/4} à +{parameters.amplitude/4} cases autour du niveau marin 0. La moyenne ajuste les formes sans réduire ces bornes. Géographie r11 : deux bassins océaniques reliés, continuité terrestre inspectable. Flèches de courant dans « Eau et réseaux », pilotées par le cycle solaire. Pas encore de marées, cascades ni terraformation. La largeur des canaux élargit les détroits et fixe le gabarit du contrôle maritime ; un avertissement signale un passage insuffisant.</p>
      <p className="generator-note" role="status">{candidates.length} aperçus sauvegardés.</p>
      <button disabled={busy||width*height>limits.maxCells||!name.trim()} onClick={()=>void generate()}>Générer l’aperçu</button>
      {error&&<p role="alert" className="generator-error">{error}</p>}
      <h2>Candidats sauvegardés</h2>
      <label>Candidat<select aria-label="Candidat" value={selected??''} onChange={e=>setSelected(e.target.value||null)}>
        <option value="">Choisir un candidat</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.name} · seed {c.seed} · {c.width}×{c.height} · r{c.recipeRevision} · {c.status}{c.retained?' · conservé':''}{c.opened?' · ouvert':''}</option>)}
      </select></label>
      {selectedCandidate&&<div className="generator-candidate">
        <p>Recette : {selectedCandidate.recipeRevision ? `r${selectedCandidate.recipeRevision}` : 'historique non versionnée'}</p>
        <h3>Paramètres du candidat</h3>
        <p>Seed {selectedCandidate.seed} · {selectedCandidate.width} × {selectedCandidate.height}</p>
        <dl>{(Object.keys(labels) as Array<keyof GeneratorParameters>).map(k=><div key={k}><dt>{labels[k]}</dt><dd>{selectedCandidate.parameters[k]}</dd></div>)}</dl>
        <button onClick={reuseParameters}>Reprendre ces paramètres</button>
        <small>La création utilisera la recette courante ; un ancien candidat reste inchangé.</small>
        <p>État : {selectedCandidate.status} · tentative {selectedCandidate.attempt}</p>
        <small>{selectedCandidate.id}</small><code>{selectedCandidate.checksum??'Calcul en attente du processus de génération…'}</code>
        {selectedCandidate.error&&<p role="alert">{selectedCandidate.error}</p>}
        <button disabled={busy||selectedCandidate.status!=='ready'} onClick={()=>void candidateAction('retain')}>Conserver ce monde</button>
        <button disabled={busy||selectedCandidate.status!=='ready'||!selectedCandidate.retained||selectedCandidate.version!==2||selectedCandidate.opened}
          onClick={()=>void candidateAction('open')}>Ouvrir l’univers</button>
        {selectedCandidate.version===3&&<small>Ouverture v3 disponible après le spawn local et sa recette.</small>}
        {selectedCandidate.status==='failed'&&<button disabled={busy} onClick={()=>void action(()=>request(BASE+'/'+selected+'/retry','POST'))}>Réessayer le calcul</button>}
        <button disabled={busy||selectedCandidate.opened||selectedCandidate.status==='running'} onClick={()=>void action(async()=>{
          await request(BASE+'/'+selected,'DELETE');setSelected(null);
        })}>Supprimer ce candidat fermé</button>
      </div>}
    </aside><section className="generator-preview">
      {data?.geography?.connections&&<p className="generator-note" data-ocean-inspection>
        Boucle maritime : {data.geography.connections.marineLoop?'continue':'non qualifiée'} · gabarit {data.geography.connections.corridorWidth} cases ·
        {data.geography.connections.plateaus.length} plateaux secs reliés · {data.geography.connections.mainLandCells} cases dans la terre principale.
        Terres contrôlées à marée haute (+0,25 unité), profondeur marine à marée basse. Sans autorisation de déplacement. Les îles et terrains hors réseau restent exclus des sites proposés.
      </p>}
      <div className="generator-toolbar">
        <button onClick={()=>{setLocal(false);setFlat(false);}} aria-pressed={!local&&!flat}>Tore</button>
        <button onClick={()=>{setLocal(false);setFlat(true);}} aria-pressed={!local&&flat}>Carte complète</button>
        <button onClick={()=>setLocal(true)} aria-pressed={local}>Inspection locale</button>
                <button disabled={!data?.stoneSites?.length} onClick={()=>{const sites=data!.stoneSites!,site=sites[stoneIndex%sites.length]!;setCenter({x:site.x,y:site.y});setLocal(true);setLayer('terrain');setStoneIndex(stoneIndex+1);}}>Voir un site de pierre</button>
        {data?.geography?.oceans&&<>
          <button onClick={()=>{const o=data.geography!.oceans!,u=o.phase;setCenter({x:u*data.width,y:oceanCenter(o,u)*data.height});setLocal(true);setLayer('water');}}>Océan intérieur</button>
          <button onClick={()=>{const o=data.geography!.oceans!,u=(o.phase+.5)%1;setCenter({x:u*data.width,y:oceanCenter(o,u)*data.height});setLocal(true);setLayer('water');}}>Océan extérieur</button>
          <button onClick={()=>{const o=data.geography!.oceans!,u=(o.phase+(riverIndex%2?.75:.25))%1;setCenter({x:u*data.width,y:oceanCenter(o,u)*data.height});setRiverIndex(riverIndex+1);setLocal(true);setLayer('water');}}>Voir un détroit</button>
          <button disabled={!data.geography.connections?.plateaus.length} onClick={()=>{const ps=data.geography!.connections!.plateaus,p=ps[stoneIndex%ps.length]!;setCenter(p);setStoneIndex(stoneIndex+1);setLocal(true);setLayer('accessibility');}}>Plateau relié</button>
        </>}
        <button onClick={chooseStair} disabled={!data?.stairs.length}>Voir un escalier</button>
                <button onClick={inspectRiver} disabled={!data?.hydrology?.metrics.sources&&!data?.geography?.rivers.length}>Voir une rivière</button>
                <button onClick={()=>{const falls=data?.hydrology?.waterfalls;const f=falls?.[fallIndex%(falls.length||1)];if(f){const cell=f.lanes?.[Math.floor(f.width/2)]?.cell??f.cell;setCenter({x:cell%data!.width,y:Math.floor(cell/data!.width)});setLocal(true);setLayer('water');setFallIndex(fallIndex+1);}}} disabled={!data?.hydrology?.waterfalls.length}>Voir une cascade</button>
                {data?.geography&&<><button disabled={!data.geography.lakes.length} onClick={()=>{const lakes=data.geography!.lakes,lake=lakes[lakeIndex%lakes.length]!;setCenter({x:lake.x,y:lake.y});setLocal(true);setLayer('terrain');setLakeIndex(lakeIndex+1);}}>Voir un lac</button>
        <label><input type="checkbox" checked={wireframe} onChange={e=>setWireframe(e.target.checked)}/>Maillage</label><label><input type="checkbox" checked={grid} disabled={!local&&!flat} onChange={e=>setGrid(e.target.checked)}/>Grille et chunks</label></>}
        <label>Couche<select aria-label="Couche" value={layer} onChange={e=>setLayer(e.target.value as PreviewLayer)}>
          <option value="terrain">Terrain et arbres</option><option value="altitude">Altitude −16 / +16</option>
          <option value="water">Eau et réseaux</option><option value="exposure">Exposition solaire moyenne</option><option value="humidity">Humidité climatique</option>
          <option value="accessibility" disabled={!!data?.geography&&!data.geography.connections}>Continuité terrestre</option></select></label>
        <label><input aria-label="Éclairage solaire" type="checkbox" checked={solar} disabled={view==='map'} onChange={e=>setSolar(e.target.checked)}/>Éclairage solaire</label>
        <label><input aria-label="Atmosphère" type="checkbox" checked={fog} disabled={view!=='torus'} onChange={e=>setFog(e.target.checked)}/>Atmosphère</label>
        <label>Amplification globale<select aria-label="Amplification globale" value={effectiveAmplification} onChange={e=>setExaggeration(Number(e.target.value))} disabled={local}>
          {[1,2,4].map(n=><option value={n} key={n} disabled={n>maxAmplification}>{n}×</option>)}</select></label>
        <label>Phase du cycle : {cycleDegrees}°<input type="range" min={0} max={360} value={cycleDegrees} onChange={e=>setCycleDegrees(Number(e.target.value))}/></label>
        <label>Phase exacte<input aria-label="Phase exacte" type="number" min={0} max={360} value={cycleDegrees} onChange={e=>setCycleDegrees(Math.max(0,Math.min(360,Number(e.target.value))))}/></label>
        <label>X<input type="number" value={center.x} onChange={e=>setCenter(c=>({...c,x:Number(e.target.value)}))}/></label>
        <label>Y<input type="number" value={center.y} onChange={e=>setCenter(c=>({...c,y:Number(e.target.value)}))}/></label>
      </div>
      {layer==='altitude'&&<div className="generator-altitude-legend" aria-label="Altitude du terrain">{ALTITUDE_LEGEND.map(({height,color})=><span key={height}><i style={{background:color}}/>{height>0?'+':''}{height}</span>)}<small>Unité = ¼ case · fond visible sans surface d’eau</small></div>}
      {data&&<p className="generator-displayed-candidate">Candidat chargé : {selectedCandidate?.name} · seed {data.seed} · {data.width} × {data.height} · r{data.recipeRevision}<br/><small>{selectedCandidate?.id} · {selectedCandidate?.checksum}</small></p>}
      {view==='map'&&<p className="generator-note">Carte rectangulaire complète · vue orthographique · éclairage neutre. Les bords opposés se rejoignent dans le monde. Les aires mesurées restent celles du tore, pas de ce rectangle. Grille : limites des chunks. Cliquer sur la carte ouvre l'inspection locale.</p>}
      {data?<PreviewScene candidateKey={selectedKey} flat={flat} grid={grid} wireframe={wireframe} data={data} local={local} center={center} layer={layer} fog={fog&&view==='torus'} solar={solar&&view!=='map'} exaggeration={local?1:effectiveAmplification} cycleDegrees={cycleDegrees}
        onPick={(x,y)=>{setCenter({x,y});if(view==='map')setLocal(true);}} onStats={setStats} onRenderState={setRenderState}/>:<div className="generator-empty">{selectedCandidate?.status==='ready'?'Chargement du candidat sélectionné…':'Choisis un candidat prêt pour l’inspecter.'}</div>}
      <p className="generator-note">Glisser : tourner · molette : zoom · clic : coordonnées. Inspection locale : échelle physique 1×. Altitude : bleu bas, rouge haut ; exposition : tons chauds ; humidité : bleu-vert ; {data?.geography?.connections?'continuité : vert = terre principale, bleu = eau/frange humide, brun = hors réseau proposé.':'accès : gris = obstacle/eau, couleur = composante.'}</p>
      {data&&<div className="generator-metrics"><h2>Résultat mesuré</h2><p className="generator-note">Mesures enregistrées du candidat, pondérées par l’aire du tore. Habitat forestier et nombre d’arbres sont distincts ; la couverture de canopée n’est pas mesurée.</p><dl>
        <dt>Eau demandée / obtenue (aire du tore)</dt><dd>{selectedCandidate?.parameters.waterPercent}% / {data.metrics.waterPercent.toFixed(2)}%</dd>
        <dt>Terres mesurées (aire du tore)</dt><dd>{Math.max(0,100-data.metrics.waterPercent).toFixed(4)}%</dd>
        <dt>Altitude moyenne demandée / obtenue</dt><dd>{selectedCandidate?.parameters.meanElevation} / {data.metrics.meanElevation.toFixed(2)}</dd>
                <dt>{data.geography?.relief ? 'Bornes demandées / extrema mesurés' : 'Amplitude demandée / obtenue'}</dt><dd>{data.geography?.relief ? `−${selectedCandidate?.parameters.amplitude} / +${selectedCandidate?.parameters.amplitude}` : selectedCandidate?.parameters.amplitude} · min {data.metrics.minElevation.toFixed(2)}, max {data.metrics.maxElevation.toFixed(2)} · écart total {data.metrics.amplitude.toFixed(2)}</dd>
        {data.stoneSites&&<><dt>Sites de pierre (aperçu)</dt><dd>{data.stoneSites.length} {data.geography?.geology?'formations':'amas'} · stocks exploitables à raccorder</dd></>}
        {data.forest&&<><dt>Arbres décoratifs</dt><dd>{data.forest.trees.length.toLocaleString()} · positions continues, tailles variées</dd></>}<dt>{data.forest ? "Habitat boisé demandé / obtenu" : "Bois demandé / obtenu"}</dt><dd>{selectedCandidate?.parameters.treePercent}% / {forestHabitatLabel(data)}</dd>
                {data.geography?<><dt>Tronçons fluviaux / lacs</dt><dd>{data.geography.rivers.length} / {data.geography.lakes.length}</dd><dt>Accès et spawn</dt><dd>Non qualifiés ; candidat fermé</dd></>:<><dt>Terres / composantes accessibles / zones isolées</dt><dd>{data.metrics.landComponents} / {data.metrics.accessibleComponents} / {data.metrics.isolatedZones}</dd></>}
                {data.hydrology&&<>
          <dt>Surface d’eau au point inspecté</dt><dd>{waterLevel(data,((Math.floor(center.y)%data.height+data.height)%data.height)*data.width+(Math.floor(center.x)%data.width+data.width)%data.width,cycleDegrees/360*Math.PI*2)?.toFixed(3)??'—'} unité</dd>
          <dt>Eau à marée basse / haute</dt><dd>{data.hydrology.metrics.waterLowPercent.toFixed(2)}% / {data.hydrology.metrics.waterHighPercent.toFixed(2)}%</dd>
          <dt>Bassins marins / lacs / sources</dt><dd>{data.hydrology.metrics.marineBasins} / {data.hydrology.metrics.lakeBasins} / {data.hydrology.metrics.sources}</dd>
          <dt>Chenaux / largeur demandée</dt><dd>{data.hydrology.channels.length} / {selectedCandidate?.parameters.channelWidth} cases</dd>
          <dt>Cascades de 1 / 2 unités</dt><dd>{data.hydrology.metrics.falls1} / {data.hydrology.metrics.falls2}</dd>
          <dt>Tracés écartés : chenaux / rivières</dt><dd>{data.hydrology.metrics.rejectedChannels} / {data.hydrology.metrics.rejectedRivers}</dd>
          <dt>Marée / marge sèche</dt><dd>±{data.hydrology.tideAmplitude} / {data.hydrology.dryMargin} unité</dd>
        </>}
        {data.metrics.quality&&<>
        <dt>Plateaux / plus grand plateau</dt><dd>{data.metrics.quality.plateauCount} / {data.metrics.quality.largestPlateauCells} cases</dd>
        <dt>Détours testés : médiane / maximum</dt><dd>{data.metrics.quality.medianDetourCells} / {data.metrics.quality.maxDetourCells} cases ({data.metrics.quality.detourSamples} ruptures testées ; {data.metrics.quality.unreachableDetours} sans trajet)</dd>
        <dt>Passages sans alternative</dt><dd>{data.metrics.quality.stairsWithoutAlternative} / {data.metrics.quality.stairSamples} passages testés</dd>
        </>}
        <dt>Terres sans accès praticable</dt><dd>{data.metrics.landsWithoutAccess??'—'}</dd>
        <dt>Escaliers</dt><dd>{data.metrics.stairCount}</dd><dt>Temps de génération</dt><dd>{selectedCandidate?.durationMs??'—'} ms</dd>
      </dl>{data.metrics.warnings.map(s=><p key={s}>{warnings[s]??s}</p>)}</div>}
      {stats&&stats.renderKey===renderKey&&renderState?.key===renderKey&&renderState.status==='ready'&&<output className="generator-stats">{stats.backend} · {stats.fps.toFixed(0)} FPS · rendu JS médiane/p95 {stats.median.toFixed(2)}/{stats.p95.toFixed(2)} ms · {stats.draws} draws · {stats.meshes} meshes actifs · {stats.indices} indices actifs (passes incluses) · {stats.residentVertices} sommets résidents · {stats.materials} matériaux · {stats.textures} textures · {stats.fogPasses} passes atmosphère. Temps GPU non mesuré.</output>}
    </section></div>}
  </main>;
}
