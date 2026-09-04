import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Building, BuildingTypeDefinition, Garden, VillageState } from '@arbestra/contracts';

import { ApiError, buildBuilding, getVillage, harvestGarden, type TimedVillageState, upgradeBuilding } from './api/client';
import { NotificationStack, type GameNotification } from './ui/NotificationStack';
import { type ScreenAnchor, WorldContextMenu } from './ui/WorldContextMenu';

const VillageScene = lazy(() => import('./scene/VillageScene').then((module) => ({ default: module.VillageScene })));
const worldSlug = new URLSearchParams(window.location.search).get('world') ?? 'aube';
const LOBBY_URL = import.meta.env.VITE_LOBBY_URL ?? 'http://localhost:5173';

function formatResource(value: number): string {
  return Math.floor(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
}

function constructionRemaining(building: Building, serverNow: number): number {
  return Math.max(0, (building.constructionCompletesAt ? Date.parse(building.constructionCompletesAt) : serverNow) - serverNow);
}

function gardenReady(garden: Garden, serverNow: number): number {
  const elapsedHours = Math.max(0, serverNow - Date.parse(garden.productionUpdatedAt)) / 3_600_000;
  return Math.floor(Math.min(garden.capacity, garden.storedCarrots + garden.productionPerHour * elapsedHours));
}

function buildingLabel(building: Building, definitions: BuildingTypeDefinition[]): string {
  return definitions.find((definition) => definition.code === building.type)?.displayName ?? building.type;
}

function wrappedDistance(a: number, b: number, size: number): number {
  const direct = Math.abs(a - b);
  return Math.min(direct, size - direct);
}

export function App() {
  const [state, setState] = useState<VillageState | null>(null);
  const stateRef = useRef<VillageState | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<ScreenAnchor | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [choosingGardenExtension, setChoosingGardenExtension] = useState(false);
  const [notifications, setNotifications] = useState<GameNotification[]>([]);
  const notificationId = useRef(0);
  const notificationTimers = useRef<number[]>([]);

  const pushNotification = useCallback((message: string, tone: GameNotification['tone'] = 'default') => {
    const id = notificationId.current++;
    setNotifications((current) => [{ id, message, tone }, ...current].slice(0, 3));
    notificationTimers.current.push(window.setTimeout(() => {
      setNotifications((current) => current.filter((notification) => notification.id !== id));
    }, 3_800));
  }, []);

  useEffect(() => () => notificationTimers.current.forEach(window.clearTimeout), []);

  const applySnapshot = useCallback((snapshot: TimedVillageState) => {
    const previous = stateRef.current;
    if (previous) {
      const priorBuildings = new Map(previous.cells.flatMap((site) => site.building ? [[site.building.id, site.building] as const] : []));
      for (const site of snapshot.state.cells) {
        const building = site.building;
        const prior = building ? priorBuildings.get(building.id) : undefined;
        if (building?.status === 'completed' && prior?.status === 'under-construction') {
          pushNotification(`${buildingLabel(building, snapshot.state.buildingTypes)} niveau ${building.level} terminé`);
        }
      }
    }
    stateRef.current = snapshot.state;
    setState(snapshot.state);
    setServerOffsetMs(snapshot.serverOffsetMs);
  }, [pushNotification]);

  useEffect(() => {
    void getVillage(worldSlug).then(applySnapshot).catch((reason) => {
      if (reason instanceof ApiError && reason.status === 401) setNeedsLogin(true);
      else setError(reason instanceof Error ? reason.message : 'Chargement impossible.');
    }).finally(() => setLoading(false));
  }, [applySnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const hasConstruction = state?.cells.some((site) => site.building?.status === 'under-construction') ?? false;
  useEffect(() => {
    if (!hasConstruction) return;
    let refreshing = false;
    const timer = window.setInterval(() => {
      if (refreshing) return;
      refreshing = true;
      void getVillage(worldSlug).then(applySnapshot).catch(() => undefined).finally(() => { refreshing = false; });
    }, 250);
    return () => window.clearInterval(timer);
  }, [applySnapshot, hasConstruction]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void getVillage(worldSlug).then(applySnapshot).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => document.removeEventListener('visibilitychange', refreshWhenVisible);
  }, [applySnapshot]);

  const selectedSite = useMemo(() => state?.cells.find((site) => site.id === selectedSiteId) ?? null, [selectedSiteId, state]);
  const extensionCandidates = useMemo(() => {
    if (!state || selectedSite?.building?.type !== 'garden') return [];
    return state.cells.filter((site) => site.canBuild
      && wrappedDistance(site.cellX, selectedSite.cellX, state.world.widthCells)
        + wrappedDistance(site.cellY, selectedSite.cellY, state.world.heightCells) === 1);
  }, [state, selectedSite]);
  const highlightedSiteIds = choosingGardenExtension ? extensionCandidates.map((site) => site.id) : [];
  const serverNow = now + serverOffsetMs;
  const displayedWood = state
    ? Math.floor(state.village.wood + state.village.woodProductionPerHour * Math.max(0, serverNow - Date.parse(state.serverTime)) / 3_600_000)
    : 0;

  async function runAction(action: () => Promise<TimedVillageState>, successMessage?: string) {
    setPendingAction(true);
    setError(null);
    try {
      applySnapshot(await action());
      setChoosingGardenExtension(false);
      if (successMessage) pushNotification(successMessage);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Action impossible.';
      setError(message);
      pushNotification(message, 'warning');
    } finally {
      setPendingAction(false);
    }
  }

  function handleSiteSelected(siteId: string, anchor: ScreenAnchor) {
    if (choosingGardenExtension) {
      const target = extensionCandidates.find((site) => site.id === siteId);
      if (target && selectedSite?.building && state) {
        void runAction(
          () => upgradeBuilding(state.world.slug, state.village.id, selectedSite.building!.id, target.id),
          'Extension du jardin lancée',
        );
        return;
      }
    }
    setSelectedSiteId(siteId);
    setMenuAnchor(anchor);
    setChoosingGardenExtension(false);
  }

  function closeContextMenu() {
    setSelectedSiteId(null);
    setMenuAnchor(null);
    setChoosingGardenExtension(false);
  }

  if (loading) return <main className="center-message">Chargement du monde…</main>;
  if (needsLogin) return <main className="center-message"><a href={LOBBY_URL}>Se connecter pour entrer dans ce monde</a></main>;
  if (!state) return <main className="center-message" role="alert">{error ?? 'Village indisponible.'}</main>;

  return (
    <main className="game-shell">
      <Suspense fallback={<div className="center-message">Préparation de la scène…</div>}>
        <VillageScene state={state} highlightedSiteIds={highlightedSiteIds} onSiteSelected={handleSiteSelected} onCameraMoved={closeContextMenu} />
      </Suspense>
      <header className="top-bar">
        <div className="world-identity"><span className="world-name">{state.world.name}</span><strong>{state.village.name}</strong></div>
        <div className="resource resource--wood" aria-label={`${formatResource(displayedWood)} bois`}>
          <span className="resource-icon resource-icon--wood" aria-hidden="true" />
          <strong>{formatResource(displayedWood)}</strong><small>+{state.village.woodProductionPerHour}/h</small>
        </div>
        <div className="resource" aria-label={`${formatResource(state.village.carrots)} carottes`}>
          <span className="resource-icon resource-icon--carrot" aria-hidden="true" /><strong>{formatResource(state.village.carrots)}</strong>
        </div>
        <NotificationStack notifications={notifications} />
      </header>
      {selectedSite && menuAnchor ? (
        <WorldContextMenu anchor={menuAnchor}>
          {choosingGardenExtension ? (
            <div className="extension-choice"><span>Extension du jardin</span><strong>Choisissez une case adjacente.</strong>
              <button type="button" onClick={() => setChoosingGardenExtension(false)}>Annuler</button></div>
          ) : null}
          {selectedSite.building ? (
            <BuildingDetails
              building={selectedSite.building}
              definition={state.buildingTypes.find((definition) => definition.code === selectedSite.building?.type)!}
              serverNow={serverNow}
              pendingAction={pendingAction}
              onUpgrade={() => {
                if (selectedSite.building?.type === 'garden') setChoosingGardenExtension(true);
                else void runAction(
                  () => upgradeBuilding(state.world.slug, state.village.id, selectedSite.building!.id),
                  'Amélioration lancée',
                );
              }}
              onHarvest={() => {
                const ready = selectedSite.building?.garden ? gardenReady(selectedSite.building.garden, serverNow) : 0;
                void runAction(
                  () => harvestGarden(state.world.slug, state.village.id, selectedSite.building!.id),
                  ready > 0 ? `+${formatResource(ready)} carottes récoltées` : 'Récolte effectuée',
                );
              }}
            />
          ) : null}
          {selectedSite.canBuild && !choosingGardenExtension ? (
            <div className="build-choice"><span>Emplacement libre</span>
              {state.buildingTypes.filter((definition) => definition.buildable).map((definition) => {
                const cost = definition.levels.find((level) => level.level === 1)?.costs.find((item) => item.resourceCode === 'wood')?.amount ?? 0;
                return <button type="button" key={definition.code} disabled={pendingAction || displayedWood < cost}
                  onClick={() => void runAction(
                    () => buildBuilding(state.world.slug, state.village.id, selectedSite.id, definition.code),
                    `${definition.displayName} en chantier`,
                  )}>Construire {definition.displayName} — {cost} bois</button>;
              })}
            </div>
          ) : null}
          {error ? <p className="error" role="alert">{error}</p> : null}
        </WorldContextMenu>
      ) : null}
    </main>
  );
}

function BuildingDetails({ building, definition, serverNow, pendingAction, onUpgrade, onHarvest }: {
  building: Building;
  definition: BuildingTypeDefinition;
  serverNow: number;
  pendingAction: boolean;
  onUpgrade: () => void;
  onHarvest: () => void;
}) {
  const garden = building.type === 'garden' ? building.garden : null;
  const currentLevel = definition.levels.find((level) => level.level === building.level);
  const nextLevel = definition.levels.find((level) => level.level === building.level + 1);
  const upgradeCost = nextLevel?.costs.find((cost) => cost.resourceCode === 'wood')?.amount ?? null;
  const ownProduction = currentLevel?.production.find((production) => production.resourceCode === 'wood')?.ratePerHour ?? 0;
  return (
    <div className="building-details">
      <span>{definition.displayName}</span>
      <strong>Niveau {building.level}{building.targetLevel ? ` → ${building.targetLevel}` : ''}</strong>
      {building.type === 'sawmill' ? <p>Production : +{ownProduction}/h</p> : null}
      {garden ? <>
        <p>Prêtes : {formatResource(gardenReady(garden, serverNow))} / {garden.capacity} carottes</p>
        <p>Production : +{garden.productionPerHour}/h</p>
        <button type="button" disabled={pendingAction || building.status !== 'completed'} onClick={onHarvest}>Récolter</button>
      </> : null}
      {building.status === 'under-construction' ? <ConstructionStatus building={building} serverNow={serverNow} /> : null}
      {upgradeCost !== null ? <button type="button" disabled={pendingAction || building.status !== 'completed'} onClick={onUpgrade}>
        Améliorer — {upgradeCost} bois
      </button> : null}
    </div>
  );
}

function ConstructionStatus({ building, serverNow }: { building: Building; serverNow: number }) {
  const remaining = constructionRemaining(building, serverNow);
  return <p className="construction-status" data-testid="construction-status">Chantier — {remaining > 0 ? `${Math.ceil(remaining / 1_000)} s` : 'Finalisation…'}</p>;
}
