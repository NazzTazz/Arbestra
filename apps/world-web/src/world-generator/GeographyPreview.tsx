import { useEffect, useRef, useState } from 'react';
import { DEFAULT_GEOGRAPHY, type GeographyOptions } from '@arbestra/contracts/geography-prototype';
import { createGeographyScene, type CellFacts, type GeographyMetrics, type GeographyResult } from './geography-scene';
import './geography-preview.css';

export function GeographyPreview(){
  const canvas=useRef<HTMLCanvasElement>(null),view=useRef<ReturnType<typeof createGeographyScene>|null>(null);
  const [options,setOptions]=useState<GeographyOptions>({...DEFAULT_GEOGRAPHY});
  const [density,setDensity]=useState<1|2>(1),[seam,setSeam]=useState(false);
  const [request,setRequest]=useState({options:{...DEFAULT_GEOGRAPHY},density:1 as 1|2,seam:false,id:0});
  const [display,setDisplay]=useState({grid:false,wire:false,borders:false,flow:false,water:true});
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const [result,setResult]=useState<GeographyResult|null>(null),[metrics,setMetrics]=useState<GeographyMetrics|null>(null);
  const [facts,setFacts]=useState<CellFacts|null>(null);
  useEffect(()=>{view.current=createGeographyScene(canvas.current!,setMetrics,setFacts);return()=>{view.current?.dispose();view.current=null;};},[]);
  useEffect(()=>{view.current?.setDisplay(display);},[display]);
  useEffect(()=>{
    let active=true;const worker=new Worker(new URL('./geography.worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=(event:MessageEvent<GeographyResult&{id:number;error?:string}>)=>{
      if(!active||event.data.id!==request.id)return;
      try{
        if(event.data.error)throw new Error(event.data.error);
        view.current?.load(event.data);setResult(event.data);setFacts(null);setError('');
      }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
      setLoading(false);worker.terminate();
    };
    worker.onerror=event=>{if(active){setError(event.message||'Le worker a échoué');setLoading(false);}worker.terminate();};
    worker.postMessage(request);
    return()=>{active=false;worker.terminate();};
  },[request]);
  const generate=()=>{setLoading(true);setError('');setMetrics(null);setRequest(previous=>({options:{...options},density,seam,id:previous.id+1}));};
  return <main className="geography-preview">
    <header><div><p className="geography-eyebrow">ARBESTRA · ATELIER GÉOGRAPHIQUE</p><h1>Relief et rivières</h1></div><nav><a href="/terrain-kit">Kit de terrain</a><a href="/world-generator">World generator</a></nav></header>
    <div className="geography-layout"><aside>
      <h2>Une géographie, plusieurs lectures</h2><p>Deux chunks de 32 × 32 cases. Le relief et les berges existent indépendamment de la grille.</p>
      <label>Seed <input type="number" min="0" max="2147483647" value={options.seed} onChange={e=>setOptions({...options,seed:Number(e.target.value)})}/></label>
      <label>Amplitude du relief <output>{options.amplitude.toFixed(2)}</output><input type="range" min="0.5" max="1.5" step="0.05" value={options.amplitude} onChange={e=>setOptions({...options,amplitude:Number(e.target.value)})}/></label>
      <label>Largeur de rivière <output>{options.riverWidth.toFixed(1)} cases</output><input type="range" min="5" max="8" step="0.1" value={options.riverWidth} onChange={e=>setOptions({...options,riverWidth:Number(e.target.value)})}/></label>
      <label>Irrégularité des berges <output>{options.bankRoughness.toFixed(2)}</output><input type="range" min="0" max="1" step="0.05" value={options.bankRoughness} onChange={e=>setOptions({...options,bankRoughness:Number(e.target.value)})}/></label>
      <label>Densité du maillage <select value={density} onChange={e=>setDensity(Number(e.target.value) as 1|2)}><option value="1">Standard</option><option value="2">Fine · même géographie</option></select></label>
      <label className="geography-check"><input type="checkbox" checked={seam} onChange={e=>setSeam(e.target.checked)}/> Examiner la couture du tore</label>
      <button className="geography-generate" onClick={generate}>{loading?'Relancer la génération':'Générer le prototype'}</button>
      <fieldset><legend>Superpositions indépendantes</legend>{([{id:'grid',label:'Grille métier'},{id:'wire',label:'Triangles'},{id:'borders',label:'Frontières des chunks'},{id:'flow',label:'Sens du courant'},{id:'water',label:'Surface de l’eau'}] as const).map(item=><label className="geography-check" key={item.id}><input type="checkbox" checked={display[item.id]} onChange={e=>{const checked=e.target.checked;setDisplay(previous=>({...previous,[item.id]:checked}));}}/>{item.label}</label>)}</fieldset>
      <p className="geography-note">Fixture de réseau fluvial : rivière, affluent et lac. Aucun monde sauvegardé n’est modifié. La génération globale des bassins viendra après cette recette.</p>
    </aside><section className="geography-view">
      <div className="geography-toolbar"><div><button onClick={()=>view.current?.pose('all')}>Ensemble</button><button onClick={()=>view.current?.pose('river')}>Berges</button><button onClick={()=>view.current?.pose('rock')}>Roche</button></div><span role="status">{loading?'Génération en cours…':error?'Échec de génération':`Seed ${result?.geography.options.seed} · prêt`}</span></div>
      {error&&<p role="alert">{error}</p>}
      <canvas ref={canvas} aria-label="Prototype géographique 3D" />
      <p className="geography-help">Glisser : orbiter · Molette : zoomer · Clic sur le sol : inspecter une cellule</p>
      <div className="geography-readouts"><div><h2>Géométrie et rendu</h2>{result&&<p>Génération worker : {result.durationMs.toFixed(0)} ms · {result.chunks.reduce((n,c)=>n+c.triangles,0).toLocaleString('fr')} triangles de sol · {(result.chunks.reduce((n,c)=>n+c.bytes,0)/1048576).toFixed(2)} Mio de buffers transmis</p>}
      {metrics&&<p data-testid="geography-metrics">{metrics.backend} · {metrics.width} × {metrics.height} · {metrics.draws} appels de dessin · {metrics.meshes} meshes actifs · {metrics.vertices.toLocaleString('fr')} sommets résidents<br/>Frames médiane / p95 : {metrics.median.toFixed(1)} / {metrics.p95.toFixed(1)} ms · CPU scène dernière frame : {metrics.cpu.toFixed(1)} ms<br/><small>{metrics.renderer} · Temps GPU non mesuré</small></p>}</div>
      <div><h2>Lecture métier</h2>{facts?<p>Cellule ({facts.x}, {facts.y}) · Eau : {(facts.wetFraction*100).toFixed(1)} %<br/>Sol min / max : {facts.minElevation.toFixed(3)} / {facts.maxElevation.toFixed(3)} case<br/>Pente max échantillonnée : {(facts.maxSlope*100).toFixed(1)} %<br/><small>{facts.samples} × {facts.samples} échantillons · Faits géographiques, aucune autorisation de construire ou marcher.</small></p>:<p>Cliquer une cellule pour lire son relief et sa fraction en eau, sans consulter la géométrie du mesh.</p>}</div></div>
    </section></div>
  </main>;
}
