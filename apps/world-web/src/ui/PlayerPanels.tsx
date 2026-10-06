import type { Building, BuildingTypeDefinition, DepositDetails, VillageState } from '@arbestra/contracts';
import { useState } from 'react';

const format = (value: number) => Math.floor(value).toLocaleString('fr-FR');
const secondsUntil = (iso: string, now: number) => Math.max(0, Math.ceil((Date.parse(iso) - now) / 1_000));

export function PopulationPanel({ population, pending, count, focus = null, onFocus, buildingId, assignmentIds = [], onCount, onFeed, onRest }: { population: VillageState['village']['population']; pending: boolean; count: number; focus?: string | null; onFocus?: (id: string | null, filter: string) => void; buildingId?: string | null; assignmentIds?: string[]; onCount: (count: number) => void; onFeed: () => void; onRest: () => void }) {
  const [filter, setFilter] = useState('all');
  const cohorts = population.cohorts?.filter(c => (!buildingId || c.restBuildingId === buildingId || !!c.assignmentId && assignmentIds.includes(c.assignmentId))
    && (filter === 'all' || filter === 'training' ? filter === 'all' || c.assignmentKind === 'science' : c.activity === filter)) ?? [];
  return <div className="building-details population-panel"><span>Habitants</span><strong>{population.total} / {population.housingCapacity} couchages</strong><p>{population.available} disponibles · {population.working} au travail · {population.resting} au repos</p>
    <div className="population-filters">{[['all','Tous'],['idle','Disponibles'],['working','Travail'],['resting','Repos'],['training','Science / formation']].map(([id,label]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => { setFilter(id!); onFocus?.(null, id!); }}>{label}</button>)}</div>
    <div className="cohort-list">{cohorts.map(c => <button type="button" key={c.id} aria-pressed={focus === c.id || focus === c.assignmentId} onClick={() => onFocus?.(focus === c.id ? null : c.id, filter)}>
      {c.memberCount} personnes · {c.activity === 'resting' ? 'Repos' : c.activity === 'idle' ? 'Disponibles' : c.assignmentKind === 'garden' ? 'Récolte' : c.assignmentKind === 'extraction' ? 'Chantier' : c.assignmentKind === 'processing' ? 'Fabrication' : 'Science'} · énergie {c.energy ?? '—'}{c.cartographer ? ' · cartographes' : ''}
    </button>)}</div>
    <div className="energy-list" aria-label="Répartition de l’énergie">{population.energyCounts.map((amount, energy) => amount ? <span key={energy}>Énergie {energy} : {amount}</span> : null)}</div>
    {population.restHousing ? <p>Au repos : {population.restHousing.reduce((n,h)=>n+h.restingCount,0)} avec un couchage{population.restingWithoutHousing ? ` · ${population.restingWithoutHousing} sans couchage` : ''}</p> : null}
    <label>Effectif <input type="number" min="1" max={Math.max(1, population.available)} value={count} onChange={(event) => onCount(Number(event.target.value))} /></label>
    <button type="button" disabled={pending || population.available < 1} onClick={onFeed}>Faire manger</button><button type="button" disabled={pending || population.available < 1} onClick={onRest}>Envoyer au repos</button></div>;
}

