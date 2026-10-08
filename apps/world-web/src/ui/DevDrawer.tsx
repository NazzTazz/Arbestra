import type { TerrainViewMode } from '../scene/BabylonVillageScene';
import type { VillageState } from '@arbestra/contracts';
import { useState } from 'react';
import { DEFAULT_BUILDING_LOD, getBuildingLodSettings, setBuildingLodSettings } from '../scene/building-lod-settings';

function BuildingLodControls() {
  const [settings, update] = useState(getBuildingLodSettings);
  const change = (value: typeof settings) => { if (setBuildingLodSettings(value)) update(value); };
  return <section><strong>LOD des bâtiments</strong>
    <small>Pixels de rendu par mètre. Augmenter un seuil avance la simplification. Réglages sauvegardés sur cet appareil.</small>
    <label>Proche → périphérie : {settings.near}<input aria-label="Seuil LOD proche" type="range" min={settings.far + 1} max="200" step="1" value={settings.near} onChange={event => change({ ...settings, near: +event.target.value })}/></label>
    <label>Périphérie → lointain : {settings.far}<input aria-label="Seuil LOD lointain" type="range" min="5" max={settings.near - 1} step="1" value={settings.far} onChange={event => change({ ...settings, far: +event.target.value })}/></label>
    <button type="button" onClick={() => change({ ...DEFAULT_BUILDING_LOD })}>Rétablir les seuils LOD</button>
  </section>;
}

export function DevDrawer({ noclip, onNoclip, open, view, state, showTravelPaths, selectedRouteId, cosmology,
  onOpen, onTravelPaths, onRoute, onCosmology, onReset, onFactory }: {
  noclip: boolean;
  onNoclip:(value:boolean)=>void;
  open: boolean;
  view: TerrainViewMode;
  state: VillageState;
  showTravelPaths: boolean;
  selectedRouteId: string | null;
  cosmology: boolean;
  onReset: () => void;
  onFactory:(enabled:boolean)=>void;
  onOpen: (open: boolean) => void;
  onTravelPaths: (value: boolean) => void;
  onRoute: (id: string | null) => void;
  onCosmology: (value: boolean) => void;
}) {
  if (!import.meta.env.DEV) return null;
  return <aside className={`dev-shell${open ? ' is-open' : ''}`} aria-label="Outils développeur">
    {open && <div className="dev-drawer">
      <header><strong>Laboratoire</strong><button type="button" onClick={() => onOpen(false)}>Fermer</button></header>
      <section><strong>Ateliers</strong><label><input type="checkbox" checked={Boolean(state.factoryEnabled)} onChange={event=>onFactory(event.target.checked)}/> Activer les ateliers Bâtiments et Infrastructure</label></section>
      <section><strong>Visualisations</strong>
        <label><input type="checkbox" checked={noclip} onChange={event=>onNoclip(event.target.checked)}/> Passe-muraille</label>
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
      <BuildingLodControls/>
      <button type="button" onClick={onReset}>Rétablir les réglages joueur</button>
      <small>Les contrôles de temps, trajectoire solaire et courbure apparaissent dans le laboratoire cosmologique.</small>
    </div>}
  </aside>;
}
