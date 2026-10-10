import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { SPAWN_DIAGNOSTIC_RADIUS, spawnDistance, spawnSurfacesAt, type SpawnPoint, type SpawnSurface, type SpawnTerrainResult, type SpawnVillage } from '@arbestra/contracts';

export interface AtlasTerritory { villageId: string; points: SpawnPoint[] }
interface Props {
  cursor: SpawnPoint | null; selected: SpawnPoint | null; result: SpawnTerrainResult | null;
  villages: SpawnVillage[]; surfaces: SpawnSurface[]; turns: number;
  territories: AtlasTerritory[]; draft?: SpawnPoint[];
  onHover: (point: SpawnPoint | null) => void; onPick: (point: SpawnPoint) => void;
  onVillage: (id: string | null, screen?: {x:number;y:number}) => void; onKey: (key: string) => void;
}
const copies = [-512,0,512].flatMap(x=>[-256,0,256].map(y=>({x,y})));
const path = (points: SpawnPoint[])=>points.map((p,i)=>`${i?'L':'M'}${p.x} ${256-p.y}`).join(' ')+'Z';
export function AtlasMap(props: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [view,setView]=useState({x:0,y:0,width:512,height:256});
  const [assetFailed,setAssetFailed]=useState(false),[assetAttempt,setAssetAttempt]=useState(0);
  const drag=useRef<{pointer:number;x:number;y:number;view:typeof view;moved:boolean}|null>(null);
  useEffect(()=>{const target=svg.current;if(!target)return;const prevent=(e:WheelEvent)=>e.preventDefault();target.addEventListener('wheel',prevent,{passive:false});return()=>target.removeEventListener('wheel',prevent);},[]);
  // Thousands of road pixels are one reusable path, not 38k DOM rectangles.
  const kit=useMemo(()=>props.selected?spawnSurfacesAt(props.surfaces,props.selected,props.turns).map(s=>`M${s.x-s.halfWidth} ${256-s.y-s.halfHeight}h${s.halfWidth*2}v${s.halfHeight*2}h${-s.halfWidth*2}Z`).join(''):'',[props.surfaces,props.selected,props.turns]);
  const incompatible=useMemo(()=>(props.result?.incompatible??[]).map(c=>`M${c.x-.5} ${256-c.y-.5}h1v1h-1z m.2.2.6.6`).join(''),[props.result]);
  const coordinate=(clientX:number,clientY:number)=>{
    const matrix=svg.current?.getScreenCTM();
    return matrix ? new DOMPoint(clientX,clientY).matrixTransform(matrix.inverse()) : new DOMPoint();
  };
  const point=(clientX:number,clientY:number)=>{const p=coordinate(clientX,clientY);return {x:Math.max(0,Math.min(511,Math.round(p.x))),y:Math.max(0,Math.min(255,Math.round(256-p.y)))};};
  const constrain=(v:typeof view)=>({...v,x:Math.max(0,Math.min(512-v.width,v.x)),y:Math.max(0,Math.min(256-v.height,v.y))});
  const zoom=(factor:number,at={x:view.x+view.width/2,y:view.y+view.height/2})=>setView(v=>{
    const width=Math.max(32,Math.min(512,v.width*factor)), ratio=width/v.width;
    return constrain({x:at.x-(at.x-v.x)*ratio,y:at.y-(at.y-v.y)*ratio,width,height:width/2});
  });
  const move=(event:PointerEvent<SVGSVGElement>)=>{
    const d=drag.current;
    if(d&&d.pointer===event.pointerId){
      const dx=event.clientX-d.x,dy=event.clientY-d.y;
      if(Math.hypot(dx,dy)>5)d.moved=true;
      if(d.moved){const scale=svg.current!.getScreenCTM()!.a;setView(constrain({...d.view,x:d.view.x-dx/scale,y:d.view.y-dy/scale}));return;}
    }
    const p=point(event.clientX,event.clientY), village=props.villages.find(v=>spawnDistance(v,p,512,256)<=2.5);
    props.onVillage(village?.id??null,{x:event.clientX,y:event.clientY});props.onHover(village?null:p);
  };
  return <div className="atlas-frame">
    <div className="atlas-viewport">
    <img key={assetAttempt} className="atlas-background" src="/atlas/rc1.svg" alt="" draggable={false}
      style={{left:`${-view.x/view.width*100}%`,top:`${-view.y/view.height*100}%`,width:`${512/view.width*100}%`,height:`${256/view.height*100}%`}}
      onLoad={()=>svg.current?.setAttribute('data-atlas-ready','true')} onError={()=>setAssetFailed(true)}/>
    <svg ref={svg} className="atlas-canvas" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} tabIndex={0} role="application"
      aria-label="Carte du monde. Flèches pour déplacer le cercle, Entrée pour inspecter." data-radius={SPAWN_DIAGNOSTIC_RADIUS}
      data-cursor-x={props.cursor?.x} data-cursor-y={props.cursor?.y} data-zoom={512/view.width}
      onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.focus();drag.current={pointer:e.pointerId,x:e.clientX,y:e.clientY,view,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={move} onPointerUp={e=>{const d=drag.current;drag.current=null;if(!d||d.pointer!==e.pointerId)return;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(!d.moved){const p=point(e.clientX,e.clientY);const v=props.villages.find(v=>spawnDistance(v,p,512,256)<=2.5);if(v)props.onVillage(v.id);else props.onPick(p);}}}
      onPointerCancel={()=>{drag.current=null;}} onPointerLeave={()=>{if(!drag.current){props.onHover(null);props.onVillage(null);}}}
      onWheel={e=>{zoom(e.deltaY>0?1.2:1/1.2,coordinate(e.clientX,e.clientY));}}
      onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Escape','r','R'].includes(e.key)){e.preventDefault();if(!e.repeat||!['r','R'].includes(e.key))props.onKey(e.key);}}}>
      <defs><g id="atlas-village"><path d="M-2 1V-1l2-1.7L2-1v2ZM-3 .9V-.6l1-1M2-.6l1-1 1 1V1H2M-.5 1V-.3h1V1"/><path d="M0-2.7v-1.5l1.5.4L0-3.4"/></g><path id="atlas-kit-shape" d={kit}/><path id="atlas-incompatible-shape" d={incompatible}/></defs>
      {copies.map(copy=><g key={`${copy.x}:${copy.y}`} transform={`translate(${copy.x} ${-copy.y})`} pointerEvents="none">
        {props.territories.map(t=><path key={t.villageId} className="atlas-territory" d={path(t.points)}/>)}
        {props.draft?.length ? <path className="atlas-territory atlas-draft" d={path(props.draft)}/> : null}
        {props.villages.map(v=><use key={v.id} href="#atlas-village" transform={`translate(${v.x} ${256-v.y})`} className="atlas-village"/>)}
        {props.selected&&<g className="atlas-selection" transform={`translate(${props.selected.x} ${256-props.selected.y})`}><circle r="1.2"/><path d="M-3 0h2M1 0h2M0-3v2M0 1v2"/></g>}
        {props.cursor&&<g className={props.result?.terrainCompatible===false?'atlas-diagnostic blocked':'atlas-diagnostic'}>
          <circle cx={props.cursor.x} cy={256-props.cursor.y} r={SPAWN_DIAGNOSTIC_RADIUS}/>
          {incompatible&&<use href="#atlas-incompatible-shape" className="atlas-incompatible"/>}
        </g>}
        {kit&&<use href="#atlas-kit-shape" className="atlas-kit"/>}
      </g>)}
    </svg>
    </div>
    {assetFailed&&<p className="atlas-error" role="alert">Le fond de carte n’a pas pu être chargé. <button onClick={()=>{setAssetFailed(false);setAssetAttempt(v=>v+1);}}>Recharger le fond</button></p>}
    <div className="atlas-controls" aria-label="Navigation de la carte"><button onClick={()=>zoom(1/1.5)} aria-label="Zoomer">+</button><button onClick={()=>zoom(1.5)} aria-label="Dézoomer">−</button><button onClick={()=>setView({x:0,y:0,width:512,height:256})}>Vue du monde</button></div>
    <span className="atlas-compass" aria-hidden="true">N<br/>✧</span>
  </div>;
}