export function BuildingPanel({ mode, building, definition, serverNow, pending, pendingHarvestKeys = new Set<string>(), readyCarrots, availableWorkers, onUpgrade, onPrepareGardens, onDiscover }: { mode: 'exploitation' | 'construction' | 'population'; building: Building; definition: BuildingTypeDefinition; serverNow: number; pending: boolean; pendingHarvestKeys?: Set<string>; readyCarrots: number; availableWorkers: number; onUpgrade: () => void; onPrepareGardens: () => void; onDiscover: () => void }) {
  const garden = building.garden;
  const current = definition.levels.find((level) => level.level === building.level);
  const next = definition.levels.find((level) => level.level === building.level + 1);
  const upgradeCost = next?.costs.find((cost) => cost.resourceCode === 'wood')?.amount;
  const extensionCost = current?.costs.find((cost) => cost.resourceCode === 'wood')?.amount ?? 0;
  return <div className="building-details"><span>{definition.displayName}</span><strong>Niveau {building.level}{building.targetLevel ? ` → ${building.targetLevel}` : ''}</strong>
    {building.type === 'town-hall' ? building.hiddenSuppliesAvailable ? <><p>Un vieux coffre est dissimulé dans les réserves.</p>{mode === 'exploitation' && <button disabled={pending} type="button" onClick={onDiscover}>Fouiller les réserves</button>}</> : <p>Réserves fouillées · le coffre est vide.</p> : null}
    {current?.processing && <p>{current.processing.workerCap} poste(s) de fabrication.</p>}
    {garden ? <><p>{garden.activeCellCount} parcelle{garden.activeCellCount > 1 ? 's' : ''} active{garden.activeCellCount > 1 ? 's' : ''}{garden.pendingCellCount ? ` · ${garden.pendingCellCount} en chantier` : ''}</p>
      {garden.harvest ? <><p className="construction-status">Récolte en cours · retour dans {secondsUntil(garden.harvest.completesAt, serverNow)} s</p><p>{garden.harvest.workerCount} récolteurs · {format(garden.harvest.reservedCarrots)} carottes en transit</p></> : <p>Prêtes : {format(readyCarrots)} / {garden.capacity} carottes</p>}
      <p>Production : +{garden.productionPerHour}/h</p>{(garden.expansions ?? (garden.expansion ? [garden.expansion] : [])).map((expansion) => <p key={expansion.id} className="construction-status">Extension · {expansion.cells.length} parcelle(s) — {secondsUntil(expansion.completesAt, serverNow)} s</p>)}
      {availableWorkers < 1 ? <p className="error">Aucun habitant disponible et reposé.</p> : null}
      {mode === 'exploitation' && <><div className="garden-plot-actions" aria-label="Parcelles du Jardin">{garden.plots.map((plot) => <span key={`${plot.cellX}:${plot.cellY}`}>
        Parcelle {plot.cellX}, {plot.cellY} · {pendingHarvestKeys.has(`${plot.cellX}:${plot.cellY}`) ? 'sélectionnée' : plot.harvest ? 'en cours' : `${format(plot.storedCarrots)} carottes`}</span>)}</div>
        <button type="button" disabled={pending || building.status !== 'completed' || Boolean(garden.harvest) || readyCarrots < 1 || availableWorkers < 1}
          onClick={onPrepareGardens}>Préparer une tournée dans le monde</button></>}
      {mode === 'construction' && <button type="button" disabled={pending || building.status !== 'completed' || garden.expansion !== null} onClick={onUpgrade}>Étendre — {extensionCost} bois / case</button>}</> : null}
    {building.status === 'under-construction' ? <p className="construction-status">Chantier — {secondsUntil(building.constructionCompletesAt!, serverNow)} s</p> : null}
    {mode === 'construction' && upgradeCost !== undefined ? <button type="button" disabled={pending || building.status !== 'completed'} onClick={onUpgrade}>Améliorer — {upgradeCost} bois</button> : null}</div>;
}

export function DepositPanel({ details, loading, pending, onPrepare }: { details: DepositDetails | null; loading: boolean; pending: boolean;
  onPrepare: (family: 'wood' | 'stone', woodMode?: 'cut' | 'clear') => void }) {
  if (loading && !details) return <div className="building-details"><strong>Ressource naturelle</strong><p>Inspection…</p></div>;
  if (!details) return <div className="building-details"><strong>Ressource naturelle</strong><p>Détails indisponibles.</p></div>;
  const wood = details.deposit.resourceCode === 'wood';
  const access = details.eligibility.inRange && !details.eligibility.protected && details.eligibility.onBoundary;
  return <div className="building-details"><span>Ressource naturelle</span><strong>{wood ? 'Bosquet' : 'Gisement de pierre'}</strong>
    <p>{format(details.deposit.availableAmount)} disponibles · {format(details.deposit.remainingAmount)} restantes</p>
    <p>Le trajet s’ajoute au temps de travail. Les paramètres de la prochaine mission restent dans la palette.</p>
    {!access && <p className="error">Ce gisement est hors de portée, protégé ou inaccessible.</p>}
    {wood ? <><p>{details.deposit.cleared ? 'Bosquet défriché' : `Repousse : ${details.deposit.regrowthPerHour?.toFixed(2) ?? '0,89'} bois/h`}</p>
      <button type="button" disabled={pending || !access || details.deposit.cleared} onClick={() => onPrepare('wood', 'cut')}>Préparer une coupe</button>
      <button type="button" disabled={pending || !access || details.deposit.cleared} onClick={() => onPrepare('wood', 'clear')}>Préparer un défrichage</button></>
      : <button type="button" disabled={pending || !access || details.deposit.remainingAmount < 1} onClick={() => onPrepare('stone')}>Préparer l’extraction</button>}</div>;
}

