import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Building, BuildingTypeDefinition, Garden, VillageState } from '@arbestra/contracts';

import { ApiError, buildBuilding, expandGarden, getVillage, harvestGarden, type TimedVillageState, upgradeBuilding } from './api/client';
import { NotificationStack, type GameNotification } from './ui/NotificationStack';
import { type ScreenAnchor, WorldContextMenu } from './ui/WorldContextMenu';
import { cellKey, previewArea, touchesCell, type Cell, type CellRange } from './scene/construction-selection';

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
  const [construction, setConstruction] = useState<{ type: string | null; buildingId?: string } | null>(null);
  const [selection, setSelection] = useState<CellRange | null>(null);
  const touchOrigin = useRef<Cell | null>(null);
  const actionInFlight = useRef(false);
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
        if (prior?.garden?.expansion && building?.garden && !building.garden.expansion) {
          pushNotification('Extension du Jardin terminée');
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

  const hasConstruction = state?.cells.some((site) => site.building?.status === 'under-construction' || Boolean(site.building?.garden?.expansion)) ?? false;
  useEffect(() => {
    if (!hasConstruction) return;
    let refreshing = false;
    const timer = window.setInterval(() => {
      if (refreshing || actionInFlight.current) return;
      refreshing = true;
      void getVillage(worldSlug).then((snapshot) => {
        // A request started before a command must not replace its newer result.
        if (!actionInFlight.current && (!stateRef.current || snapshot.state.serverTime >= stateRef.current.serverTime)) applySnapshot(snapshot);
      }).catch(() => undefined).finally(() => { refreshing = false; });
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
  const selectedBuilding = useMemo(() => selectedSite?.building
    ?? (selectedSite?.footprint ? state?.cells.find((site) => site.building?.id === selectedSite.footprint?.buildingId)?.building ?? null : null), [selectedSite, state]);
  const constructionDefinition = state?.buildingTypes.find((item) => item.code === construction?.type);
  const spatial = constructionDefinition?.progressionMode === 'spatial';
  const area = useMemo(() => state && selection
    ? previewArea(state, selection, spatial, construction?.buildingId)
    : null, [state, selection, spatial, construction?.buildingId]);
  const highlightedSiteIds = useMemo(() => {
    if (!state || !construction?.buildingId) return [];
    const active = state.cells.filter((cell) => cell.footprint?.buildingId === construction.buildingId && cell.footprint?.state === 'active');
    return state.cells.filter((cell) => cell.canBuild && active.some((other) => touchesCell(cell, other, state.world))).map(cellKey);
  }, [state, construction?.buildingId]);
  const constructionLevel = construction?.buildingId
    ? state?.cells.find((cell) => cell.building?.id === construction.buildingId)?.building?.level ?? 1
    : 1;
  const costs = (constructionDefinition?.levels.find((level) => level.level === constructionLevel)?.costs ?? [])
    .map((cost) => ({ ...cost, amount: cost.amount * (spatial ? area?.count ?? 0 : 1) }));
  const serverNow = now + serverOffsetMs;
  const displayedWood = state
    ? Math.floor(state.village.wood + state.village.woodProductionPerHour * Math.max(0, serverNow - Date.parse(state.serverTime)) / 3_600_000)
    : 0;
  const affordable = costs.every((cost) => cost.amount <= (cost.resourceCode === 'wood'
    ? displayedWood : state?.village.resources.find((resource) => resource.code === cost.resourceCode)?.amount ?? 0));
  const selectionError = area?.error ?? (area && !affordable ? 'Ressources insuffisantes.' : null);

  function clearPreview() {
    touchOrigin.current = null;
    setSelection(null);
    setError(null);
  }

  function exitConstruction() {
    setConstruction(null);
    clearPreview();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || actionInFlight.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest('input, textarea, select')) return;
      if (event.key.toLowerCase() !== 'b' && event.key !== 'Escape') return;
      event.preventDefault();
      setConstruction((current) => event.key === 'Escape' || current ? null : { type: null });
      setMenuAnchor(null);
      setSelection(null);
      touchOrigin.current = null;
      setError(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function runAction(action: () => Promise<TimedVillageState>, successMessage?: string) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setPendingAction(true);
    setError(null);
    try {
      applySnapshot(await action());
      exitConstruction();
      if (successMessage) pushNotification(successMessage);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Action impossible.';
      setError(message);
      pushNotification(message, 'warning');
    } finally {
      actionInFlight.current = false;
      setPendingAction(false);
    }
  }

  function handleSiteSelected(siteId: string, anchor: ScreenAnchor) {
    if (construction) return;
    if (!state?.cells.find((site) => site.id === siteId)?.footprint) return;
    setSelectedSiteId(siteId);
    setMenuAnchor(anchor);
  }

  function closeContextMenu() {
    setSelectedSiteId(null);
    setMenuAnchor(null);
  }

  function handleAreaGesture(first: Cell, last: Cell, tap: boolean) {
    if (!construction?.type || actionInFlight.current) return;
    setError(null);
    if (tap && spatial) {
      setSelection({ first: touchOrigin.current ?? first, last });
      touchOrigin.current = touchOrigin.current ? null : first;
    } else {
      touchOrigin.current = null;
      setSelection({ first: spatial ? first : last, last });
    }
  }

  function confirmConstruction() {
    if (!state || !construction?.type || !area || selectionError || !area.cells.length) return;
    const command = construction;
    const anchor = spatial ? selection!.first : area.cells[0]!;
    void runAction(() => command.buildingId
      ? expandGarden(state.world.slug, state.village.id, command.buildingId, area.cells)
      : buildBuilding(state.world.slug, state.village.id, command.type!, anchor, area.cells),
    command.buildingId ? 'Extension du Jardin lancée' : 'Construction lancée');
  }

  if (loading) return <main className="center-message">Chargement du monde…</main>;
  if (needsLogin) return <main className="center-message"><a href={LOBBY_URL}>Se connecter pour entrer dans ce monde</a></main>;
  if (!state) return <main className="center-message" role="alert">{error ?? 'Village indisponible.'}</main>;

  return (
    <main className="game-shell">
      <Suspense fallback={<div className="center-message">Préparation de la scène…</div>}>
        <VillageScene state={state} highlightedSiteIds={highlightedSiteIds} constructionMode={construction !== null}
          selectingArea={Boolean(construction?.type) && !pendingAction} preview={area} previewInvalid={Boolean(selectionError)}
          onAreaGesture={handleAreaGesture} onSiteSelected={handleSiteSelected} onCameraMoved={closeContextMenu} />
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
      {selectedBuilding && menuAnchor && !construction ? (
        <WorldContextMenu anchor={menuAnchor}>
            <BuildingDetails
              building={selectedBuilding}
              definition={state.buildingTypes.find((definition) => definition.code === selectedBuilding.type)!}
              serverNow={serverNow}
              pendingAction={pendingAction}
              onUpgrade={() => {
                if (selectedBuilding.type === 'garden') {
                  clearPreview();
                  setConstruction({ type: selectedBuilding.type, buildingId: selectedBuilding.id });
                  setMenuAnchor(null);
                }
                else void runAction(
                  () => upgradeBuilding(state.world.slug, state.village.id, selectedBuilding.id),
                  'Amélioration lancée',
                );
              }}
              onHarvest={() => {
                const ready = selectedBuilding.garden ? gardenReady(selectedBuilding.garden, serverNow) : 0;
                void runAction(
                  () => harvestGarden(state.world.slug, state.village.id, selectedBuilding.id),
                  ready > 0 ? `+${formatResource(ready)} carottes récoltées` : 'Récolte effectuée',
                );
              }}
            />
          {error ? <p className="error" role="alert">{error}</p> : null}
        </WorldContextMenu>
      ) : null}
      <div className="construction-toolbar" aria-label="Construction">
        {!construction ? <button type="button" disabled={pendingAction} aria-keyshortcuts="B" onClick={() => {
          closeContextMenu(); clearPreview(); setConstruction({ type: null });
        }}>Construire <kbd>B</kbd></button> : <>
          {!construction.type ? state.buildingTypes.filter((definition) => definition.buildable).map((definition) => (
            <button type="button" key={definition.code} onClick={() => { clearPreview(); setConstruction({ type: definition.code }); }}>
              {definition.displayName}
            </button>
          )) : <>
            <div className="construction-summary" aria-live="polite">
              <strong>{construction.buildingId ? 'Étendre' : 'Construire'} : {constructionDefinition?.displayName}</strong>
              <span>{spatial ? 'Glissez à la souris ; au tactile, touchez deux coins.' : 'Choisissez une case.'}</span>
              {area ? <span>{area.count} case{area.count > 1 ? 's' : ''} · {costs.map((cost) => `${formatResource(cost.amount)} ${state.village.resources.find((resource) => resource.code === cost.resourceCode)?.displayName ?? cost.resourceCode}`).join(', ')}</span> : null}
              {selectionError || error ? <span className="error">{selectionError ?? error}</span> : null}
            </div>
            <button type="button" disabled={pendingAction || !area?.cells.length || Boolean(selectionError)} onClick={confirmConstruction}>Confirmer</button>
            {area ? <button type="button" disabled={pendingAction} onClick={clearPreview}>Recommencer</button> : null}
          </>}
          <button type="button" disabled={pendingAction} onClick={exitConstruction}>Annuler</button>
        </>}
      </div>
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
  const extensionCost = currentLevel?.costs.find((cost) => cost.resourceCode === 'wood')?.amount ?? 0;
  return (
    <div className="building-details">
      <span>{definition.displayName}</span>
      <strong>Niveau {building.level}{building.targetLevel ? ` → ${building.targetLevel}` : ''}</strong>
      {building.type === 'sawmill' ? <p>Production : +{ownProduction}/h</p> : null}
      {garden ? <>
        <p>{garden.activeCellCount} case{garden.activeCellCount > 1 ? 's' : ''} active{garden.activeCellCount > 1 ? 's' : ''}{garden.pendingCellCount ? ` · ${garden.pendingCellCount} en chantier` : ''}</p>
        <p>Prêtes : {formatResource(gardenReady(garden, serverNow))} / {garden.capacity} carottes</p>
        <p>Production : +{garden.productionPerHour}/h</p>
        {garden.expansion ? <p className="construction-status">Extension — {Math.max(0, Math.ceil((Date.parse(garden.expansion.completesAt) - serverNow) / 1_000))} s</p> : null}
        <button type="button" disabled={pendingAction || building.status !== 'completed'} onClick={onHarvest}>Récolter</button>
        <button type="button" disabled={pendingAction || building.status !== 'completed' || garden.expansion !== null} onClick={onUpgrade}>Étendre — {extensionCost} bois / case</button>
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
