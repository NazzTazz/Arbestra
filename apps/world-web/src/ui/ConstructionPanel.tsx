import { useState } from 'react';
import type { BuildingTypeDefinition, VillageState } from '@arbestra/contracts';
import type { AreaPreview } from '../scene/construction-selection';
import type { UpgradePreview } from './construction-intent';
import { BuildingThumbnail } from './BuildingThumbnail';
import { BUILDING_PRESENTATIONS } from './building-catalog';

export interface ConstructionChoice {
  action: 'build' | 'upgrade' | 'extend';
  type: string | null;
  buildingId?: string;
}
const categoryOf = (code: string) => code === 'dwelling' ? 'Habitat' : code === 'garden' || code === 'sawmill' ? 'Production' : code === 'university' ? 'Savoir' : 'Administration';
const resourceNames: Record<string, string> = { wood: 'bois', stone: 'pierre', carrots: 'carottes' };
const duration = (seconds: number) => seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
export function CostLine({ costs }: { costs: Array<{ resourceCode: string; amount: number }> }) {
  return <span className="resource-costs">{costs.map(cost => <span key={cost.resourceCode}><i aria-hidden="true">{cost.resourceCode === 'wood' ? '▰' : cost.resourceCode === 'stone' ? '◆' : '●'}</i>{cost.amount.toLocaleString('fr-FR')} <small>{resourceNames[cost.resourceCode] ?? cost.resourceCode}</small></span>)}</span>;
}
export function ConstructionPanel({ construction, definitions, area, costs, error, pending, population, gardenWorkerNeed, upgrade,
  intentState, collapsed, onToggle, onChoose, onTool, onCancel, onRetry, onClearError }: {
  construction: ConstructionChoice;
  definitions: BuildingTypeDefinition[];
  area: AreaPreview | null;
  costs: Array<{ resourceCode: string; amount: number }>;
  upgrade: UpgradePreview | null;
  error: string | null;
  pending: boolean;
  intentState: 'idle' | 'submitting' | 'error' | 'uncertain';
  population: VillageState['village']['population'];
  gardenWorkerNeed: number | null;
  collapsed: boolean;
  onToggle: () => void;
  onChoose: (type: string) => void;
  onTool: (action: 'build' | 'upgrade' | 'extend') => void;
  onClear: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onClearError: () => void;
}) {
  const [category, setCategory] = useState('Habitat');
  const definition = definitions.find(item => item.code === construction.type);
  const groups = ['Habitat', 'Production', 'Savoir', 'Administration'].filter(group => definitions.some(item => categoryOf(item.code) === group));
  const title = construction.action === 'upgrade' ? 'Améliorer' : construction.action === 'extend' ? 'Étendre un Jardin' : definition?.displayName ?? 'Choisir un bâtiment';
  const locked = pending || intentState === 'uncertain';
  const level = definition?.levels.find(item => item.level === 1);
  const problem = error ?? upgrade?.error;
  const status = intentState === 'uncertain' ? 'Résultat inconnu · vérifiez la même commande sans double débit.'
    : pending ? 'Commande en cours…' : problem ?? (area ? `${area.count} case${area.count > 1 ? 's' : ''} · relâchez pour construire`
    : construction.action === 'upgrade' ? 'Survolez un bâtiment pour voir son prochain niveau et son coût.'
    : construction.action === 'extend' && !construction.buildingId ? 'Choisissez un Jardin, puis tracez son extension.'
    : definition ? 'Survolez le terrain, puis cliquez ou tracez.' : 'Choisissez une recette, puis placez-la dans le monde.');
  const shownCosts = construction.action === 'upgrade' ? upgrade?.costs ?? [] : area ? costs : level?.costs ?? [];
  return <section className={`command-palette construction-palette${collapsed ? ' is-collapsed' : ''}`} aria-label="Palette de construction">
    <header className="palette-header"><div><strong>Construction</strong><small>{title}</small></div>
      {!collapsed && <div className="palette-tabs construction-tools" role="group" aria-label="Outils de construction">
          {(['build', 'upgrade', 'extend'] as const).map((action, i) => <button key={action} type="button" aria-pressed={construction.action === action} disabled={locked} onClick={() => onTool(action)}>{['Construire', 'Améliorer', 'Étendre'][i]}</button>)}
        </div>}
      <button className="palette-collapse" type="button" aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? 'Déployer' : 'Replier'}</button></header>
    {collapsed ? <div className="palette-collapsed-summary"><span>{status}</span><CostLine costs={shownCosts}/></div> : <>
      {construction.action === 'build' && <>
        <div className="catalog-categories" role="group" aria-label="Familles de bâtiments">{groups.map(group => <button type="button" key={group} aria-pressed={category === group} onClick={() => setCategory(group)}>{group}</button>)}</div>
        <div className="construction-workbench"><div className="building-catalog">
          {definitions.filter(item => categoryOf(item.code) === category).map(item => {
            const initial = item.levels.find(entry => entry.level === 1);
            const unavailable = !item.buildable || !initial;
            const presentation = BUILDING_PRESENTATIONS[item.code];
            return <button className="building-card" type="button" key={item.code} disabled={locked || unavailable} aria-pressed={construction.type === item.code}
              title={`${presentation?.purpose ?? item.displayName} ${unavailable ? 'Construction indisponible.' : `Travaux : ${duration(initial.constructionDurationSeconds)}.`}`}
              onClick={() => onChoose(item.code)}>
              <BuildingThumbnail code={item.code}/><b>{item.displayName}</b><small>{presentation?.footprint ?? 'Emprise selon recette'}</small>
              {unavailable ? <em>Non constructible</em> : <CostLine costs={initial.costs}/>}
            </button>;
          })}
        </div><aside className="construction-recipe-detail">
          {definition ? <><strong>{definition.displayName}</strong><p>{BUILDING_PRESENTATIONS[definition.code]?.purpose}</p>
            <span>{BUILDING_PRESENTATIONS[definition.code]?.footprint}</span>
            {level && <span>Travaux : {duration(level.constructionDurationSeconds)}{definition.progressionMode === 'spatial' ? ' par case' : ''}</span>}
            <CostLine costs={shownCosts}/>{definition.progressionMode === 'spatial' && !area && <small>Coût par case · total pendant le tracé</small>}
          </> : <><strong>Le village prend forme</strong><p>Choisissez un bâtiment pour préparer son placement.</p><small>Le coût total et l’emprise restent visibles pendant le geste.</small></>}
        </aside></div>
      </>}
      {construction.action === 'upgrade' && upgrade && <div className="construction-upgrade-preview"><BuildingThumbnail code={upgrade.code} level={upgrade.nextLevel}/><div><strong>{upgrade.name} · niveau {upgrade.level}{upgrade.nextLevel > upgrade.level ? ` → ${upgrade.nextLevel}` : ""}</strong><CostLine costs={upgrade.costs}/>{upgrade.nextLevel > upgrade.level && <span>Travaux : {duration(upgrade.durationSeconds)}</span>}<small>{upgrade.error ?? 'Cliquez ce bâtiment pour engager l’amélioration.'}</small></div></div>}
      {construction.action === 'extend' && <div className="construction-recipe-detail"><strong>Extension du Jardin</strong><CostLine costs={shownCosts}/><small>{gardenWorkerNeed !== null ? `Après extension : ${gardenWorkerNeed} parcelles · une tournée avec 1 habitant${population.total < 1 ? ' · aucun habitant disponible' : ''}` : 'Les parcelles existantes ne sont pas facturées.'}</small></div>}
      <div className={`construction-live-summary${problem ? ' is-invalid' : ''}`} role="status"><span>{status}</span><button type="button" disabled={pending} onClick={onCancel}>Quitter</button></div>
      <small className="palette-help">Espace + glissé : caméra · Maj + clic : inspection · Échap : annuler</small>
    </>}
    {(intentState === 'uncertain' || intentState === 'error') && <div className="intent-buttons"><button type="button" disabled={pending} onClick={onRetry}>{intentState === 'uncertain' ? 'Vérifier la même commande' : 'Réessayer'}</button>{intentState === 'error' && <button type="button" disabled={pending} onClick={onClearError}>Effacer l’erreur</button>}</div>}
  </section>;
}
