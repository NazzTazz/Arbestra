import type { TerrainViewMode } from '../scene/BabylonVillageScene';
import type { VillageState } from '@arbestra/contracts';

export function DevDrawer({ open, view, state, showTravelPaths, selectedRouteId, cosmology,
  onOpen, onTravelPaths, onRoute, onCosmology, onReset }: {
  open: boolean;
  view: TerrainViewMode;
  state: VillageState;
  showTravelPaths: boolean;
  selectedRouteId: string | null;
  cosmology: boolean;
  onReset: () => void;
  onOpen: (open: boolean) => void;
  onTravelPaths: (value: boolean) => void;
  onRoute: (id: string | null) => void;
  onCosmology: (value: boolean) => void;
}) {
  if (!import.meta.env.DEV) return null;
  return <aside className={`dev-shell${open ? ' is-open' : ''}`} aria-label="Outils développeur">
    <button className="dev-toggle" type="button" aria-expanded={open} onClick={() => onOpen(!open)}>DEV{(cosmology || showTravelPaths) && <span className="dev-active" title="Visualisation DEV active"> · actif</span>}</button>
    {open && <div className="dev-drawer">
      <header><strong>Laboratoire</strong><button type="button" onClick={() => onOpen(false)}>Fermer</button></header>
      <section><strong>Visualisations</strong>
        <label><input type="checkbox" checked={showTravelPaths} onChange={event => onTravelPaths(event.target.checked)}/> Chemins et transports</label>
        {showTravelPaths && <select value={selectedRouteId ?? ''} onChange={event => onRoute(event.target.value || null)}>
          <option value="">Tous les itinéraires ({state.travelRoutes.length})</option>
          {state.travelRoutes.map(route => <option key={route.id} value={route.id}>{route.kind} · {route.destination.cellX}, {route.destination.cellY}</option>)}
        </select>}
        <label><input type="checkbox" checked={cosmology} onChange={event => onCosmology(event.target.checked)}/> Laboratoire cosmologique</label>
      </section>
      <section><strong>Métriques courantes</strong><span>Vue : {view}</span><span>Terrain local : {state.region.width} × {state.region.height}</span>
        <span>Repères : {state.region.features.length} · routes : {state.travelRoutes.length}</span></section>
      <div id="dev-cosmology-slot"/>
      <button type="button" onClick={onReset}>Rétablir les réglages joueur</button>
      <small>Les contrôles de temps, trajectoire solaire et courbure apparaissent dans le laboratoire cosmologique.</small>
    </div>}
  </aside>;
}
