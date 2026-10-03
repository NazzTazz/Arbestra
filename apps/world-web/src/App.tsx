import { discoverCatEyes } from './api/client';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DepositDetails, ExtractionWorksiteSelection, Garden, VillageState } from '@arbestra/contracts';
import type { TerrainHandle } from './scene/VillageScene';
import type { TerrainViewMode } from './scene/BabylonVillageScene';

import { ApiError, buildBuilding, changeWorksite, discoverOrRefreshSupplies, expandGarden, feedPopulation, getStoneDepositDetails, getVillage, harvestGardenSelection, previewWorksite, restPopulation, startWorksite, type TimedVillageState, upgradeBuilding } from './api/client';
import { cellKey, previewArea, rectangleCells, touchesCell, type Cell, type CellRange } from './scene/construction-selection';
import { ConstructionPanel, type ConstructionChoice } from './ui/ConstructionPanel';
import { Hud } from './ui/Hud';
import { GardenHarvestQueue, type HarvestIntent } from './ui/garden-harvest-queue';
import { type GameNotification } from './ui/NotificationStack';
import { OracleJournal } from './ui/OracleJournal';
import { useOracleHint } from './ui/useOracleHint';
import { BuildingPanel, DepositPanel, PopulationPanel, WorksitePanel } from './ui/PlayerPanels';
import { type ScreenAnchor, WorldContextMenu } from './ui/WorldContextMenu';
import { SciencePanel } from './ui/SciencePanel';
import { commandScience } from './api/client';

const VillageScene = lazy(() => import('./scene/VillageScene').then((module) => ({ default: module.VillageScene })));
const worldSlug = new URLSearchParams(window.location.search).get('world') ?? 'aube';
const LOBBY_URL = import.meta.env.VITE_LOBBY_URL ?? 'http://localhost:5173';
const populationAnchor = (): ScreenAnchor => ({ x: Math.max(8, window.innerWidth - 300), y: 40 });
const selectionReason: Record<string, string> = { 'not-found': 'introuvable', duplicate: 'en double',
  'resource-mismatch': 'autre ressource', depleted: 'épuisé', 'out-of-range': 'hors de portée',
  protected: 'protégé', interior: 'inaccessible', 'already-assigned': 'déjà affecté', unreachable: 'sans chemin' };

function gardenReady(garden: Garden, serverNow: number): number {
  return garden.plots.reduce((sum, plot) => sum + Math.floor(Math.min(plot.capacity, plot.storedCarrots
    + plot.productionPerHour * Math.max(0, serverNow - Date.parse(plot.productionUpdatedAt)) / 3_600_000)), 0);
}

