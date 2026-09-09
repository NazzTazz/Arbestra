import type { Building, BuildingTypeDefinition, DepositDetails, VillageState } from '@arbestra/contracts';

const format = (value: number) => Math.floor(value).toLocaleString('fr-FR');
const secondsUntil = (iso: string, now: number) => Math.max(0, Math.ceil((Date.parse(iso) - now) / 1_000));

export function PopulationPanel({ population, pending, count, onCount, onFeed, onRest }: { population: VillageState['village']['population']; pending: boolean; count: number; onCount: (count: number) => void; onFeed: () => void; onRest: () => void }) {
  return <div className="building-details population-panel"><span>Habitants</span><strong>{population.total} / {population.housingCapacity} couchages</strong><p>{population.available} disponibles · {population.working} au travail · {population.resting} au repos</p>
    <div className="energy-list" aria-label="Répartition de l’énergie">{population.energyCounts.map((amount, energy) => amount ? <span key={energy}>Énergie {energy} : {amount}</span> : null)}</div>
    <label>Effectif <input type="number" min="1" max={Math.max(1, population.available)} value={count} onChange={(event) => onCount(Number(event.target.value))} /></label>
    <button type="button" disabled={pending || population.available < 1} onClick={onFeed}>Faire manger</button><button type="button" disabled={pending || population.available < 1} onClick={onRest}>Envoyer au repos</button></div>;
}

export function BuildingPanel({ building, definition, serverNow, pending, readyCarrots, availableWorkers, onUpgrade, onHarvest, onDiscover }: { building: Building; definition: BuildingTypeDefinition; serverNow: number; pending: boolean; readyCarrots: number; availableWorkers: number; onUpgrade: () => void; onHarvest: (plot: { cellX: number; cellY: number }) => void; onDiscover: () => void }) {
  const garden = building.garden;
  const current = definition.levels.find((level) => level.level === building.level);
  const next = definition.levels.find((level) => level.level === building.level + 1);
  const upgradeCost = next?.costs.find((cost) => cost.resourceCode === 'wood')?.amount;
  const production = current?.production.find((item) => item.resourceCode === 'wood')?.ratePerHour ?? 0;
  const extensionCost = current?.costs.find((cost) => cost.resourceCode === 'wood')?.amount ?? 0;
  return <div className="building-details"><span>{definition.displayName}</span><strong>Niveau {building.level}{building.targetLevel ? ` → ${building.targetLevel}` : ''}</strong>
    {building.type === 'town-hall' ? building.hiddenSuppliesAvailable ? <><p>Un vieux coffre est dissimulé dans les réserves.</p><button disabled={pending} type="button" onClick={onDiscover}>Fouiller les réserves</button></> : <p>Réserves fouillées · le coffre est vide.</p> : null}
    {building.type === 'sawmill' ? <p>Production : +{production}/h</p> : null}
    {garden ? <><p>{garden.activeCellCount} parcelle{garden.activeCellCount > 1 ? 's' : ''} active{garden.activeCellCount > 1 ? 's' : ''}{garden.pendingCellCount ? ` · ${garden.pendingCellCount} en chantier` : ''}</p>
      {garden.harvest ? <><p className="construction-status">Récolte en cours · retour dans {secondsUntil(garden.harvest.completesAt, serverNow)} s</p><p>{garden.harvest.workerCount} récolteurs · {format(garden.harvest.reservedCarrots)} carottes en transit</p></> : <p>Prêtes : {format(readyCarrots)} / {garden.capacity} carottes</p>}
      <p>Production : +{garden.productionPerHour}/h</p>{garden.expansion ? <p className="construction-status">Extension — {secondsUntil(garden.expansion.completesAt, serverNow)} s</p> : null}
      {availableWorkers < 1 ? <p className="error">Aucun habitant disponible et reposé.</p> : null}
      <div className="garden-plot-actions" aria-label="Parcelles du Jardin">{garden.plots.map((plot) => <button key={`${plot.cellX}:${plot.cellY}`} type="button"
        disabled={pending || building.status !== 'completed' || Boolean(plot.harvest) || plot.storedCarrots < 1 || availableWorkers < 1}
        onClick={() => onHarvest(plot)}>Parcelle {plot.cellX}, {plot.cellY} · {plot.harvest ? 'en cours' : `${format(plot.storedCarrots)} carottes`}</button>)}</div>
      <button type="button" disabled={pending || building.status !== 'completed' || garden.expansion !== null} onClick={onUpgrade}>Étendre — {extensionCost} bois / case</button></> : null}
    {building.status === 'under-construction' ? <p className="construction-status">Chantier — {secondsUntil(building.constructionCompletesAt!, serverNow)} s</p> : null}
    {upgradeCost !== undefined ? <button type="button" disabled={pending || building.status !== 'completed'} onClick={onUpgrade}>Améliorer — {upgradeCost} bois</button> : null}</div>;
}

export function DepositPanel({ details, loading, pending, workerCount, onWorkerCount, onStart }: { details: DepositDetails | null; loading: boolean; pending: boolean; workerCount: number; onWorkerCount: (count: number) => void; onStart: () => void }) {
  if (loading && !details) return <div className="building-details"><strong>Gisement de pierre</strong><p>Inspection…</p></div>;
  if (!details) return <div className="building-details"><strong>Gisement de pierre</strong><p>Détails indisponibles.</p></div>;
  const option = details.eligibility.workerOptions.find((item) => item.workerCount === workerCount);
  return <div className="building-details"><span>Ressource naturelle</span><strong>Gisement de pierre</strong><p>{format(details.deposit.availableAmount)} disponibles · {format(details.deposit.remainingAmount)} restantes</p><p>Prochain lot : {format(details.eligibility.lotAmount)} pierre</p>
    <label>Travailleurs <select value={workerCount} onChange={(event) => onWorkerCount(Number(event.target.value))}>{details.eligibility.workerOptions.map((item) => <option key={item.workerCount} value={item.workerCount}>{item.workerCount} · {Math.ceil(item.durationMs / 60_000)} min</option>)}</select></label>
    {option && !option.canStart ? <p className="error">{option.reasonCode === 'WORKERS_UNAVAILABLE' ? 'Habitants disponibles et reposés insuffisants.' : 'Ce travail ne peut pas démarrer.'}</p> : null}<button type="button" disabled={pending || !option?.canStart} onClick={onStart}>Extraire avec {workerCount} habitant{workerCount > 1 ? 's' : ''}</button></div>;
}
