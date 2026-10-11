import { randomUUID } from '../random-uuid';
import {useEffect,useLayoutEffect,useMemo,useRef,useState,useId,type RefObject} from 'react';
import {applyVillageFrame,prepareInfrastructureEdit,emptyInfrastructure,type InfrastructureOperation,type InfrastructureQuote,type InfrastructureRequest,type VillageState,type SubPoint,type RoadMaterial,subCellKey} from '@arbestra/contracts';
import {ApiError,commandInfrastructure,previewInfrastructure,getVillage,type TimedVillageUpdate} from '../api/client';
import type {TerrainHandle} from '../scene/VillageScene';
import type {InfrastructureGesture} from '../scene/infrastructure-renderer';
import {InfrastructureThumbnail} from './InfrastructureThumbnail';
import {RoadVariantMenu} from './RoadVariantMenu';
import './harvest-feedback.css';
type Item={id:string;version:number;position:SubPoint;quarterTurns:number};
const materials=[['none','Pas de route'],['earth','Terre'],['stone-1','Petite Pierre'],['stone-2','Grands Pavés']] as const;
export function InfrastructureTools({state,scene,active,onSnapshot,onWorkshop}:{state:VillageState;scene:RefObject<TerrainHandle|null>;active:boolean;onSnapshot:(s:TimedVillageUpdate)=>void;onWorkshop:()=>void}){
  const [family,setFamily]=useState('Voirie'),[material,setMaterial]=useState<RoadMaterial>('earth'),[width,setWidth]=useState(4),[border,setBorder]=useState(false),[invert,setInvert]=useState(false),[turn,setTurn]=useState(0);
  const [menu,setMenu]=useState<{code:'earth'|'stone-1'|'stone-2';anchor:HTMLButtonElement}|null>(null),menuId=useId();
  const remove=family==='Voirie'&&material==='none';
  const [anchor,setAnchor]=useState<SubPoint|null>(null),[point,setPoint]=useState<SubPoint|null>(null),[item,setItem]=useState<Item|null>(null),[armed,setArmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[serverValid,setServerValid]=useState(true),[uncertain,setUncertain]=useState<InfrastructureRequest|null>(null);
  const session=useRef<string>(randomUUID()),stack=useRef<Array<{id:string;anchor:SubPoint}>>([]),down=useRef<SubPoint|null>(null),latest=useRef({state,family,material,width,border,remove,invert,turn,anchor,point,item,armed,busy,menu});
  const price=useRef<HTMLSpanElement>(null);
  const generation=useRef(0),presented=useRef<{operation:string;revision:number;quote:InfrastructureQuote}|null>(null);
  const previewInFlight=useRef(false);
  latest.current={state,family,material,width,border,remove,invert,turn,anchor,point,item,armed,busy,menu};
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
  useEffect(()=>{
    if(!active)return;
    // Move the label directly: pointer motion must not schedule extra React renders.
    const move=(e:PointerEvent)=>{const node=price.current;if(!node)return;const canvas=e.target instanceof Element&&e.target.closest('.village-canvas');node.style.visibility=canvas?'visible':'hidden';if(canvas){node.style.left=e.clientX+'px';node.style.top=(e.clientY-38)+'px';}};
    window.addEventListener('pointermove',move);
    return ()=>window.removeEventListener('pointermove',move);
  },[active]);
  const clearPending=()=>{try{sessionStorage.removeItem(pendingKey);}catch{/* a storage failure cannot turn a successful server response into uncertainty */}};
  useLayoutEffect(()=>{presented.current=active&&op&&quote?{operation:opKey,revision:plan.revision,quote}:null;});
  useEffect(()=>{scene.current?.infrastructurePreview(active?op:null,!serverValid||insufficient,prepared?.next,prepared?.surface);},[active,opKey,serverValid,insufficient,scene,prepared]);
  useEffect(()=>{
    if(!active||!op||busy)return;let cancelled=false;setServerValid(true);
    const request:InfrastructureRequest={commandId:randomUUID(),sessionId:session.current,revision:plan.revision,operation:op};
    let timer:ReturnType<typeof setTimeout>;
    const run=()=>{
      if(cancelled)return;
      // Coalesce obsolete read-only previews instead of queuing server work.
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
    try{const result=await commandInfrastructure(c.state.world.slug,c.state.village.id,request,c.state.syncRevision===undefined?undefined:{revision:c.state.syncRevision,serverTime:c.state.serverTime});
      // Inspect the accepted command against its exact transport base for undo history.
      // App remains the sole owner of HTTP/SSE reconciliation.
      const applied='frame' in result?applyVillageFrame(c.state,result.frame):null;
      const accepted='state' in result?result.state:applied?.kind==='applied'?applied.state:latest.current.state;
      onSnapshot(result);clearPending();setUncertain(null);
      if(sentGeneration===generation.current){
        if(next.kind==='road'){if(accepted.infrastructure!.revision>current.revision)stack.current.push({id:request.commandId,anchor:next.stroke.points[0]!});setAnchor(next.stroke.points.at(-1)!);}
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
    if(e.kind==='cancel'){setMenu(null);generation.current++;stack.current=[];session.current=randomUUID();down.current=null;setAnchor(null);setItem(null);setPoint(null);setArmed(false);scene.current?.infrastructurePreview(null);return;}
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
    const key=(e:KeyboardEvent)=>{if(!active||e.target instanceof Element&&e.target.closest('input,select,textarea,[contenteditable="true"]'))return;
      if(e.key==='Escape'){e.stopImmediatePropagation();e.preventDefault();if(latest.current.menu){latest.current.menu.anchor.focus();setMenu(null);return;}scene.current?.cancelGesture();handler.current({kind:'cancel',point:null});}
      if(e.key.toLowerCase()==='a'&&!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&latest.current.family==='Voirie'){e.preventDefault();e.stopImmediatePropagation();setInvert(v=>!v);}
      if(e.key.toLowerCase()==='r'&&!e.repeat&&latest.current.family==='Éclairage'&&(latest.current.item||latest.current.armed)){e.preventDefault();setTurn(t=>(t+1)%4);}
    };window.addEventListener('contextmenu',context);window.addEventListener('keydown',key,true);
    return ()=>{stopped=true;cancelAnimationFrame(frame);scene.current?.infrastructureTool(null);window.removeEventListener('contextmenu',context);window.removeEventListener('keydown',key,true);};
  },[active,scene,state.world.id,state.village.id]);
  function chooseFamily(value:string){handler.current({kind:'cancel',point:null});setFamily(value);setError(null);setTurn(0);}
  return <>
    <nav className="construction-categories" aria-label="Familles d’infrastructures">{['Voirie','Bordures','Éclairage'].map(f=><button key={f} aria-pressed={family===f} onClick={()=>chooseFamily(f)}>{f==='Bordures'?'Trottoirs':f}</button>)}{family==='Voirie'&&<button type="button" className="road-elbow-toggle" aria-label="Inverser le coude" aria-keyshortcuts="A" title="Inverser le coude (A)" aria-pressed={invert} onClick={()=>setInvert(v=>!v)}><svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path d={invert?'M4 19V5h16M16 1l4 4-4 4':'M4 19h16V5M16 9l4-4 4 4'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg><kbd>A</kbd></button>}</nav>
    <section className="construction-showroom infrastructure-showroom" aria-label={`Infrastructure · ${family}`}>
      {family==='Voirie'?materials.map(([code,name])=><button type="button" className="showroom-model" key={code} aria-pressed={code==='earth'?material==='earth'||material==='rubble':material===code} aria-expanded={code==='none'?undefined:menu?.code===code} aria-controls={menu?.code===code?menuId:undefined} onClick={e=>{if(code==='none'){setMenu(null);setMaterial('none');setBorder(false);}else{const anchor=e.currentTarget;setMenu(current=>current?.code===code?null:{code,anchor});}}}><strong>{name}</strong><InfrastructureThumbnail code={code==='earth'&&material==='rubble'?'rubble':code}/><span className="resource-costs">{code==='none'?'Supprimer':code.startsWith('stone')?'◆ 4 / case²':'Gratuit'}</span></button>):family==='Bordures'?<button className="showroom-model" onClick={()=>setBorder(b=>!b)} aria-pressed={border}><strong>{border?'Pierre':'Sans trottoir'}</strong><InfrastructureThumbnail code="border"/><span className="resource-costs">◆ 1 / case / côté</span></button>:<button className="showroom-model" aria-pressed={armed} onClick={()=>{setItem(null);setArmed(true);setTurn(0);}}><strong>Brasero</strong><InfrastructureThumbnail code="brazier"/><span className="resource-costs">◆ 2 · ▰ 1</span></button>}
      {import.meta.env.DEV&&state.factoryEnabled&&<button className="showroom-model workshop-launcher" onClick={onWorkshop}><strong>Créer un bâtiment</strong><InfrastructureThumbnail code="workshop"/><span className="resource-costs">Atelier Infrastructure</span></button>}
    </section>
    {active&&menu&&<RoadVariantMenu anchor={menu.anchor} id={menuId} label={menu.code==='earth'?'Textures de terre':menu.code==='stone-1'?'Variantes Petite Pierre':'Variantes Grands Pavés'} onClose={()=>setMenu(null)}>
      {menu.code==='earth'?(['earth','rubble'] as const).map(code=><button type="button" key={code} aria-pressed={material===code} onClick={()=>{setMaterial(code);setWidth(4);setBorder(false);menu.anchor.focus();setMenu(null);}}><strong>{code==='earth'?'Terre battue':'Gravats'}</strong><InfrastructureThumbnail code={code}/><small>Gratuit</small></button>):([4,6] as const).flatMap(size=>[false,true].map(sidewalk=><button type="button" key={size+':'+sidewalk} aria-pressed={material===menu.code&&width===size&&border===sidewalk} onClick={()=>{setMaterial(menu.code);setWidth(size);setBorder(sidewalk);menu.anchor.focus();setMenu(null);}}><strong>{size} de large</strong><small>{sidewalk?'Avec trottoirs':'Sans trottoir'}</small></button>))}
    </RoadVariantMenu>}
    <div className="harvest-feedback infrastructure-price"><span ref={price} hidden={!active||op?.kind!=='road'||!quote} className="harvest-feedback--stone" title="Débit prévisionnel en pierres">{busy?'…':quote?'−'+quote.stoneDebit.toLocaleString('fr-FR'):''}</span></div>
    {(error||uncertain||family==='Éclairage'&&(item||armed))&&<aside className="construction-feedback infrastructure-feedback" aria-label="Action Infrastructure">
      {family==='Éclairage'&&point&&plan.manualLighting.includes(subCellKey(point,state.world))&&<button disabled={busy||Boolean(uncertain)||plan.equipment.some(e=>subCellKey(e,state.world)===subCellKey(point,state.world))} onClick={()=>void send({kind:'lighting',cell:subCellKey(point,state.world)})}>Rétablir l’éclairage automatique</button>}
      <span role="status">{busy?'Commande en cours…':error??(insufficient?'Ressources insuffisantes.':family==='Éclairage'?(item?'Clic pour déplacer · clic droit pour supprimer · Échap pour annuler':armed?'Clic pour placer · R pour tourner':'Choisissez un brasero dans le showroom ou sur la carte'):anchor?'Clic pour poursuivre · clic droit : annuler · Échap : terminer':'Choisissez votre point de départ')}</span>
      {uncertain&&<button disabled={busy} onClick={()=>void send(uncertain.operation,uncertain)}>Vérifier la même commande</button>}
    </aside>}
  </>;
}
