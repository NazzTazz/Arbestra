import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DepositDetails, Garden, VillageState } from '@arbestra/contracts';

import { ApiError, buildBuilding, discoverOrRefreshSupplies, expandGarden, feedPopulation, getStoneDepositDetails, getVillage, harvestGarden, restPopulation, startStoneExtraction, type TimedVillageState, upgradeBuilding } from './api/client';
import { cellKey, previewArea, touchesCell, type Cell, type CellRange } from './scene/construction-selection';
import { ConstructionPanel, type ConstructionChoice } from './ui/ConstructionPanel';
import { Hud } from './ui/Hud';
import { ExtractionIntents } from './ui/extraction-intents';
import { type GameNotification } from './ui/NotificationStack';
import { OracleJournal } from './ui/OracleJournal';
import { useOracleHint } from './ui/useOracleHint';
import { BuildingPanel, DepositPanel, PopulationPanel } from './ui/PlayerPanels';
import { type ScreenAnchor, WorldContextMenu } from './ui/WorldContextMenu';

const VillageScene = lazy(() => import('./scene/VillageScene').then((module) => ({ default: module.VillageScene })));
const worldSlug = new URLSearchParams(window.location.search).get('world') ?? 'aube';
const LOBBY_URL = import.meta.env.VITE_LOBBY_URL ?? 'http://localhost:5173';
const populationAnchor = (): ScreenAnchor => ({ x: Math.max(8, window.innerWidth - 300), y: 40 });

