import { useState, type ReactNode } from 'react';
import { constructionCosts } from '@arbestra/contracts';
import type { BuildingTypeDefinition } from '@arbestra/contracts';
import type { AreaPreview } from '../scene/construction-selection';
import type { UpgradePreview } from './construction-intent';
import { BuildingThumbnail } from './BuildingThumbnail';
import { BUILDING_PRESENTATIONS } from './building-catalog';

export interface ConstructionChoice {
  action: 'build' | 'upgrade' | 'extend';
  type: string | null;
  buildingId?: string;
}
const categoryOf = (code: string) => code === 'dwelling' ? 'Habitat' : code === 'garden' || code === 'sawmill' || code === 'stonemason' ? 'Production' : code === 'university' ? 'Savoir' : 'Administration';
const resourceNames: Record<string, string> = { wood: 'bois brut', stone: 'pierre brute', timber:'bois d’œuvre','cut-stone':'pierre taillée',carrot: 'carottes' };
const duration = (seconds: number) => seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
export function CostLine({ costs }: { costs: Array<{ resourceCode: string; amount: number }> }) {
  return <span className="resource-costs">{costs.map(cost => <span key={cost.resourceCode}><i aria-hidden="true">{cost.resourceCode === 'wood' ? '▰' : cost.resourceCode === 'stone' ? '◆' : '●'}</i>{cost.amount.toLocaleString('fr-FR')} <small>{resourceNames[cost.resourceCode] ?? cost.resourceCode}</small></span>)}</span>;
}
export function ConstructionPanel({ starter, houseVariant, construction, definitions, area, costs, error, pending, gardenWorkerNeed, upgrade,
  intentState, collapsed, onToggle, onChoose, onDomainChange, onRetry, onClearError, domain, infrastructure, factoryEnabled, onWorkshop }: {
  starter?: {choices:Array<{key:string;label:string;code:string}>;selected:string;onChoose:(key:string)=>void};
  houseVariant:'stone'|'logs'|'beams';
  construction: ConstructionChoice; definitions: BuildingTypeDefinition[];
  area: AreaPreview | null; costs: Array<{ resourceCode: string; amount: number }>;
  upgrade: UpgradePreview | null; error: string | null; pending: boolean; gardenWorkerNeed: number | null;
  intentState: 'idle' | 'submitting' | 'error' | 'uncertain'; collapsed: boolean;
  onToggle: () => void; onChoose: (type: string,variant?:'stone'|'logs'|'beams') => void; onDomainChange: (domain:'buildings'|'infrastructure') => void;
  domain:'buildings'|'infrastructure'; infrastructure:ReactNode; factoryEnabled:boolean; onWorkshop:()=>void;
  onRetry: () => void; onClearError: () => void;
}) {
  const [category, setCategory] = useState('Habitat');
  const definition = definitions.find(item => item.code === construction.type);
  const groups = ['Habitat', 'Production', 'Savoir', 'Administration'].filter(group => definitions.some(item => categoryOf(item.code) === group));
  const locked = pending || intentState === 'uncertain';
  const level = definition?.levels.find(item => item.level === 1);
  const problem = error ?? upgrade?.error;
  const status = intentState === 'uncertain' ? 'Résultat inconnu · vérifiez la même commande.'
    : pending ? 'Commande en cours…' : problem ?? (upgrade ? `${upgrade.name} · ${upgrade.level} → ${upgrade.nextLevel}`
    : area ? `${construction.action === 'extend' ? 'Extension' : 'Construction'} · ${area.count} case${area.count > 1 ? 's' : ''}` : '');
  const shownCosts = upgrade ? upgrade.costs : area ? costs : constructionCosts(level,houseVariant);
  if (starter) return <>
    <section className="construction-showroom" aria-label="Installation initiale">
      {starter.choices.map(choice => <button className="showroom-model" type="button" key={choice.key} disabled={locked} aria-pressed={starter.selected===choice.key} onClick={()=>starter.onChoose(choice.key)}>
        <strong>{choice.label}</strong><BuildingThumbnail code={choice.code}/><span className="resource-costs">Kit de départ</span>
      </button>)}
    </section>
    <aside className="construction-feedback" aria-label="Action de construction"><strong>{starter.choices.find(c=>c.key===starter.selected)?.label}</strong><p>Clic gauche : poser · R : tourner · Clic droit / Échap : manuel</p>
      {status&&<p role="status">{status}</p>}{intentState==='uncertain'&&<button disabled={pending} onClick={onRetry}>Vérifier la même pose</button>}
    </aside>
  </>;
  return <>
    <section className={`command-palette construction-palette${collapsed ? ' is-collapsed' : ''}`} aria-label="Palette de construction">
      <div className="construction-families" role="group" aria-label="Domaines de construction">
        {(['buildings','infrastructure'] as const).map(item=><button key={item} type="button" disabled={locked}
          aria-label={item==='buildings'?'Bâtiments':'Infrastructure'} title={item==='buildings'?'Bâtiments':'Infrastructure'}
          aria-pressed={domain===item} onClick={()=>{if(item!==domain)onDomainChange(item);if(collapsed)onToggle();}}>
          <BuildingThumbnail code={item==='buildings'?'dwelling':'infrastructure-symbol'}/>
        </button>)}
      </div>
    </section>
    {domain==='buildings'&&(definition||status||intentState==='error'||intentState==='uncertain')&&<aside className="construction-feedback" aria-label="Action de construction">
      {definition && <div className="construction-current"><strong>{definition.code==='dwelling'&&construction.action==='build'?houseVariant==='logs'?'Maison en troncs':houseVariant==='beams'?'Maison en madriers':'Maison en pierre':definition.displayName}</strong><CostLine costs={shownCosts}/>
        {upgrade && upgrade.nextLevel > upgrade.level && <small>Amélioration · {duration(upgrade.durationSeconds)}</small>}
        {construction.action === 'extend' && gardenWorkerNeed !== null && <small>{gardenWorkerNeed} parcelles après extension</small>}
      </div>}
      {status && <div className={`construction-live-summary${problem ? ' is-invalid' : ''}`} role="status">{status}</div>}
      {(intentState === 'uncertain' || intentState === 'error') && <div className="intent-buttons"><button type="button" disabled={pending} onClick={onRetry}>{intentState === 'uncertain' ? 'Vérifier la même commande' : 'Réessayer'}</button>{intentState === 'error' && <button type="button" disabled={pending} onClick={onClearError}>Effacer l’erreur</button>}</div>}
    </aside>}
    {domain==='infrastructure'?infrastructure:<><nav className="construction-categories" aria-label="Familles de bâtiments">{groups.map(group => <button type="button" key={group} aria-pressed={category === group} onClick={() => { setCategory(group); if(collapsed)onToggle(); }}>{group}</button>)}</nav>
    {!collapsed && <section className="construction-showroom" aria-label={`Modèles · ${category}`}>
      {definitions.filter(item => categoryOf(item.code) === category).flatMap(item => (item.code==='dwelling'?(['logs','beams','stone'] as const):[null]).map(variant => {
        const initial = item.levels.find(entry => entry.level === 1), unavailable = !item.buildable || !initial;
        const presentation = BUILDING_PRESENTATIONS[item.code];
        const name=variant==='logs'?'Maison en troncs':variant==='beams'?'Maison en madriers':variant==='stone'?'Maison en pierre':item.displayName;
        return <button className="showroom-model" type="button" key={`${item.code}:${variant??''}`} aria-label={name} disabled={locked || unavailable} aria-pressed={construction.type === item.code&&(!variant||houseVariant===variant)}
          title={`${presentation?.purpose ?? item.displayName} ${presentation?.footprint ?? ''} ${unavailable ? 'Construction indisponible.' : `Travaux : ${duration(initial.constructionDurationSeconds)}.`}`}
          onClick={() => onChoose(item.code,variant??undefined)}>
          <strong>{name}</strong><BuildingThumbnail code={variant&&variant!=='stone'?`dwelling-${variant}`:item.code}/>
          {unavailable ? <em>Non constructible</em> : <CostLine costs={constructionCosts(initial,variant??'stone')}/>}
        </button>;
      }))}
      {factoryEnabled&&<button className="showroom-model workshop-launcher" type="button" onClick={onWorkshop}><strong>Créer un bâtiment</strong><BuildingThumbnail code="town-hall"/><span className="resource-costs">＋ Atelier Bâtiments</span></button>}
    </section>}</>}
  </>;
}