export function WorksitePanel({ worksites, orders = [], serverNow = Date.now(), pending, onAction }: { worksites: VillageState['village']['worksites']; orders?: NonNullable<VillageState['village']['exploitationOrders']>; serverNow?: number; pending: boolean;
  onAction: (id: string, action: 'pause' | 'resume' | 'stop' | 'set-cap', cap?: number) => void }) {
  const waitLabels: Record<string, string> = { 'stock-reserved': 'bois réservé ailleurs', access: 'accès bloqué',
    'workers-resting': 'équipe au repos', 'route-too-long': 'trajet trop long pour une équipe reposée', waiting: 'en attente' };
  return <div className="worksite-panel"><strong>Chantiers</strong>{orders.filter(o => o.status !== 'completed').map(o => <div className="exploitation-orders" key={o.id}>
    <p>Geste commun · {o.mobilized}/{o.workerCap} habitants · {o.status === 'waiting' ? 'en attente' : o.status === 'returning' ? 'retours engagés' : 'en activité'}</p>
    <small>{o.deadline ? serverNow >= Date.parse(o.deadline) ? 'Fenêtre fermée · aucun nouveau départ' : `Fenêtre : ${secondsUntil(o.deadline,serverNow)} s restantes` : 'Jusqu’à l’objectif'} · Jardins : {o.gardenStatus === 'pending' ? 'en attente' : o.gardenStatus === 'active' ? 'tournée engagée' : 'terminés'}</small></div>)}
    {worksites.length === 0 ? <p>Aucun chantier.</p> : worksites.map(site => {
    const done = site.targets.filter(target => target.status !== 'pending').length;
    return <div className="worksite-card" key={site.id}><strong>{site.mode === 'extract' ? 'Pierre' : site.mode === 'clear' ? 'Défrichage' : 'Coupe'} · {done}/{site.targets.length}</strong>
      <p>{site.status === 'running' ? site.waitReason ? `En attente : ${waitLabels[site.waitReason] ?? site.waitReason}` : 'En activité' : site.status === 'paused' ? site.activeExtraction ? 'Pause demandée · retour en cours' : 'En pause' : site.status === 'stopping' ? 'Arrêt demandé · retour en cours' : site.status === 'completed' ? 'Terminé' : 'Arrêté'}</p>
      <p>{format(site.deliveredAmount)} {site.resourceCode === 'wood' ? 'bois' : 'pierre'} livrés{site.activeExtraction ? ` · ${site.activeExtraction.workerCount} habitants · retour dans ${secondsUntil(site.activeExtraction.completesAt, serverNow)} s` : ''}</p>
      {site.status === 'running' || site.status === 'paused' ? <><label>Plafond <select aria-label="Plafond du chantier" disabled={pending} value={site.workerCap} onChange={event => onAction(site.id, 'set-cap', Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} habitant{index ? 's' : ''}</option>)}</select></label>
        <button disabled={pending} onClick={() => onAction(site.id, site.status === 'running' ? 'pause' : 'resume')}>{site.status === 'running' ? 'Pause' : 'Reprendre'}</button>
        <button disabled={pending} onClick={() => onAction(site.id, 'stop')}>Arrêter</button></> : null}</div>;
  })}</div>;
}
