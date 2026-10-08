import { randomUUID } from '../random-uuid';
import {useEffect,useLayoutEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {prepareInfrastructureEdit,emptyInfrastructure,infrastructureSurface,wrappedDistance,type InfrastructureOperation,type InfrastructureQuote,type InfrastructureRequest,type VillageState,type SubPoint,type RoadMaterial,subCellKey} from '@arbestra/contracts';
import {ApiError,commandInfrastructure,previewInfrastructure,getVillage,type TimedVillageState} from '../api/client';
import type {TerrainHandle} from '../scene/VillageScene';
import type {InfrastructureGesture} from '../scene/infrastructure-renderer';
import {InfrastructureThumbnail} from './InfrastructureThumbnail';
type Item={id:string;version:number;position:SubPoint;quarterTurns:number};
const materials:Array<[RoadMaterial,string]>=[['none','Pas de route'],['earth','Terre'],['stone-1','Pierre 1'],['stone-2','Pierre 2']];
export function InfrastructureTools({state,scene,active,onSnapshot,onWorkshop}:{state:VillageState;scene:RefObject<TerrainHandle|null>;active:boolean;onSnapshot:(s:TimedVillageState)=>void;onWorkshop:()=>void}){
  const [family,setFamily]=useState('Voirie'),[material,setMaterial]=useState<RoadMaterial>('earth'),[width,setWidth]=useState(4),[border,setBorder]=useState(false),[remove,setRemove]=useState(false),[invert,setInvert]=useState(false),[turn,setTurn]=useState(0);
  const [anchor,setAnchor]=useState<SubPoint|null>(null),[point,setPoint]=useState<SubPoint|null>(null),[item,setItem]=useState<Item|null>(null),[armed,setArmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[serverValid,setServerValid]=useState(true),[uncertain,setUncertain]=useState<InfrastructureRequest|null>(null);
  const session=useRef<string>(randomUUID()),stack=useRef<Array<{id:string;anchor:SubPoint}>>([]),down=useRef<SubPoint|null>(null),latest=useRef({state,family,material,width,border,remove,invert,turn,anchor,point,item,armed,busy});
  const generation=useRef(0),presented=useRef<{operation:string;revision:number;quote:InfrastructureQuote}|null>(null);
  const previewInFlight=useRef(false);
  latest.current={state,family,material,width,border,remove,invert,turn,anchor,point,item,armed,busy};
  const pendingKey=`arbestra:infrastructure:${state.world.id}:${state.village.id}`;
  useEffect(()=>{try{const value=JSON.parse(sessionStorage.getItem(pendingKey)??'null') as InfrastructureRequest|null;if(value?.commandId){setUncertain(value);session.current=value.sessionId;}}catch{/* corrupt local history cannot authorize an action */}},[pendingKey]);
  function operation(p:SubPoint|null,first=latest.current.anchor):InfrastructureOperation|null{
    const c=latest.current;if(!p)return null;
    if(c.family==='Éclairage')return c.item?{kind:'move',id:c.item.id,version:c.item.version,position:p,quarterTurns:c.turn}:c.armed?{kind:'place',position:p,quarterTurns:c.turn}:null;
    if(!first||first.x===p.x&&first.y===p.y)return null;
    const points=first.x===p.x||first.y===p.y?[first,p]:[first,c.invert?{x:first.x,y:p.y}:{x:p.x,y:first.y},p];
    return {kind:'road',stroke:{id:'preview',points,width:c.width,material:c.material,border:c.border,operation:c.remove?'remove':c.family==='Bordures'?'border':'paint'}};
  }
  const op=operation(point),plan=state.infrastructure??emptyInfrastructure();
  const opKey=JSON.stringify(op);
  const stableOp=useMemo(()=>JSON.parse(opKey) as InfrastructureOperation|null,[opKey]);
  const prepared=useMemo(()=>{
    try{return stableOp?prepareInfrastructureEdit(state,stableOp,'preview'):null;}catch{return null;}
  },[state,stableOp]);
  const quote=prepared?.quote??null;
  const insufficient=Boolean(quote&&(quote.stoneDebit>(state.village.resources.find(r=>r.code==='stone')?.amount??0)||quote.woodDebit>state.village.wood));
  const length=op?.kind==='road'?op.stroke.points.slice(1).reduce((n,p,i)=>n+(Math.abs(wrappedDistance(p.x,op.stroke.points[i]!.x,state.world.widthCells*8))+Math.abs(wrappedDistance(p.y,op.stroke.points[i]!.y,state.world.heightCells*8)))/8,0):0;
  const area=useMemo(()=>stableOp?.kind==='road'?infrastructureSurface([{...stableOp.stroke,operation:'paint'}],state.world).size/256:0,[stableOp,state.world]);
  const clearPending=()=>{try{sessionStorage.removeItem(pendingKey);}catch{/* a storage failure cannot turn a successful server response into uncertainty */}};
  useLayoutEffect(()=>{presented.current=active&&op&&quote?{operation:opKey,revision:plan.revision,quote}:null;});
  useEffect(()=>{scene.current?.infrastructurePreview(active?op:null,!serverValid||insufficient,prepared?.next);},[active,opKey,serverValid,insufficient,scene,prepared]);
  useEffect(()=>{
    if(!active||!op||busy)return;let cancelled=false;setServerValid(true);
    const request:InfrastructureRequest={commandId:randomUUID(),sessionId:session.current,revision:plan.revision,operation:op};
    let timer:ReturnType<typeof setTimeout>;
    const run=()=>{
      if(cancelled)return;
      // A stale preview still holds the server's village lock until it returns.
      // Coalesce pointer changes instead of queuing more economic snapshots.
      if(previewInFlight.current){timer=setTimeout(run,120);return;}
      previewInFlight.current=true;
      void previewInfrastructure(state.world.slug,state.village.id,request).then(result=>{if(!cancelled){setServerValid(result.valid);setError(result.message);}}).catch(reason=>{if(!cancelled){setServerValid(false);setError(reason instanceof Error?reason.message:'Devis indisponible.');}}).finally(()=>{previewInFlight.current=false;});
    };
    timer=setTimeout(run,300);
    return ()=>{cancelled=true;clearTimeout(timer);};
  // Structural key freezes exactly the geometry being quoted, not render identity.
  },[active,opKey,plan.revision,insufficient,scene,busy]);
  async function send(next:InfrastructureOperation,requestOverride?:InfrastructureRequest){
    if(latest.current.busy)return;const c=latest.current,current=c.state.infrastructure??emptyInfrastructure();let expected:InfrastructureQuote|undefined;
    if(!requestOverride&&['road','place','move'].includes(next.kind)){
      const shown=presented.current;
      if(!shown||shown.operation!==JSON.stringify(next)||shown.revision!==current.revision){setPoint(next.kind==='road'?next.stroke.points.at(-1)!:next.kind==='place'||next.kind==='move'?next.position:null);setError('Vérifiez l’aperçu actualisé avant de valider.');return;}
      expected=shown.quote;
    }else if(next.kind!=='undo')try{expected=prepareInfrastructureEdit(c.state,next,'preview').quote;}catch(reason){setError((reason as Error).message);return;}
    const request=requestOverride??{commandId:randomUUID(),sessionId:session.current,revision:current.revision,operation:next,...(expected?{expected}:{})};
    const sentGeneration=generation.current;
    setBusy(true);latest.current.busy=true;setError(null);try{sessionStorage.setItem(pendingKey,JSON.stringify(request));}catch{/* memory retains the identity */}
    try{const result=await commandInfrastructure(c.state.world.slug,c.state.village.id,request);onSnapshot(result);clearPending();setUncertain(null);
      if(sentGeneration===generation.current){
        if(next.kind==='road'){if(result.state.infrastructure!.revision>current.revision)stack.current.push({id:request.commandId,anchor:next.stroke.points[0]!});setAnchor(next.stroke.points.at(-1)!);}
        if(next.kind==='undo'){const previous=stack.current.pop();setAnchor(previous?.anchor??null);}
        if(next.kind==='move'||next.kind==='delete'){setItem(null);setArmed(false);setPoint(null);}
      }
      setServerValid(true);
    }catch(reason){setError(reason instanceof Error?reason.message:'Commande impossible.');
      if(!(reason instanceof ApiError)||reason.status>=500)setUncertain(request);
      else{clearPending();setUncertain(null);const fresh=await getVillage(c.state.world.slug,c.state.village.id).catch(()=>null);if(fresh)onSnapshot(fresh);}
    }finally{setBusy(false);latest.current.busy=false;}
  }
  const handler=useRef<(e:InfrastructureGesture)=>void>(()=>{});
  handler.current=e=>{
    if(e.kind==='cancel'){generation.current++;stack.current=[];session.current=randomUUID();down.current=null;setAnchor(null);setItem(null);setPoint(null);setArmed(false);scene.current?.infrastructurePreview(null);return;}
    if(latest.current.busy||uncertain)return;const c=latest.current;
    if(e.kind==='hover'){setPoint(previous=>previous?.x===e.point?.x&&previous?.y===e.point?.y?previous:e.point);return;}
    if(e.kind==='down'){down.current=e.point;if(!c.anchor&&c.family!=='Éclairage'){setAnchor(e.point);setPoint(e.point);}return;}
    if(e.kind==='right'){
      if(c.family==='Éclairage'){if(c.item)void send({kind:'delete',id:c.item.id,version:c.item.version,position:c.item.position});else{setArmed(false);setPoint(null);}}
      else{const last=stack.current.at(-1);if(last)void send({kind:'undo',target:last.id});else setAnchor(null);}return;
    }
    if(e.kind==='up'&&e.point){
      if(c.family==='Éclairage'){
        if(!c.item){const picked=scene.current?.equipmentAt(e.point,e.equipmentId);if(picked){setItem(picked);setTurn(picked.quarterTurns);setArmed(false);setPoint(picked.position);return;}}
        const action=operation(e.point);if(action)void send(action);return;
      }
      const first=c.anchor??down.current;if(!c.anchor&&!e.drag){setAnchor(e.point);setPoint(e.point);return;}
      const action=operation(e.point,first);if(action)void send(action);
    }
  };
  useEffect(()=>{
    if(!active){handler.current({kind:'cancel',point:null});scene.current?.infrastructureTool(null);return;}
    let frame=0,stopped=false;
    const register=()=>{if(stopped)return;if(scene.current?.ready())scene.current.infrastructureTool(e=>handler.current(e));else frame=requestAnimationFrame(register);};register();
    const context=(e:MouseEvent)=>{if(active&&e.target instanceof Element&&e.target.closest('.village-canvas'))e.preventDefault();};
    const key=(e:KeyboardEvent)=>{if(!active||e.target instanceof Element&&e.target.closest('input,select,textarea'))return;
      if(e.key==='Escape'){e.stopImmediatePropagation();e.preventDefault();scene.current?.cancelGesture();handler.current({kind:'cancel',point:null});}
      if(e.key.toLowerCase()==='r'&&!e.repeat&&latest.current.family==='Éclairage'&&(latest.current.item||latest.current.armed)){e.preventDefault();setTurn(t=>(t+1)%4);}
    };window.addEventListener('contextmenu',context);window.addEventListener('keydown',key,true);
    return ()=>{stopped=true;cancelAnimationFrame(frame);scene.current?.infrastructureTool(null);window.removeEventListener('contextmenu',context);window.removeEventListener('keydown',key,true);};
  },[active,scene,state.world.id,state.village.id]);
  function chooseFamily(value:string){handler.current({kind:'cancel',point:null});setFamily(value);setRemove(false);setError(null);setTurn(0);}
  return <>
    <nav className="construction-categories" aria-label="Familles d’infrastructures">{['Voirie','Bordures','Éclairage'].map(f=><button key={f} aria-pressed={family===f} onClick={()=>chooseFamily(f)}>{f==='Bordures'?'Trottoirs':f}</button>)}</nav>
    <section className="construction-showroom" aria-label={`Infrastructure · ${family}`}>
      {family==='Voirie'?materials.map(([code,name])=><button className="showroom-model" key={code} aria-pressed={material===code&&!remove} onClick={()=>{setMaterial(code);setRemove(false);}}><strong>{name}</strong><InfrastructureThumbnail code={code}/><span className="resource-costs">{code.startsWith('stone')?'◆ 4 / case²':'Gratuit'}</span></button>):family==='Bordures'?<button className="showroom-model" onClick={()=>setBorder(b=>!b)} aria-pressed={border}><strong>{border?'Pierre':'Sans trottoir'}</strong><InfrastructureThumbnail code="border"/><span className="resource-costs">◆ 1 / case / côté</span></button>:<button className="showroom-model" aria-pressed={armed} onClick={()=>{setItem(null);setArmed(true);setTurn(0);}}><strong>Brasero</strong><InfrastructureThumbnail code="brazier"/><span className="resource-costs">◆ 2 · ▰ 1</span></button>}
      {import.meta.env.DEV&&state.factoryEnabled&&<button className="showroom-model workshop-launcher" onClick={onWorkshop}><strong>Créer un bâtiment</strong><InfrastructureThumbnail code="workshop"/><span className="resource-costs">Atelier Infrastructure</span></button>}
    </section>
    <aside className="construction-feedback infrastructure-feedback" aria-label="Paramètres Infrastructure">
      {family!=='Éclairage'?<><label>Largeur utile <input type="range" min="2" max="8" value={width} onChange={e=>setWidth(Number(e.target.value))}/>{width} / 8 case</label><label><input type="checkbox" checked={border} onChange={e=>setBorder(e.target.checked)}/> Trottoirs en pierre (¼ de case par côté)</label>
        {family==='Voirie'&&<><button onClick={()=>setInvert(v=>!v)}>Inverser le coude</button><button aria-pressed={remove} onClick={()=>setRemove(v=>!v)}>Retirer une voie</button></>}</>:<><span>{item?'Objet saisi · clic droit : supprimer':armed?'Placement · R : tourner':'Cliquez un brasero pour l’éditer'}</span>
        {point&&plan.manualLighting.includes(subCellKey(point,state.world))&&<button disabled={busy||Boolean(uncertain)||plan.equipment.some(e=>subCellKey(e,state.world)===subCellKey(point,state.world))} onClick={()=>void send({kind:'lighting',cell:subCellKey(point,state.world)})}>Rétablir l’éclairage automatique</button>}</>}
      <small>Matière préparée : {(plan.stoneReserve/256).toLocaleString('fr-FR')} pierre</small>
      {op?.kind==='road'&&<small>{length.toLocaleString('fr-FR')} cases de longueur · {area.toLocaleString('fr-FR')} case² · {width} / 8 case utile</small>}
      {quote&&<span>{(quote.stoneUnits/256).toLocaleString('fr-FR')} pierre · débit ◆ {quote.stoneDebit}{quote.woodDebit?` · ▰ ${quote.woodDebit}`:''} · réserve {(quote.reserveAfter/256).toLocaleString('fr-FR')}</span>}
      <span role="status">{busy?'Commande en cours…':error??(insufficient?'Ressources insuffisantes.':family==='Éclairage'?(item?'Clic pour déplacer · clic droit pour supprimer · Échap pour annuler':armed?'Clic pour placer · R pour tourner':'Choisissez un brasero dans le showroom ou sur la carte'):anchor?'Clic pour poursuivre · clic droit : annuler · Échap : terminer':'Choisissez votre point de départ')}</span>
      {uncertain&&<button disabled={busy} onClick={()=>void send(uncertain.operation,uncertain)}>Vérifier la même commande</button>}
    </aside>
  </>;
}
