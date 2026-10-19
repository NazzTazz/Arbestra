import type { VillageState } from '@arbestra/contracts';
import type {CSSProperties} from 'react';
import { NotificationStack, type GameNotification } from './NotificationStack';
import {HUD_RESOURCES,hudResourceAmounts,type ResourceFeedback} from './resource-feedback';
import './resource-feedback.css';

const format = (value: number) => Math.floor(value).toLocaleString('fr-FR');

export function Hud({ readOnly=false,beforeTownHall=false, state, displayedWood, notifications, resourceFeedback=[],onResourceFeedbackEnd, onPopulation, onJournal, devOpen, devActive, onDev }: { readOnly?:boolean;beforeTownHall?:boolean; state: VillageState; displayedWood: number; notifications: GameNotification[]; resourceFeedback?:ResourceFeedback[];onResourceFeedbackEnd?:(id:number)=>void; onPopulation: () => void; onJournal: () => void; devOpen:boolean;devActive:boolean;onDev:()=>void }) {
  const amounts={...hudResourceAmounts(state.village),wood:displayedWood};
  const population = state.village.population;
  return <header className="top-bar">
    <div className="world-identity"><span className="world-name">{state.world.name}</span><strong>{state.village.name}</strong></div>
    {HUD_RESOURCES.map(resource=><div key={resource.code} className={`resource resource--${resource.code}`} data-resource={resource.code} title={resource.title} aria-label={`${format(amounts[resource.code])} ${resource.label}`}>
      {resource.code==='stone'?<span aria-hidden="true">◆</span>:<span className={`resource-icon resource-icon--${resource.icon}`} aria-hidden="true"/>}
      <strong>{format(amounts[resource.code])}</strong>
      <span className="resource-feedback" aria-live="polite" aria-atomic="false">
        {!readOnly&&resourceFeedback.filter(item=>item.resourceCode===resource.code&&item.context===state.world.id+':'+state.village.id).map(item=><span key={item.id} className="resource-change" data-amount={item.amount} style={{'--resource-lane':item.lane} as CSSProperties} onAnimationEnd={()=>onResourceFeedbackEnd?.(item.id)}>
          {item.amount>0?'+':'−'}{format(Math.abs(item.amount))}<span className="resource-change-label"> {resource.label}</span>
        </span>)}
      </span>
    </div>)}
    <button className="population-button" type="button" disabled={beforeTownHall||readOnly} onClick={onPopulation} aria-label={readOnly?'Habitants du village observé':'Gérer les habitants'}><span aria-hidden="true">♟</span><strong>{population.total}/{population.housingCapacity}</strong><small>{population.available} libres</small></button>
    <button className="journal-button" type="button" onClick={onJournal} aria-label={readOnly?'Ouvrir le journal d’observation':"Ouvrir le grimoire de l'Oracle"}><span aria-hidden="true">◇</span><strong>{readOnly?'Journal':'Grimoire'}</strong>{!readOnly&&state.village.accomplishments.length > 0 ? <small>{state.village.accomplishments.length}</small> : null}</button>
    <NotificationStack notifications={notifications} />
    {import.meta.env.DEV&&<button className="dev-toggle resource-dev" type="button" aria-expanded={devOpen} onClick={onDev}>DEV{devActive?' · actif':''}</button>}
  </header>;
}