export function App() {
  const [state, setState] = useState<VillageState | null>(null);
  const stateRef = useRef<VillageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState(false);
  const actionInFlight = useRef(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [showPopulation, setShowPopulation] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [showScience, setShowScience] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<ScreenAnchor | null>(null);
  const [construction, setConstruction] = useState<ConstructionChoice | null>(null);
  const [selection, setSelection] = useState<CellRange | null>(null);
  const touchOrigin = useRef<Cell | null>(null);
  const [notifications, setNotifications] = useState<GameNotification[]>([]);
  const notificationId = useRef(0);
  const notificationTimers = useRef<number[]>([]);
  const [populationCount, setPopulationCount] = useState(1);
  const [depositDetails, setDepositDetails] = useState<DepositDetails | null>(null);
  const terrainRef = useRef<TerrainHandle>(null);
  const [depositLoading, setDepositLoading] = useState(false);
  const [workerCount, setWorkerCount] = useState(1);
  const [woodSelecting, setWoodSelecting] = useState(false);
  const [woodFeatureIds, setWoodFeatureIds] = useState<string[]>([]);
  const [worksiteSelection, setWorksiteSelection] = useState<ExtractionWorksiteSelection | null>(null);
  const [woodMode, setWoodMode] = useState<'cut' | 'clear'>('cut');
  const [showWorksites, setShowWorksites] = useState(false);
  const worksiteIntent = useRef<{ key: string; id: string } | null>(null);
  const woodGestureBase = useRef<string[]>([]);
  const depositRequest = useRef(0);
  const [pendingHarvests, setPendingHarvests] = useState<HarvestIntent[]>([]);
  const [showGardens, setShowGardens] = useState(false);
  const [showTravelPaths, setShowTravelPaths] = useState(false);
  const [terrainView, setTerrainView] = useState<TerrainViewMode>('village');
  const [arrivalActive, setArrivalActive] = useState(false);
  const [oracleCat, setOracleCat] = useState(false);
  const catRequest = useRef(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const populationIntent = useRef<{ action: 'feed' | 'rest'; count: number; id: string } | null>(null);

  const pushNotification = useCallback((message: string, tone: GameNotification['tone'] = 'default') => {
    const id = notificationId.current++;
    setNotifications((current) => [{ id, message, tone }, ...current].slice(0, 3));
    notificationTimers.current.push(window.setTimeout(() => setNotifications((current) => current.filter((item) => item.id !== id)), 3_800));
  }, []);
  useEffect(() => () => notificationTimers.current.forEach(window.clearTimeout), []);
  const markOracleProgress = useOracleHint(state ? `${state.world.id}:${state.village.id}` : null,
    state?.cells.some((cell) => cell.building?.hiddenSuppliesAvailable) ?? false, pendingAction, pushNotification);
  const markOracleProgressRef = useRef(markOracleProgress);
  markOracleProgressRef.current = markOracleProgress;

  const applySnapshot = useCallback((snapshot: TimedVillageState) => {
    const previous = stateRef.current;
    if (previous && snapshot.state.serverTime < previous.serverTime) return;
    if (previous) {
      if (previous.science && snapshot.state.science) {
        const before = previous.science, after = snapshot.state.science;
        if (!before.programs.some(p => p.code === 'astronomy-1' && !['available','blocked'].includes(p.status))
          && after.programs.some(p => p.code === 'astronomy-1' && !['available','blocked'].includes(p.status)))
          pushNotification('Les récits des habitants intriguent les chercheurs : une campagne astronomique commence.');
        for (const program of after.programs) if (program.status === 'acquired' && !before.programs.some(p => p.code === program.code && p.status === 'acquired'))
          pushNotification(program.code === 'astronomy-1' ? 'Le monde est annulaire. Dézoome pour découvrir sa forme.' : `Connaissance acquise : ${program.title}`);
      }
      const priorAccomplishments = new Set(previous.village.accomplishments.map((item) => item.code));
      if (snapshot.state.village.accomplishments.some(item => item.code === 'cat-eyes' && !priorAccomplishments.has(item.code))) setOracleCat(true);
      const delivered = new Map(previous.village.worksites.map(site => [site.id, site.deliveredAmount]));
      for (const site of snapshot.state.village.worksites) {
        const gain = site.deliveredAmount - (delivered.get(site.id) ?? site.deliveredAmount);
        if (gain > 0) pushNotification(`+${gain} ${site.resourceCode === 'wood' ? 'bois' : 'pierre'} livrés`);
      }
      if (snapshot.state.village.accomplishments.some((item) => item.code === 'town-hall-supplies' && !priorAccomplishments.has(item.code)))
        pushNotification("Oracle — Un coffre, 2 000 carottes, et personne n'avait regardé. Admirable.");
      if (snapshot.state.village.accomplishments.some((item) => item.code === 'first-harvest' && !priorAccomplishments.has(item.code)))
        pushNotification('Oracle — Votre première récolte ! Ces carottes-là, vous les avez méritées.');
      const prior = new Map(previous.cells.flatMap((cell) => cell.building ? [[cell.building.id, cell.building] as const] : []));
      if (snapshot.state.village.accomplishments.some(item => item.code === 'first-woodcut' && !priorAccomplishments.has(item.code)))
        pushNotification('Oracle — Du bois pour le village, et un peu plus de ciel entre les branches.');
      for (const cell of snapshot.state.cells) {
        if (cell.building?.status === 'completed' && prior.get(cell.building.id)?.status === 'under-construction') pushNotification('Construction terminée');
      }
      const activeHarvestIds = new Set(snapshot.state.cells.flatMap((cell) => [
        ...(cell.building?.garden?.harvest ? [cell.building.garden.harvest.id] : []),
        ...(cell.building?.garden?.plots.flatMap((plot) => plot.harvest ? [plot.harvest.id] : []) ?? []),
      ]));
      if (previous.cells.some((cell) => cell.building?.garden && (
        cell.building.garden.harvest && !activeHarvestIds.has(cell.building.garden.harvest.id)
        || cell.building.garden.plots.some((plot) => plot.harvest && !activeHarvestIds.has(plot.harvest.id)))))
        pushNotification('Récolte livrée');
    }
    stateRef.current = snapshot.state;
    setState(snapshot.state);
    setServerOffsetMs(snapshot.serverOffsetMs);
  }, [pushNotification]);

  const discoverEyes = useCallback(async () => {
    const current = stateRef.current;
    if (!current || catRequest.current || current.village.accomplishments.some(item => item.code === 'cat-eyes')) return;
    catRequest.current = true;
    try {
      const result = await discoverCatEyes(current.world.slug, current.village.id);
      if (stateRef.current?.village.id !== current.village.id) return;
      applySnapshot(result);
    } catch { /* The scene retries only while a valid observation continues. */ }
    finally { catRequest.current = false; }
  }, [applySnapshot]);

  const harvestQueue = useMemo(() => new GardenHarvestQueue({
    send: (intent) => harvestGardenSelection(intent.worldSlug, intent.villageId, intent.targets.map(({cellX,cellY})=>({cellX,cellY})), intent.commandId),
    accepted: (snapshot) => { applySnapshot(snapshot); markOracleProgressRef.current(); },
    warning: (message) => pushNotification(message, 'warning'),
    changed: setPendingHarvests,
  }), [applySnapshot, pushNotification]);
  const pendingHarvestCells = useMemo(() => pendingHarvests.map(({ cellX, cellY }) => ({ cellX, cellY })), [pendingHarvests]);
  const pendingHarvestKeys = useMemo(() => new Set(pendingHarvestCells.map(cellKey)), [pendingHarvestCells]);
  const uncertainHarvests = pendingHarvests.some((intent) => intent.status === 'uncertain');
  useEffect(() => {
    if (!uncertainHarvests) return;
    const retry = () => harvestQueue.retry();
    const timer = window.setInterval(retry, 2_000);
    window.addEventListener('online', retry); window.addEventListener('focus', retry);
    return () => { window.clearInterval(timer); window.removeEventListener('online', retry); window.removeEventListener('focus', retry); };
  }, [uncertainHarvests, harvestQueue]);

  const refresh = useCallback(async () => {
    if (actionInFlight.current) return;
    try { applySnapshot(await getVillage(worldSlug, stateRef.current?.village.id)); } catch { /* Background refresh is best effort. */ }
  }, [applySnapshot]);

  useEffect(() => { void getVillage(worldSlug).then(applySnapshot).catch((reason) => {
    if (reason instanceof ApiError && reason.status === 401) setNeedsLogin(true);
    else setError(reason instanceof Error ? reason.message : 'Chargement impossible.');
  }).finally(() => setLoading(false)); }, [applySnapshot]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);

  const hasFastTransition = state?.cells.some((cell) => cell.building?.status === 'under-construction' || cell.building?.garden?.expansion
    || cell.building?.garden?.harvest || cell.building?.garden?.plots.some((plot) => plot.harvest)) ?? false;
  const hasGarden = state?.cells.some((cell) => Boolean(cell.building?.garden)) ?? false;
  const hasExtraction = (state?.village.extractions.length ?? 0) > 0 || (state?.village.worksites.some(site => site.status === 'running') ?? false);
  const hasRestingPopulation = (state?.village.population.resting ?? 0) > 0;
  useEffect(() => {
    if (!hasFastTransition && !hasExtraction && !hasRestingPopulation && !selectedFeatureId && !hasGarden && !state?.science?.universities.length) return;
    const timer = window.setInterval(() => void refresh(), hasFastTransition ? 500 : hasExtraction || selectedFeatureId ? 2_000 : 10_000);
    return () => window.clearInterval(timer);
  }, [hasFastTransition, hasExtraction, hasRestingPopulation, selectedFeatureId, hasGarden, state?.science?.universities.length, refresh]);
  useEffect(() => { const visible = () => { if (document.visibilityState === 'visible') void refresh(); }; document.addEventListener('visibilitychange', visible); window.addEventListener('focus', visible); return () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); }; }, [refresh]);

  const loadDeposit = useCallback(async (featureId: string) => {
    if (!stateRef.current) return;
    const request = ++depositRequest.current;
    setDepositLoading(true);
    try {
      const details = await getStoneDepositDetails(worldSlug, stateRef.current.village.id, featureId);
      terrainRef.current?.acceptDeposit(details.deposit);
      if (request === depositRequest.current) setDepositDetails(details);
    } catch (reason) { if (request === depositRequest.current) setError(reason instanceof Error ? reason.message : 'Inspection impossible.'); }
    finally { if (request === depositRequest.current) setDepositLoading(false); }
  }, []);
  useEffect(() => { if (selectedFeatureId) void loadDeposit(selectedFeatureId); }, [selectedFeatureId, loadDeposit]);

  const selectedSite = useMemo(() => state?.cells.find((cell) => cell.id === selectedSiteId) ?? null, [selectedSiteId, state]);
  const selectedBuilding = useMemo(() => selectedSite?.building ?? (selectedSite?.footprint ? state?.cells.find((cell) => cell.building?.id === selectedSite.footprint?.buildingId)?.building ?? null : null), [selectedSite, state]);
  const gardenSites = useMemo(() => state?.cells.filter((cell) => cell.building?.garden)
    .sort((a, b) => a.cellX - b.cellX || a.cellY - b.cellY) ?? [], [state]);
  useEffect(() => {
    if (showGardens && gardenSites.length === 1) { setSelectedSiteId(gardenSites[0]!.id); setShowGardens(false); }
  }, [showGardens, gardenSites]);
  const definition = state?.buildingTypes.find((item) => item.code === construction?.type);
  const spatial = definition?.progressionMode === 'spatial';
  const area = useMemo(() => state && selection ? previewArea(state, construction?.type === 'university'
    ? { first: { cellX: selection.last.cellX - 2, cellY: selection.last.cellY - 2 }, last: { cellX: selection.last.cellX + 2, cellY: selection.last.cellY + 3 } }
    : selection, spatial || construction?.type === 'university', construction?.buildingId) : null, [state, selection, spatial, construction?.buildingId, construction?.type]);
  const woodFeatures = useMemo(() => state?.region.features.filter(feature => feature.type === 'woodland') ?? [], [state]);
  const woodPreview = useMemo(() => {
    const chosen = new Set(woodFeatureIds);
    const cells = woodFeatures.filter(feature => chosen.has(feature.id)).map(feature => ({ cellX: feature.cellX, cellY: feature.cellY }));
    return { cells, count: cells.length, error: cells.length > 64 ? '64 bosquets maximum.' : null };
  }, [woodFeatures, woodFeatureIds]);
  useEffect(() => {
    if (!woodSelecting || !state || !woodFeatureIds.length || woodFeatureIds.length > 64) { setWorksiteSelection(null); return; }
    let cancelled = false;
    setWorksiteSelection(null);
    const timer = window.setTimeout(() => {
      void previewWorksite(worldSlug, state.village.id, { commandId: crypto.randomUUID(), mode: woodMode,
        workerCap: workerCount, featureIds: woodFeatureIds }).then(preview => {
        if (!cancelled) setWorksiteSelection(preview);
      }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Aperçu indisponible.'); });
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [woodSelecting, state?.village.id, woodFeatureIds, woodMode, workerCount]);
  const highlightedSiteIds = useMemo(() => {
    if (!state || !construction?.buildingId) return [];
    const active = state.cells.filter((cell) => cell.footprint?.buildingId === construction.buildingId && cell.footprint?.state === 'active');
    return state.cells.filter((cell) => cell.canBuild && active.some((other) => touchesCell(cell, other, state.world))).map(cellKey);
  }, [state, construction?.buildingId]);
  const level = construction?.buildingId ? state?.cells.find((cell) => cell.building?.id === construction.buildingId)?.building?.level ?? 1 : 1;
  const costs = (definition?.levels.find((item) => item.level === level)?.costs ?? []).map((cost) => ({ ...cost, amount: cost.amount * (spatial ? area?.count ?? 0 : 1) }));
  const serverNow = now + serverOffsetMs;
  const displayedWood = state ? Math.floor(state.village.wood + state.village.woodProductionPerHour * Math.max(0, serverNow - Date.parse(state.serverTime)) / 3_600_000) : 0;
  const affordable = costs.every((cost) => cost.amount <= (cost.resourceCode === 'wood' ? displayedWood : state?.village.resources.find((resource) => resource.code === cost.resourceCode)?.amount ?? 0));
  const selectionError = area?.error ?? (area && !affordable ? 'Ressources insuffisantes.' : null);
  const existingGardenCells = construction?.buildingId ? state?.cells.filter((cell) => cell.footprint?.buildingId === construction.buildingId && cell.footprint?.state === 'active').length ?? 0 : 0;
  const gardenWorkerNeed = spatial && area ? existingGardenCells + area.count : null;

  function closePanels() { depositRequest.current++; setSelectedSiteId(null); setSelectedFeatureId(null); setDepositDetails(null); setShowPopulation(false); setShowJournal(false); setShowGardens(false); setMenuAnchor(null); }
  function clearPreview() { touchOrigin.current = null; setSelection(null); setError(null); }
  function exitConstruction() { setConstruction(null); clearPreview(); }
  async function runAction(action: () => Promise<TimedVillageState>, success?: string, exit = false): Promise<boolean> {
    if (actionInFlight.current) return false;
    actionInFlight.current = true; setPendingAction(true); setError(null);
    try { applySnapshot(await action()); markOracleProgress(); if (exit) exitConstruction(); if (success) pushNotification(success); return true; }
    catch (reason) { const message = reason instanceof Error ? reason.message : 'Action impossible.'; setError(message); pushNotification(message, 'warning'); return false; }
    finally { actionInFlight.current = false; setPendingAction(false); }
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || actionInFlight.current) return; const target = event.target as HTMLElement | null; if (target?.isContentEditable || target?.closest('input, textarea, select')) return; if (event.key.toLowerCase() !== 'b' && event.key !== 'Escape') return; if (terrainView !== 'village' && event.key.toLowerCase() === 'b') return; event.preventDefault(); setConstruction((current) => event.key === 'Escape' || current ? null : { type: null }); closePanels(); clearPreview(); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [terrainView]);

  function handleAreaGesture(first: Cell, last: Cell, tap: boolean) {
    if (terrainView !== 'village' || actionInFlight.current) return;
    if (woodSelecting && state) {
      if (tap) {
        const feature = woodFeatures.find(item => item.cellX === last.cellX && item.cellY === last.cellY);
        if (feature) setWoodFeatureIds(woodGestureBase.current.includes(feature.id)
          ? woodGestureBase.current.filter(id => id !== feature.id) : [...woodGestureBase.current, feature.id]);
      } else {
        if (first.cellX === last.cellX && first.cellY === last.cellY) woodGestureBase.current = woodFeatureIds;
        const rectangle = rectangleCells({ first, last }, state.world, true);
        if (!rectangle.error) {
          const cells = new Set(rectangle.cells.map(cellKey));
          setWoodFeatureIds(woodFeatures.filter(feature => cells.has(cellKey(feature))).map(feature => feature.id));
        }
      }
      return;
    }
    if (!construction?.type) return;
    setError(null);
    if (tap && spatial) { setSelection({ first: touchOrigin.current ?? first, last }); touchOrigin.current = touchOrigin.current ? null : first; }
    else { touchOrigin.current = null; setSelection({ first: spatial ? first : last, last }); }
  }
  function confirmConstruction() { if (terrainView !== 'village' || !state || !construction?.type || !area || selectionError || !area.cells.length) return; const command = construction; const anchor = command.type === 'university' ? selection!.last : spatial ? selection!.first : area.cells[0]!; void runAction(() => command.buildingId ? expandGarden(state.world.slug, state.village.id, command.buildingId, area.cells) : buildBuilding(state.world.slug, state.village.id, command.type!, anchor, area.cells), command.buildingId ? 'Extension du Jardin lancée' : 'Construction lancée', true); }
  function queuePlotHarvest(cell: Cell | null, newGesture = false, commit = false) {
    if (!cell) { if(newGesture) harvestQueue.cancelGesture(); else harvestQueue.finishGesture(); return; }
    if (terrainView !== 'village') return;
    const current = stateRef.current;
    if (!current) return;
    const site = current.cells.find((item) => item.cellX === cell.cellX && item.cellY === cell.cellY);
    const building = site?.footprint ? current.cells.find((item) => item.building?.id === site.footprint?.buildingId)?.building : site?.building;
    const plot = building?.garden?.plots.find((item) => item.cellX === cell.cellX && item.cellY === cell.cellY);
    const target = { ...cell, worldSlug, villageId: current.village.id, buildingId: building?.id ?? '' };
    // Resolve the old receipt even if a refresh already shows its departure
    // or a different canonical Garden after fusion.
    if (!harvestQueue.has(target) && (!building?.garden || building.garden.harvest || !plot || plot.harvest || plot.storedCarrots < 1)) return;
    harvestQueue.enqueue(target, newGesture);
    if(commit) harvestQueue.finishGesture();
  }
  function runPopulation(action: 'feed' | 'rest') { if (!state) return; const intent = populationIntent.current?.action === action && populationIntent.current.count === populationCount ? populationIntent.current : { action, count: populationCount, id: crypto.randomUUID() }; populationIntent.current = intent; void runAction(() => action === 'feed' ? feedPopulation(worldSlug, state.village.id, intent.count, intent.id) : restPopulation(worldSlug, state.village.id, intent.count, intent.id), action === 'feed' ? `${intent.count} habitant(s) ont mangé` : `${intent.count} habitant(s) au repos`).then((ok) => { if (ok) populationIntent.current = null; }); }
  async function discoverSupplies(buildingId: string) {
    const currentState = stateRef.current;
    if (actionInFlight.current || !currentState) return;
    actionInFlight.current = true; setPendingAction(true); setError(null);
    try {
      const result = await discoverOrRefreshSupplies(worldSlug, currentState.village.id, buildingId);
      applySnapshot(result.snapshot);
      markOracleProgress();
      if (result.alreadyDiscovered) pushNotification('Les réserves avaient déjà été fouillées');
    }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Fouille impossible.';
      setError(message); pushNotification(message, 'warning');
    } finally { actionInFlight.current = false; setPendingAction(false); }
  }
  function launchWorksite(mode: 'extract' | 'cut' | 'clear', featureIds: string[]) {
    if (!state || !featureIds.length || featureIds.length > 64) return;
    const key = `${mode}:${workerCount}:${featureIds.join(',')}`;
    if (!worksiteIntent.current || worksiteIntent.current.key !== key)
      worksiteIntent.current = { key, id: crypto.randomUUID() };
    const commandId = worksiteIntent.current.id;
    void runAction(() => startWorksite(worldSlug, state.village.id, { commandId, mode, workerCap: workerCount, featureIds }),
      'Chantier lancé').then(ok => {
      if (ok) { worksiteIntent.current = null; setWoodSelecting(false); setWoodFeatureIds([]); closePanels(); setShowWorksites(true); }
    });
  }

  function commandWorksite(id: string, action: 'pause' | 'resume' | 'stop' | 'set-cap', cap?: number) {
    if (!state) return;
    void runAction(() => changeWorksite(worldSlug, state.village.id, id,
      { commandId: crypto.randomUUID(), action, ...(cap === undefined ? {} : { workerCap: cap }) }));
  }

  if (loading) return <main className="center-message">Chargement du monde…</main>;
  if (needsLogin) return <main className="center-message"><a href={LOBBY_URL}>Se connecter pour entrer dans ce monde</a></main>;
  if (!state) return <main className="center-message" role="alert">{error ?? 'Village indisponible.'}</main>;
  return <main className="game-shell">
    <Suspense fallback={<div className="center-message">L'oracle se rhabille…</div>}><VillageScene onEyesFound={() => void discoverEyes()} onArrivalActive={setArrivalActive} state={state} serverOffsetMs={serverOffsetMs} terrainRef={terrainRef} pendingHarvestCells={pendingHarvestCells} highlightedSiteIds={highlightedSiteIds} constructionMode={construction !== null && terrainView === 'village'} showTravelPaths={showTravelPaths} selectedRouteId={selectedRouteId} selectingArea={(Boolean(construction?.type) || woodSelecting) && !pendingAction && terrainView === 'village'} preview={woodSelecting ? woodPreview : area} previewInvalid={woodSelecting ? Boolean(woodPreview.error) : Boolean(selectionError)} onAreaGesture={handleAreaGesture} onGardenHarvest={queuePlotHarvest} onSiteSelected={(id, anchor) => { if (!construction && !woodSelecting) { closePanels(); setSelectedSiteId(id); setMenuAnchor(anchor); } }} onFeatureSelected={(id, anchor) => { if (!construction && !woodSelecting) { closePanels(); setWorkerCount(1); setSelectedFeatureId(id); setMenuAnchor(anchor); } }} onCameraMoved={closePanels} onViewChanged={mode => { setTerrainView(mode); harvestQueue.cancelGesture(); if (mode !== 'village') { setConstruction(null); setWoodSelecting(false); clearPreview(); closePanels(); } }} /></Suspense>
    {oracleCat && !arrivalActive && <aside className="oracle-cat-visit" role="dialog" aria-label="L'Oracle">
      <strong>L'Oracle</strong><p>Je cherche mon chat… Vous ne l'auriez pas aperçu ?</p>
      <button type="button" onClick={() => setOracleCat(false)}>Fermer</button>
    </aside>}
    <Hud state={state} displayedWood={displayedWood} notifications={notifications} onPopulation={() => { closePanels(); setShowPopulation(true); setMenuAnchor(populationAnchor()); }} onJournal={() => { closePanels(); setShowJournal(true); setMenuAnchor(populationAnchor()); }} />
    {state.science && <button className="science-access" type="button" onClick={() => setShowScience(value => !value)}>Arbre des connaissances</button>}
    {showScience && state.science && <SciencePanel target={selectedFeatureId && depositDetails ? depositDetails.deposit : {cellX:state.village.anchorCellX,cellY:state.village.anchorCellY}} science={state.science} villageId={state.village.id} buildingId={selectedBuilding?.type === 'university' ? selectedBuilding.id : null} pending={pendingAction} serverNow={serverNow} error={error} onClose={() => setShowScience(false)} onCommand={command => { void runAction(() => commandScience(worldSlug, state.village.id, command), 'Université · commande prise en compte'); }} />}
    <div className="travel-debug"><button type="button" aria-pressed={showTravelPaths} onClick={() => setShowTravelPaths((value) => !value)}>Chemins · debug</button>{showTravelPaths ? <div className="travel-debug-details"><label>Itinéraire <select value={selectedRouteId ?? ''} onChange={(event) => setSelectedRouteId(event.target.value || null)}><option value="">Tous ({state.travelRoutes.length})</option>{state.travelRoutes.map((route) => <option key={route.id} value={route.id}>{route.kind} · {route.destination.cellX}, {route.destination.cellY} · {route.cells.length - 1} s / trajet</option>)}</select></label><small>Transport aller et retour : 1 s par case. Travail sur place : durée propre à la tâche.</small></div> : null}</div>
    {gardenSites.length && terrainView === 'village' ? <button type="button" className="garden-access" onClick={() => {
      closePanels(); if (gardenSites.length === 1) setSelectedSiteId(gardenSites[0]!.id); else setShowGardens(true);
      setMenuAnchor(populationAnchor());
    }}>Gérer les Jardins</button> : null}
    {terrainView === 'village' && <button type="button" className="worksite-access" onClick={() => { setShowWorksites(value => !value); setWoodSelecting(false); closePanels(); }}>Chantiers · {state.village.worksites.filter(site => site.status === 'running' || site.status === 'paused').length}</button>}
    {showWorksites && terrainView === 'village' && <WorksitePanel worksites={state.village.worksites} pending={pendingAction} onAction={commandWorksite} />}
    {woodSelecting && terrainView === 'village' && <div className="wood-selection-panel" role="dialog" aria-label="Zone bois"><strong>Zone bois · {woodFeatureIds.length} bosquet(s)</strong>
      <p>Glisser pour tracer un rectangle, puis cliquer les bosquets à ajouter ou retirer.</p>
      {worksiteSelection && <p>{worksiteSelection.included.length} retenu(s) · {worksiteSelection.excluded.length} exclu(s){worksiteSelection.excluded.length ? ` (${[...new Set(worksiteSelection.excluded.map(item => selectionReason[item.reason] ?? item.reason))].join(', ')})` : ''}</p>}
      <label>Objectif <select value={woodMode} onChange={event => setWoodMode(event.target.value as 'cut' | 'clear')}><option value="cut">Couper jusqu’à 10 %</option><option value="clear">Défricher durablement</option></select></label>
      <label>Habitants au maximum <input type="range" min="1" max="10" value={workerCount} onChange={event => setWorkerCount(Number(event.target.value))} /> {workerCount}</label>
      {woodPreview.error && <p className="error">{woodPreview.error}</p>}
      <button type="button" disabled={pendingAction || !worksiteSelection?.included.length || Boolean(woodPreview.error)} onClick={() => launchWorksite(woodMode, woodFeatureIds)}>Lancer le chantier</button>
      <button type="button" onClick={() => { setWoodSelecting(false); setWoodFeatureIds([]); }}>Annuler</button></div>}
    {pendingHarvests.length ? <div className="harvest-pending" role="status">{pendingHarvests.length} parcelle(s) {uncertainHarvests ? 'à confirmer' : pendingHarvests.some(p=>p.status==='selecting') ? 'sélectionnées — relâcher pour récolter' : 'en attente'}{uncertainHarvests ? <button type="button" onClick={() => harvestQueue.retry()}>Réessayer</button> : null}</div> : null}
    {menuAnchor && showGardens ? <WorldContextMenu anchor={menuAnchor}><div><strong>Choisir un Jardin</strong>{gardenSites.map((site, index) => <button type="button" key={site.id} onClick={() => { setShowGardens(false); setSelectedSiteId(site.id); }}>Jardin {index + 1} · {site.cellX}, {site.cellY} · {site.building!.garden!.activeCellCount} parcelle(s)</button>)}</div></WorldContextMenu> : null}
    {menuAnchor && showPopulation ? <WorldContextMenu anchor={menuAnchor}><PopulationPanel population={state.village.population} pending={pendingAction} count={populationCount} onCount={(count) => setPopulationCount(Math.max(1, Math.min(state.village.population.available || 1, count || 1)))} onFeed={() => runPopulation('feed')} onRest={() => runPopulation('rest')} />{error ? <p className="error">{error}</p> : null}</WorldContextMenu> : null}
    {menuAnchor && showJournal ? <WorldContextMenu anchor={menuAnchor}><OracleJournal accomplishments={state.village.accomplishments} /></WorldContextMenu> : null}
    {menuAnchor && selectedBuilding ? <WorldContextMenu anchor={menuAnchor}><BuildingPanel building={selectedBuilding} definition={state.buildingTypes.find((item) => item.code === selectedBuilding.type)!} serverNow={serverNow} pending={pendingAction} pendingHarvestKeys={pendingHarvestKeys} readyCarrots={selectedBuilding.garden ? gardenReady(selectedBuilding.garden, serverNow) : 0} availableWorkers={state.village.population.available} onUpgrade={() => selectedBuilding.type === 'garden' ? (clearPreview(), setConstruction({ type: 'garden', buildingId: selectedBuilding.id }), setMenuAnchor(null)) : void runAction(() => upgradeBuilding(worldSlug, state.village.id, selectedBuilding.id), 'Amélioration lancée')} onHarvest={(plot) => queuePlotHarvest(plot, true, true)} onDiscover={() => void discoverSupplies(selectedBuilding.id)} />{error ? <p className="error">{error}</p> : null}</WorldContextMenu> : null}
    {menuAnchor && selectedFeatureId ? <WorldContextMenu anchor={menuAnchor}><DepositPanel details={depositDetails} loading={depositLoading} pending={pendingAction} workerCount={workerCount} onWorkerCount={setWorkerCount} onStart={mode => launchWorksite(mode, [selectedFeatureId])} onSelectZone={() => { setWoodFeatureIds([selectedFeatureId]); setWoodSelecting(true); setConstruction(null); closePanels(); }} />{error ? <p className="error">{error}</p> : null}</WorldContextMenu> : null}
    {terrainView === 'village' ? <ConstructionPanel construction={construction} definitions={state.buildingTypes} area={area} costs={costs} error={selectionError ?? error} pending={pendingAction} population={state.village.population} gardenWorkerNeed={gardenWorkerNeed} onOpen={() => { closePanels(); clearPreview(); setConstruction({ type: null }); }} onChoose={(type) => { clearPreview(); setConstruction({ type }); }} onConfirm={confirmConstruction} onRestart={clearPreview} onCancel={exitConstruction} /> : null}
  </main>;
}
