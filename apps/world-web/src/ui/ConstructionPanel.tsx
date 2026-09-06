import type { BuildingTypeDefinition, VillageState } from '@arbestra/contracts';
import type { AreaPreview } from '../scene/construction-selection';

export interface ConstructionChoice { type: string | null; buildingId?: string }

export function ConstructionPanel({ construction, definitions, area, costs, error, pending, population, gardenWorkerNeed, onOpen, onChoose, onConfirm, onRestart, onCancel }: { construction: ConstructionChoice | null; definitions: BuildingTypeDefinition[]; area: AreaPreview | null; costs: Array<{ resourceCode: string; amount: number }>; error: string | null; pending: boolean; population: VillageState['village']['population']; gardenWorkerNeed: number | null; onOpen: () => void; onChoose: (type: string) => void; onConfirm: () => void; onRestart: () => void; onCancel: () => void }) {
  const definition = definitions.find((item) => item.code === construction?.type);
  const spatial = definition?.progressionMode === 'spatial';
  return <div className="construction-toolbar" aria-label="Construction">
    {!construction ? <button type="button" disabled={pending} aria-keyshortcuts="B" onClick={onOpen}>Construire <kbd>B</kbd></button> : <>
      {!construction.type ? definitions.filter((item) => item.buildable).map((item) => <button type="button" key={item.code} onClick={() => onChoose(item.code)}>{item.displayName}</button>) : <>
        <div className="construction-summary" aria-live="polite"><strong>{construction.buildingId ? 'Étendre' : 'Construire'} : {definition?.displayName}</strong><span>{spatial ? 'Glissez à la souris ; au tactile, touchez deux coins.' : 'Choisissez une case.'}</span>
          {area ? <span>{area.count} case{area.count > 1 ? 's' : ''} · {costs.map((cost) => `${cost.amount.toLocaleString('fr-FR')} ${cost.resourceCode}`).join(', ')}</span> : null}
          {spatial && gardenWorkerNeed !== null && gardenWorkerNeed > population.total ? <span className="warning">Ce Jardin demandera {gardenWorkerNeed} habitants pour une récolte ; vous en avez {population.total}.</span> : null}{error ? <span className="error">{error}</span> : null}</div>
        <button type="button" disabled={pending || !area?.cells.length || Boolean(error)} onClick={onConfirm}>Confirmer</button>{area ? <button type="button" disabled={pending} onClick={onRestart}>Recommencer</button> : null}
      </>}<button type="button" disabled={pending} onClick={onCancel}>Annuler</button>
    </>}
  </div>;
}
