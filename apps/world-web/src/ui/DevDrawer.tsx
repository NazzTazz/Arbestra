import type { TerrainViewMode } from '../scene/BabylonVillageScene';
import type { VillageState } from '@arbestra/contracts';
import { useState, useSyncExternalStore } from 'react';
import { setStatisticsEnabled, statisticsEnabled, subscribeStatistics } from '../dev/statistics';
import { DEFAULT_BUILDING_LOD, getBuildingLodSettings, setBuildingLodSettings } from '../scene/building-lod-settings';
import { devToolsEnabled } from '../dev/dev-tools';
import { RENDER_SWITCHES, type MeshFamily, type RenderLab, type RenderSwitch } from '../scene/render-lab';

/** Compare the GPU time of the statistics overlay with and without each layer. */
function RenderLabControls({ lab }: { lab: () => RenderLab | null }) {
  const [, refresh] = useState(0);
  const current = lab();
  if (!current) return null;
  const switches = current.switches();
  const families: MeshFamily[] = current.families().slice(0, 24);
  return (
    <section>
      <strong>Rendu</strong>
      <small>Couper une couche puis lire le temps GPU de l’overlay. Rien n’est conservé au rechargement.</small>
      {(Object.keys(RENDER_SWITCHES) as RenderSwitch[]).map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={switches[key]}
            onChange={(event) => {
              current.setSwitch(key, event.target.checked);
              refresh((n) => n + 1);
            }}
          />{' '}
          {RENDER_SWITCHES[key]}
        </label>
      ))}
      <button type="button" onClick={() => refresh((n) => n + 1)}>
        Recompter les familles de meshes
      </button>
      {families.map((f) => (
        <label key={f.family}>
          <input
            type="checkbox"
            checked={!f.hidden}
            onChange={(event) => {
              current.setFamilyHidden(f.family, !event.target.checked);
              refresh((n) => n + 1);
            }}
          />{' '}
          {f.family} · {f.enabled}/{f.meshes} · {Math.round(f.vertices / 1000)} k sommets
        </label>
      ))}
    </section>
  );
}

function BuildingLodControls() {
  const [settings, update] = useState(getBuildingLodSettings);
  const change = (value: typeof settings) => {
    if (setBuildingLodSettings(value)) update(value);
  };
  return (
    <section>
      <strong>LOD des bâtiments</strong>
      <small>
        Pixels de rendu par mètre. Augmenter un seuil avance la simplification. Réglages sauvegardés sur cet appareil.
      </small>
      <label>
        Proche → périphérie : {settings.near}
        <input
          aria-label="Seuil LOD proche"
          type="range"
          min={settings.far + 1}
          max="200"
          step="1"
          value={settings.near}
          onChange={(event) => change({ ...settings, near: +event.target.value })}
        />
      </label>
      <label>
        Périphérie → lointain : {settings.far}
        <input
          aria-label="Seuil LOD lointain"
          type="range"
          min="5"
          max={settings.near - 1}
          step="1"
          value={settings.far}
          onChange={(event) => change({ ...settings, far: +event.target.value })}
        />
      </label>
      <button type="button" onClick={() => change({ ...DEFAULT_BUILDING_LOD })}>
        Rétablir les seuils LOD
      </button>
    </section>
  );
}

export function DevDrawer({
  noclip,
  onNoclip,
  open,
  view,
  state,
  showTravelPaths,
  selectedRouteId,
  cosmology,
  onOpen,
  onTravelPaths,
  onRoute,
  onCosmology,
  onReset,
  onFactory,
  renderLab,
}: {
  noclip: boolean;
  onNoclip: (value: boolean) => void;
  open: boolean;
  view: TerrainViewMode;
  state: VillageState;
  showTravelPaths: boolean;
  selectedRouteId: string | null;
  cosmology: boolean;
  onReset: () => void;
  onFactory: (enabled: boolean) => void;
  onOpen: (open: boolean) => void;
  onTravelPaths: (value: boolean) => void;
  onRoute: (id: string | null) => void;
  onCosmology: (value: boolean) => void;
  renderLab: () => RenderLab | null;
}) {
  const statistics = useSyncExternalStore(subscribeStatistics, statisticsEnabled, () => false);
  if (!devToolsEnabled()) return null;
  return (
    <aside className={`dev-shell${open ? ' is-open' : ''}`} aria-label="Outils développeur">
      {open && (
        <div className="dev-drawer">
          <header>
            <strong>Laboratoire</strong>
            <button type="button" onClick={() => onOpen(false)}>
              Fermer
            </button>
          </header>
          {import.meta.env.DEV && (
            <section>
              <strong>Ateliers</strong>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(state.factoryEnabled)}
                  onChange={(event) => onFactory(event.target.checked)}
                />{' '}
                Activer les ateliers Bâtiments et Infrastructure
              </label>
            </section>
          )}
          <section>
            <strong>Visualisations</strong>
            <label>
              <input
                type="checkbox"
                checked={statistics}
                onChange={(event) => setStatisticsEnabled(event.target.checked)}
              />{' '}
              Statistiques en overlay
            </label>
            <small>
              Texte blanc. Mesure les prochaines lectures ; choix conservé après rechargement pour observer le
              démarrage.
            </small>
            <label>
              <input type="checkbox" checked={noclip} onChange={(event) => onNoclip(event.target.checked)} />{' '}
              Passe-muraille
            </label>
            <label>
              <input
                type="checkbox"
                checked={showTravelPaths}
                onChange={(event) => onTravelPaths(event.target.checked)}
              />{' '}
              Chemins et transports
            </label>
            {showTravelPaths && (
              <select value={selectedRouteId ?? ''} onChange={(event) => onRoute(event.target.value || null)}>
                <option value="">Tous les itinéraires ({state.travelRoutes.length})</option>
                {state.travelRoutes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.kind} · {route.destination.cellX}, {route.destination.cellY}
                  </option>
                ))}
              </select>
            )}
            {import.meta.env.DEV && (
              <label>
                <input type="checkbox" checked={cosmology} onChange={(event) => onCosmology(event.target.checked)} />{' '}
                Laboratoire cosmologique
              </label>
            )}
          </section>
          <section>
            <strong>Métriques courantes</strong>
            <span>Vue : {view}</span>
            <span>
              Terrain local : {state.region.width} × {state.region.height}
            </span>
            <span>
              Repères : {state.region.features.length} · routes : {state.travelRoutes.length}
            </span>
          </section>
          <RenderLabControls lab={renderLab} />
          <div id="dev-cosmology-slot" />
          <BuildingLodControls />
          <button type="button" onClick={onReset}>
            Rétablir les réglages joueur
          </button>
          <small>
            Les contrôles de temps, trajectoire solaire et courbure apparaissent dans le laboratoire cosmologique.
          </small>
        </div>
      )}
    </aside>
  );
}
