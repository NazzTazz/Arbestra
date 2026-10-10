import {useEffect,useRef,type RefObject} from 'react';
import type {TerrainHandle} from '../scene/VillageScene';
import type {HarvestFeedback} from './use-harvest-tool';
import './harvest-feedback.css';
export function HarvestFeedbackLayer({items,scene}:{items:HarvestFeedback[];scene:RefObject<TerrainHandle|null>}){
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{let frame=0;const draw=()=>{
    for(const node of root.current?.children??[]){const el=node as HTMLElement,item=items.find(i=>i.id===el.dataset.id);if(!item)continue;
      const age=Date.now()-item.at,anchor=age<3000?scene.current?.projectCell(item):null;
      el.style.display=anchor?'block':'none';if(anchor){el.style.left=`${anchor.x}px`;el.style.top=`${anchor.y-35-Math.min(age/70,28)}px`;el.style.opacity=String(Math.min(1,(3000-age)/700));}
    }frame=requestAnimationFrame(draw);};draw();return()=>cancelAnimationFrame(frame);},[items,scene]);
  return <div ref={root} className="harvest-feedback" aria-live="polite">{items.map(item=><span key={item.id} data-id={item.id} className={`harvest-feedback--${item.resource}`} title={item.resource==='error'?item.text:'Quantité confiée à la récolte ; crédit au retour des habitants'}>{item.text}</span>)}</div>;
}