function gardenReady(garden: Garden, serverNow: number): number {
  const elapsedHours = Math.max(0, serverNow - Date.parse(garden.productionUpdatedAt)) / 3_600_000;
  return Math.floor(Math.min(garden.capacity, garden.storedCarrots + garden.productionPerHour * elapsedHours));
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
  const [menuAnchor, setMenuAnchor] = useState<ScreenAnchor | null>(null);
  const [construction, setConstruction] = useState<ConstructionChoice | null>(null);
  const [selection, setSelection] = useState<CellRange | null>(null);
  const touchOrigin = useRef<Cell | null>(null);
  const [notifications, setNotifications] = useState<GameNotification[]>([]);
  const notificationId = useRef(0);
  const notificationTimers = useRef<number[]>([]);
  const [populationCount, setPopulationCount] = useState(1);
  const [depositDetails, setDepositDetails] = useState<DepositDetails | null>(null);
  const [depositLoading, setDepositLoading] = useState(false);
  const [workerCount, setWorkerCount] = useState(1);
  const depositRequest = useRef(0);
  const harvestIntents = useRef(new Map<string, string>());
  const populationIntent = useRef<{ action: 'feed' | 'rest'; count: number; id: string } | null>(null);
  const extractionIntents = useRef(new ExtractionIntents());

  const pushNotification = useCallback((message: string, tone: GameNotification['tone'] = 'default') => {
    const id = notificationId.current++;
    setNotifications((current) => [{ id, message, tone }, ...current].slice(0, 3));
    notificationTimers.current.push(window.setTimeout(() => setNotifications((current) => current.filter((item) => item.id !== id)), 3_800));
  }, []);
  useEffect(() => () => notificationTimers.current.forEach(window.clearTimeout), []);
  const markOracleProgress = useOracleHint(state ? `${state.world.id}:${state.village.id}` : null,
    state?.cells.some((cell) => cell.building?.hiddenSuppliesAvailable) ?? false, pendingAction, pushNotification);

  const applySnapshot = useCallback((snapshot: TimedVillageState) => {
    const previous = stateRef.current;
    if (previous && snapshot.state.serverTime < previous.serverTime) return;
    if (previous) {
      const priorAccomplishments = new Set(previous.village.accomplishments.map((item) => item.code));
      if (snapshot.state.village.accomplishments.some((item) => item.code === 'town-hall-supplies' && !priorAccomplishments.has(item.code)))
        pushNotification("Oracle — Un coffre, 2 000 carottes, et personne n'avait regardé. Admirable.");
      const prior = new Map(previous.cells.flatMap((cell) => cell.building ? [[cell.building.id, cell.building] as const] : []));
      for (const cell of snapshot.state.cells) {
        if (cell.building?.status === 'completed' && prior.get(cell.building.id)?.status === 'under-construction') pushNotification('Construction terminée');
        if (prior.get(cell.building?.id ?? '')?.garden?.harvest && cell.building?.garden && !cell.building.garden.harvest) pushNotification('Récolte livrée');
      }
    }
    stateRef.current = snapshot.state;
    setState(snapshot.state);
    setServerOffsetMs(snapshot.serverOffsetMs);
  }, [pushNotification]);

  const refresh = useCallback(async () => {
    if (actionInFlight.current) return;
    try { applySnapshot(await getVillage(worldSlug)); } catch { /* Background refresh is best effort. */ }
  }, [applySnapshot]);

  useEffect(() => { void getVillage(worldSlug).then(applySnapshot).catch((reason) => {
    if (reason instanceof ApiError && reason.status === 401) setNeedsLogin(true);
    else setError(reason instanceof Error ? reason.message : 'Chargement impossible.');
  }).finally(() => setLoading(false)); }, [applySnapshot]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);

  const hasFastTransition = state?.cells.some((cell) => cell.building?.status === 'under-construction' || cell.building?.garden?.expansion || cell.building?.garden?.harvest) ?? false;
  const hasExtraction = (state?.village.extractions.length ?? 0) > 0;
  const hasRestingPopulation = (state?.village.population.resting ?? 0) > 0;
  useEffect(() => {
    if (!hasFastTransition && !hasExtraction && !hasRestingPopulation && !selectedFeatureId) return;
    const timer = window.setInterval(() => void refresh(), hasFastTransition ? 500 : hasExtraction || selectedFeatureId ? 2_000 : 10_000);
    return () => window.clearInterval(timer);
  }, [hasFastTransition, hasExtraction, hasRestingPopulation, selectedFeatureId, refresh]);
  useEffect(() => { const visible = () => { if (document.visibilityState === 'visible') void refresh(); }; document.addEventListener('visibilitychange', visible); window.addEventListener('focus', visible); return () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); }; }, [refresh]);

  const loadDeposit = useCallback(async (featureId: string) => {
    if (!stateRef.current) return;
    const request = ++depositRequest.current;
    setDepositLoading(true);
    try {
      const details = await getStoneDepositDetails(worldSlug, stateRef.current.village.id, featureId);
      if (request === depositRequest.current) setDepositDetails(details);
    } catch (reason) { if (request === depositRequest.current) setError(reason instanceof Error ? reason.message : 'Inspection impossible.'); }
    finally { if (request === depositRequest.current) setDepositLoading(false); }
  }, []);
  useEffect(() => { if (selectedFeatureId) void loadDeposit(selectedFeatureId); }, [selectedFeatureId, state?.serverTime, loadDeposit]);

  const selectedSite = useMemo(() => state?.cells.find((cell) => cell.id === selectedSiteId) ?? null, [selectedSiteId, state]);
  const selectedBuilding = useMemo(() => selectedSite?.building ?? (selectedSite?.footprint ? state?.cells.find((cell) => cell.building?.id === selectedSite.footprint?.buildingId)?.building ?? null : null), [selectedSite, state]);
  const definition = state?.buildingTypes.find((item) => item.code === construction?.type);
  const spatial = definition?.progressionMode === 'spatial';
  const area = useMemo(() => state && selection ? previewArea(state, selection, spatial, construction?.buildingId) : null, [state, selection, spatial, construction?.buildingId]);
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

  function closePanels() { depositRequest.current++; setSelectedSiteId(null); setSelectedFeatureId(null); setDepositDetails(null); setShowPopulation(false); setShowJournal(false); setMenuAnchor(null); }
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
    const key = (event: KeyboardEvent) => { if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || actionInFlight.current) return; const target = event.target as HTMLElement | null; if (target?.isContentEditable || target?.closest('input, textarea, select')) return; if (event.key.toLowerCase() !== 'b' && event.key !== 'Escape') return; event.preventDefault(); setConstruction((current) => event.key === 'Escape' || current ? null : { type: null }); closePanels(); clearPreview(); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);

  function handleAreaGesture(first: Cell, last: Cell, tap: boolean) { if (!construction?.type || actionInFlight.current) return; setError(null); if (tap && spatial) { setSelection({ first: touchOrigin.current ?? first, last }); touchOrigin.current = touchOrigin.current ? null : first; } else { touchOrigin.current = null; setSelection({ first: spatial ? first : last, last }); } }
  function confirmConstruction() { if (!state || !construction?.type || !area || selectionError || !area.cells.length) return; const command = construction; const anchor = spatial ? selection!.first : area.cells[0]!; void runAction(() => command.buildingId ? expandGarden(state.world.slug, state.village.id, command.buildingId, area.cells) : buildBuilding(state.world.slug, state.village.id, command.type!, anchor, area.cells), command.buildingId ? 'Extension du Jardin lancée' : 'Construction lancée', true); }
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
  async function startExtraction() {
    if (!state || !selectedFeatureId || actionInFlight.current) return;
    const featureId = selectedFeatureId;
    const request = depositRequest.current;
    const intent = extractionIntents.current.begin(featureId, workerCount);
    setWorkerCount(intent.workerCount);
    actionInFlight.current = true; setPendingAction(true); setError(null);
    try {
      const result = await startStoneExtraction(worldSlug, state.village.id, featureId, intent.workerCount, intent.id);
      applySnapshot({ state: result.villageState, serverOffsetMs: result.serverOffsetMs });
      markOracleProgress();
      if (request === depositRequest.current) setDepositDetails((current) => current?.deposit.featureId === featureId ? { ...current, deposit: result.deposit } : current);
      extractionIntents.current.complete(featureId);
      pushNotification(`Extraction lancée : ${result.extraction.reservedAmount} pierre`);
    } catch (reason) {
      // A definite server refusal did not accept this command; allow a new choice.
      if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500) extractionIntents.current.complete(featureId);
      const message = reason instanceof Error ? reason.message : 'Extraction impossible.';
      setError(message); pushNotification(message, 'warning');
    } finally { actionInFlight.current = false; setPendingAction(false); }
  }

  if (loading) return <main className="center-message">Chargement du monde…</main>;
  if (needsLogin) return <main className="center-message"><a href={LOBBY_URL}>Se connecter pour entrer dans ce monde</a></main>;
  if (!state) return <main className="center-message" role="alert">{error ?? 'Village indisponible.'}</main>;
  return <main className="game-shell">
    <Suspense fallback={<div className="center-message">L'oracle se rhabille…</div>}><VillageScene state={state} highlightedSiteIds={highlightedSiteIds} constructionMode={construction !== null} selectingArea={Boolean(construction?.type) && !pendingAction} preview={area} previewInvalid={Boolean(selectionError)} onAreaGesture={handleAreaGesture} onSiteSelected={(id, anchor) => { if (!construction) { closePanels(); setSelectedSiteId(id); setMenuAnchor(anchor); } }} onFeatureSelected={(id, anchor) => { if (!construction) { closePanels(); setWorkerCount(extractionIntents.current.get(id)?.workerCount ?? 1); setSelectedFeatureId(id); setMenuAnchor(anchor); } }} onCameraMoved={closePanels} /></Suspense>
    <Hud state={state} displayedWood={displayedWood} notifications={notifications} onPopulation={() => { closePanels(); setShowPopulation(true); setMenuAnchor(populationAnchor()); }} onJournal={() => { closePanels(); setShowJournal(true); setMenuAnchor(populationAnchor()); }} />
    {menuAnchor && showPopulation ? <WorldContextMenu anchor={menuAnchor}><PopulationPanel population={state.village.population} pending={pendingAction} count={populationCount} onCount={(count) => setPopulationCount(Math.max(1, Math.min(state.village.population.available || 1, count || 1)))} onFeed={() => runPopulation('feed')} onRest={() => runPopulation('rest')} />{error ? <p className="error">{error}</p> : null}</WorldContextMenu> : null}
    {menuAnchor && showJournal ? <WorldContextMenu anchor={menuAnchor}><OracleJournal accomplishments={state.village.accomplishments} /></WorldContextMenu> : null}
    {menuAnchor && selectedBuilding ? <WorldContextMenu anchor={menuAnchor}><BuildingPanel building={selectedBuilding} definition={state.buildingTypes.find((item) => item.code === selectedBuilding.type)!} serverNow={serverNow} pending={pendingAction} readyCarrots={selectedBuilding.garden ? gardenReady(selectedBuilding.garden, serverNow) : 0} availableWorkers={state.village.population.available} onUpgrade={() => selectedBuilding.type === 'garden' ? (clearPreview(), setConstruction({ type: 'garden', buildingId: selectedBuilding.id }), setMenuAnchor(null)) : void runAction(() => upgradeBuilding(worldSlug, state.village.id, selectedBuilding.id), 'Amélioration lancée')} onHarvest={() => { const id = harvestIntents.current.get(selectedBuilding.id) ?? crypto.randomUUID(); harvestIntents.current.set(selectedBuilding.id, id); void runAction(() => harvestGarden(worldSlug, state.village.id, selectedBuilding.id, id), 'Récolte lancée : retour dans 1 minute').then((ok) => { if (ok) harvestIntents.current.delete(selectedBuilding.id); }); }} onDiscover={() => void discoverSupplies(selectedBuilding.id)} />{error ? <p className="error">{error}</p> : null}</WorldContextMenu> : null}
    {menuAnchor && selectedFeatureId ? <WorldContextMenu anchor={menuAnchor}><DepositPanel details={depositDetails} loading={depositLoading} pending={pendingAction} workerCount={workerCount} onWorkerCount={(count) => { if (!extractionIntents.current.get(selectedFeatureId)) setWorkerCount(count); }} onStart={startExtraction} />{error ? <p className="error">{error}</p> : null}</WorldContextMenu> : null}
    <ConstructionPanel construction={construction} definitions={state.buildingTypes} area={area} costs={costs} error={selectionError ?? error} pending={pendingAction} population={state.village.population} gardenWorkerNeed={gardenWorkerNeed} onOpen={() => { closePanels(); clearPreview(); setConstruction({ type: null }); }} onChoose={(type) => { clearPreview(); setConstruction({ type }); }} onConfirm={confirmConstruction} onRestart={clearPreview} onCancel={exitConstruction} />
  </main>;
}
