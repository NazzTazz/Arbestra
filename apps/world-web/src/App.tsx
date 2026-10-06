import { RepresentativePanel } from './ui/RepresentativePanel';
import { ProcessingPanel } from './ui/ProcessingPanel';
import { MarketPanel } from './ui/MarketPanel';
import { commandMarket } from './api/client';
import { constructionCosts } from '@arbestra/contracts';
import { commandProcessing } from './api/client';
import {setFactoryEnabled} from './api/client';
import { InfrastructureTools } from './ui/InfrastructureTools';
import type { RepresentativeInfo } from './scene/village-workers';
import type { InhabitantCameraMode } from './scene/inhabitant-camera';
import { constructionContext, upgradePreview, sameUpgradeQuote, type UpgradePreview } from './ui/construction-intent';
import { discoverCatEyes } from './api/client';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuildingType, DepositDetails, Garden, VillageState } from '@arbestra/contracts';
import type { TerrainHandle } from './scene/VillageScene';
import type { TerrainViewMode } from './scene/BabylonVillageScene';

import { ApiError, buildBuilding, changeWorksite, discoverOrRefreshSupplies, expandGarden, feedPopulation, getStoneDepositDetails, getVillage, restPopulation, type TimedVillageState, upgradeBuilding } from './api/client';
import { campusRange, stonemasonRange, cellKey, previewArea, touchesCell, type Cell, type CellRange } from './scene/construction-selection';
import { ConstructionPanel, type ConstructionChoice } from './ui/ConstructionPanel';
import { Hud } from './ui/Hud';
import { WorldModeNavigation, type ActiveWorldMode } from './ui/world-mode';
import { WorldModeBar } from './ui/WorldModeBar';
import { ExploitationPalette, type ExploitationIntentState, type ExploitationSettings } from './ui/ExploitationPanel';
import { previewExploitation, startExploitation } from './api/client';
import type { ExploitationRequest, ExploitationPreview } from '@arbestra/contracts';
import { type GameNotification } from './ui/NotificationStack';
import { OracleJournal } from './ui/OracleJournal';
import { useOracleHint } from './ui/useOracleHint';
import { BuildingPanel, DepositPanel, PopulationPanel, WorksitePanel } from './ui/PlayerPanels';
import { type ScreenAnchor, WorldContextMenu } from './ui/WorldContextMenu';
import { SciencePanel } from './ui/SciencePanel';
import { commandScience } from './api/client';
import { DevDrawer } from './ui/DevDrawer';
import { configuredExploitation, freezeExploitation, exploitationTargetKeys } from './ui/exploitation-intent';

const VillageScene = lazy(() => import('./scene/VillageScene').then((module) => ({ default: module.VillageScene })));
const worldSlug = new URLSearchParams(window.location.search).get('world') ?? 'aube';
const LOBBY_URL = import.meta.env.VITE_LOBBY_URL ?? 'http://localhost:5173';
const populationAnchor = (): ScreenAnchor => ({ x: window.innerWidth / 2, y: window.innerHeight - 220 });

type ConstructionCommand = {
  commandId: string;
  worldSlug: string;
  villageId: string;
  expectedCosts: Array<{ resourceCode: string; amount: number }>;
  success: string;
} & ({
  kind: 'build'; houseVariant: 'stone'|'logs'|'beams'; buildingType: BuildingType; anchor: Cell; cells: Cell[]; quarterTurns:number;
} | {
  kind: 'expand'; buildingId: string; cells: Cell[];
} | {
  kind: 'upgrade'; buildingId: string; expectedLevel: number;
});
type ConstructionIntentState = 'idle' | 'submitting' | 'error' | 'uncertain';

const pendingExploitationKey = (villageId: string) => `arbestra:pending-exploitation:${worldSlug}:${villageId}`;
const pendingConstructionKey = (villageId: string) => `arbestra:pending-construction:${worldSlug}:${villageId}`;


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
  const [populationFocus, setPopulationFocus] = useState<string | null>(null);
  const [representativeId,setRepresentativeId]=useState<string|null>(null);
  const [representative,setRepresentative]=useState<RepresentativeInfo|null>(null);
  const [representativeView,setRepresentativeView]=useState<InhabitantCameraMode>('village');
  const [noclip,setNoclip]=useState(false);
  const [populationFilter, setPopulationFilter] = useState('all');
  const [showJournal, setShowJournal] = useState(false);
  const [showScience, setShowScience] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<ScreenAnchor | null>(null);
  const [construction, setConstruction] = useState<ConstructionChoice | null>(null);
  const [constructionDomain,setConstructionDomain]=useState<'buildings'|'infrastructure'>('buildings');
  const [quarterTurns,setQuarterTurns]=useState(0);
  const [houseVariant,setHouseVariant]=useState<'stone'|'logs'|'beams'>('logs');
  const [workshop,setWorkshop]=useState<'buildings'|'infrastructure'|null>(null);
  const [constructionIntentState, setConstructionIntentState] = useState<ConstructionIntentState>('idle');
  const constructionCommand = useRef<ConstructionCommand | null>(null);
  const [selection, setSelection] = useState<CellRange | null>(null);
  const touchOrigin = useRef<Cell | null>(null);
  const [notifications, setNotifications] = useState<GameNotification[]>([]);
  const notificationId = useRef(0);
  const notificationTimers = useRef<number[]>([]);
  const [populationCount, setPopulationCount] = useState(1);
  const [depositDetails, setDepositDetails] = useState<DepositDetails | null>(null);
  const terrainRef = useRef<TerrainHandle>(null);
  const [depositLoading, setDepositLoading] = useState(false);
  const [showWorksites, setShowWorksites] = useState(false);
  const depositRequest = useRef(0);

  const [showGardens, setShowGardens] = useState(false);
  const [showTravelPaths, setShowTravelPaths] = useState(false);
  const [showDev, setShowDev] = useState(false);
  const [cosmologyDebug, setCosmologyDebug] = useState(false);
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

  const [worldMode, setWorldMode] = useState<ActiveWorldMode>('exploration');
  const [paletteCollapsed, setPaletteCollapsed] = useState(true);
  const modeNavigation = useRef(new WorldModeNavigation());
  const modeRef = useRef(worldMode); modeRef.current = worldMode;
  const [exploitationSettings, setExploitationSettings] = useState<ExploitationSettings>(() => {
    const fallback: ExploitationSettings = { workerMode: 'auto', workerCap: 10, durationMs: null, cohortId: null,
      filter: 'all', woodMode: 'cut', detailed: false, activityCaps: { gardens: 1, wood: 10, stone: 10 },
      activityDurations: { gardens: null, wood: null, stone: null } };
    return fallback;
  });
  const [mixedRequest, setMixedRequest] = useState<ExploitationRequest | null>(null);
  const [mixedPreview, setMixedPreview] = useState<ExploitationPreview | null>(null);
  const mixedPreviewCommand = useRef<string | null>(null);
  const [, setMixedUncertain] = useState(false);
  const [exploitationIntentState, setExploitationIntentState] = useState<ExploitationIntentState>('idle');
  const uncertainRequest = useRef<ExploitationRequest | null>(null);
  const recoveredVillage = useRef<string | null>(null);
  const mixedGesture = useRef<{request: ExploitationRequest; filter: ExploitationSettings['filter']} | null>(null);
  const releasedExploitation = useRef<string | null>(null);
  const [hoveredBuildingId, setHoveredBuildingId] = useState<string | null>(null);
  const shownUpgrade = useRef<UpgradePreview | null>(null);
  const presentedArea = useRef<{ cells: Cell[]; costs: Array<{ resourceCode: string; amount: number }>; buildingId: string | undefined; quarterTurns:number; houseVariant:string } | null>(null);
  const hoveredExploitation = useRef<{ key: string; settings: string; request: ExploitationRequest } | null>(null);
  const presentedExploitation = useRef<{ commandId: string; preview: ExploitationPreview } | null>(null);
  const acceptedExploitation = useRef(new Set<string>());
  const settingsContext = useRef<string | null>(null);
  const [mixedCells, setMixedCells] = useState<Cell[]>([]);
  const pendingHarvestCells = mixedCells;
  const pendingHarvestKeys = useMemo(() => new Set(mixedCells.map(cellKey)), [mixedCells]);
  useEffect(() => {
    if (!state) return;
    const key = `arbestra:exploitation-settings:${state.world.id}:${state.village.id}`;
    if (settingsContext.current !== key) {
      settingsContext.current = key;
      try { const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
        if (saved) setExploitationSettings(current => ({ ...current, ...saved, cohortId: null, woodMode: 'cut' }));
      } catch { /* Invalid preferences never authorize a command. */ }
      return;
    }
    sessionStorage.setItem(key, JSON.stringify({ ...exploitationSettings, cohortId: null, woodMode: 'cut' }));
  }, [state?.village.id, exploitationSettings]);
  useEffect(() => {
    presentedExploitation.current = mixedRequest && mixedPreview && mixedPreviewCommand.current === mixedRequest.commandId ? { commandId: mixedRequest.commandId, preview: mixedPreview } : null;
    if (mixedRequest && mixedPreview && mixedPreviewCommand.current === mixedRequest.commandId && exploitationIntentState === 'selecting')
      for (const key of exploitationTargetKeys(mixedPreview)) acceptedExploitation.current.add(key);
  }, [mixedRequest, mixedPreview, exploitationIntentState]);
  useEffect(() => {
    if (['error', 'confirm-clear', 'uncertain'].includes(exploitationIntentState) || constructionIntentState === 'uncertain' || constructionIntentState === 'error') setPaletteCollapsed(false);
  }, [exploitationIntentState, constructionIntentState]);
  useEffect(() => {
    if (!mixedRequest || !stateRef.current) { setMixedPreview(null); return; }
    let cancelled = false;
    setMixedPreview(null); mixedPreviewCommand.current = null;
    const timer = window.setTimeout(() => void previewExploitation(worldSlug, stateRef.current!.village.id, mixedRequest).then(preview => {
      if (!cancelled) { mixedPreviewCommand.current = mixedRequest.commandId; setMixedPreview(preview); }
    }).catch(reason => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : 'Aperçu indisponible.');
        if (releasedExploitation.current === mixedRequest.commandId) setExploitationIntentState('error');
      }
    }), 90);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [mixedRequest]);

  const refresh = useCallback(async () => {
    if (actionInFlight.current) return;
    try { applySnapshot(await getVillage(worldSlug, stateRef.current?.village.id)); } catch { /* Background refresh is best effort. */ }
  }, [applySnapshot]);

  useEffect(() => { void getVillage(worldSlug).then(applySnapshot).catch((reason) => {
    if (reason instanceof ApiError && reason.status === 401) setNeedsLogin(true);
    else setError(reason instanceof Error ? reason.message : 'Chargement impossible.');
  }).finally(() => setLoading(false)); }, [applySnapshot]);
  useEffect(() => {
    if (!state || recoveredVillage.current === state.village.id) return;
    recoveredVillage.current = state.village.id;
    try {
      const exploitation = JSON.parse(sessionStorage.getItem(pendingExploitationKey(state.village.id)) ?? 'null') as ExploitationRequest | null;
      if (exploitation?.commandId) {
        uncertainRequest.current = exploitation; setMixedRequest(exploitation); setExploitationIntentState('uncertain');
        pushNotification('Un ordre d’exploitation envoyé reste à vérifier.', 'warning');
      }
      const construction = JSON.parse(sessionStorage.getItem(pendingConstructionKey(state.village.id)) ?? 'null') as ConstructionCommand | null;
      if (construction?.commandId && construction.worldSlug === state.world.slug && construction.villageId === state.village.id) {
        constructionCommand.current = construction; setConstructionIntentState('uncertain');
        pushNotification('Une commande de construction envoyée reste à vérifier.', 'warning');
      }
    } catch { /* A malformed session hint is ignored; server state remains authoritative. */ }
  }, [state?.village.id, pushNotification]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);

  const hasFastTransition = state?.cells.some((cell) => cell.building?.status === 'under-construction' || cell.building?.garden?.expansion
    || cell.building?.garden?.harvest || cell.building?.garden?.plots.some((plot) => plot.harvest)) ?? false;
  const hasGarden = state?.cells.some((cell) => Boolean(cell.building?.garden)) ?? false;
  const hasExtraction = (state?.village.extractions.length ?? 0) > 0 || (state?.village.worksites.some(site => site.status === 'running') ?? false)
    || (state?.village.processingOrders?.some(order=>!!order.currentLot) ?? false);
  const hasRestingPopulation = (state?.village.population.resting ?? 0) > 0;
  const hasMarketDelivery = state?.village.market?.exchanges.some(exchange=>!exchange.completedAt) ?? false;
  useEffect(() => {
    if (!hasFastTransition && !hasExtraction && !hasMarketDelivery && !hasRestingPopulation && !selectedFeatureId && !hasGarden && !state?.science?.universities.length) return;
    const timer = window.setInterval(() => void refresh(), hasFastTransition ? 500 : hasExtraction || hasMarketDelivery || selectedFeatureId ? 2_000 : 10_000);
    return () => window.clearInterval(timer);
  }, [hasFastTransition, hasExtraction, hasMarketDelivery, hasRestingPopulation, selectedFeatureId, hasGarden, state?.science?.universities.length, refresh]);
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
  const buildingAssignmentIds = useMemo(() => {
    if (!selectedBuilding || !state) return [];
    const garden = selectedBuilding.garden;
    return [...new Set([garden?.harvest?.id, ...(garden?.plots.map(p => p.harvest?.id) ?? []),
      ...(state.science?.activities.filter(a => a.buildingId === selectedBuilding.id).map(a => a.id) ?? []),
      ...(state.village.processingOrders?.filter(o=>o.buildingId===selectedBuilding.id).map(o=>o.currentLot?.id)??[])].filter((id): id is string => !!id))];
  }, [selectedBuilding, state]);
  const definition = state?.buildingTypes.find((item) => item.code === construction?.type);
  const context = state && selection && construction?.type
    ? constructionContext(state, construction.type, selection.first, selection.last) : null;
  const contextualConstruction = construction ? { type: construction.type, action: context?.action ?? 'build', ...(context?.buildingId ? { buildingId: context.buildingId } : {}) } : null;
  const extensionId = context?.action === 'extend' ? context.buildingId : undefined;
  const spatial = definition?.progressionMode === 'spatial';
  const area = useMemo(() => state && selection && context?.action !== 'upgrade' ? previewArea(state, construction?.type === 'university'
    ? campusRange(selection.last,quarterTurns)
    : construction?.type === 'stonemason' ? stonemasonRange(selection.last,quarterTurns) : selection, spatial || construction?.type === 'university' || construction?.type === 'stonemason', extensionId) : null, [state, selection, spatial, extensionId, construction?.type, context?.action,quarterTurns]);
  const highlightedSiteIds = useMemo(() => {
    if (!state || !construction?.buildingId) return [];
    const active = state.cells.filter((cell) => cell.footprint?.buildingId === construction.buildingId && cell.footprint?.state === 'active');
    return state.cells.filter((cell) => cell.canBuild && active.some((other) => touchesCell(cell, other, state.world))).map(cellKey);
  }, [state, construction?.buildingId]);
  const level = extensionId ? state?.cells.find((cell) => cell.building?.id === extensionId)?.building?.level ?? 1 : 1;
  const costs = constructionCosts(definition?.levels.find((item) => item.level === level),houseVariant).map((cost) => ({ ...cost, amount: cost.amount * (spatial ? area?.count ?? 0 : 1) }));
  const serverNow = now + serverOffsetMs;
  const displayedWood = state ? Math.floor(state.village.wood + state.village.woodProductionPerHour * Math.max(0, serverNow - Date.parse(state.serverTime)) / 3_600_000) : 0;
  const affordable = costs.every((cost) => cost.amount <= (cost.resourceCode === 'wood' ? displayedWood : state?.village.resources.find((resource) => resource.code === cost.resourceCode)?.amount ?? 0));
  const selectionError = area?.error ?? (area && !affordable ? 'Ressources insuffisantes.' : null);
  const existingGardenCells = extensionId ? state?.cells.filter((cell) => cell.footprint?.buildingId === extensionId && cell.footprint?.state === 'active').length ?? 0 : 0;
  const gardenWorkerNeed = spatial && area ? existingGardenCells + area.count : null;

  const upgrade = state && context?.action === 'upgrade' ? upgradePreview(state, context.siteId ?? hoveredBuildingId) : null;
  useEffect(() => { shownUpgrade.current = paletteCollapsed ? null : upgrade; });
  useEffect(() => { presentedArea.current = area ? { cells: area.cells, costs, buildingId: extensionId, quarterTurns, houseVariant } : null; });

  function closePanels() { terrainRef.current?.selectRepresentative(null); setRepresentativeId(null);setRepresentative(null);setRepresentativeView('village'); depositRequest.current++; setSelectedSiteId(null); setSelectedFeatureId(null); setDepositDetails(null); setShowPopulation(false); setShowJournal(false); setShowGardens(false); setMenuAnchor(null); }
  function clearPreview() { terrainRef.current?.cancelGesture(); setHoveredBuildingId(null); shownUpgrade.current = null; presentedArea.current = null; touchOrigin.current = null; setSelection(null); setError(null); }
  function exitConstruction() { setConstruction(null); clearPreview(); }
  async function runAction(action: () => Promise<TimedVillageState>, success?: string, exit = false): Promise<boolean> {
    if (actionInFlight.current) return false;
    actionInFlight.current = true; setPendingAction(true); setError(null);
    try { applySnapshot(await action()); markOracleProgress(); if (exit) exitConstruction(); if (success) pushNotification(success); return true; }
    catch (reason) { const message = reason instanceof Error ? reason.message : 'Action impossible.'; setError(message); pushNotification(message, 'warning'); return false; }
    finally { actionInFlight.current = false; setPendingAction(false); }
  }

  async function executeConstruction(command: ConstructionCommand): Promise<void> {
    if (actionInFlight.current) return;
    constructionCommand.current = command;
    actionInFlight.current = true; setPendingAction(true); setError(null); setConstructionIntentState('submitting');
    sessionStorage.setItem(pendingConstructionKey(command.villageId), JSON.stringify(command));
    try {
      const snapshot = command.kind === 'build'
        ? await buildBuilding(command.worldSlug, command.villageId, command.buildingType, command.anchor, command.cells, command.commandId, command.expectedCosts,command.quarterTurns,command.houseVariant)
        : command.kind === 'expand'
          ? await expandGarden(command.worldSlug, command.villageId, command.buildingId, command.cells, command.commandId, command.expectedCosts)
          : await upgradeBuilding(command.worldSlug, command.villageId, command.buildingId, command.commandId, command.expectedCosts, command.expectedLevel);
      applySnapshot(snapshot); markOracleProgress(); clearPreview();
      sessionStorage.removeItem(pendingConstructionKey(command.villageId)); constructionCommand.current = null;
      setConstructionIntentState('idle'); pushNotification(command.success);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Commande de construction impossible.';
      setError(message); pushNotification(message, 'warning');
      if (reason instanceof ApiError && reason.status < 500) {
        sessionStorage.removeItem(pendingConstructionKey(command.villageId));
        setConstructionIntentState('error');
      } else setConstructionIntentState('uncertain');
    } finally { actionInFlight.current = false; setPendingAction(false); }
  }

  function retryConstruction() {
    const previous = constructionCommand.current;
    if (!previous || actionInFlight.current) return;
    const command = constructionIntentState === 'uncertain' ? previous : { ...previous, commandId: crypto.randomUUID() };
    void executeConstruction(command);
  }

  function clearConstructionError() {
    if (constructionIntentState === 'uncertain') return;
    constructionCommand.current = null; setConstructionIntentState('idle'); setError(null);
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || actionInFlight.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest('input, textarea, select')) return;
      if (event.key.toLowerCase() === 'b') { event.preventDefault(); chooseMode(modeRef.current === 'construction' ? 'exploration' : 'construction'); }
      if (event.key.toLowerCase()==='r'&&!event.repeat&&modeRef.current==='construction'&&constructionDomain==='buildings'&&construction?.type&&!paletteCollapsed&&!workshop) { event.preventDefault();setQuarterTurns(t=>(t+1)%4);return; }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (exploitationIntentState === 'uncertain' || constructionIntentState === 'uncertain') { setPaletteCollapsed(true); return; }
        if (mixedRequest || selection || mixedGesture.current) { cancelWorldGesture(); return; }
        if (representativeId || selectedSiteId || selectedFeatureId || showPopulation || showJournal || showScience || showWorksites || showGardens) { closePanels(); setShowScience(false); setShowWorksites(false); return; }
        if (modeRef.current === 'construction' && construction?.type) { clearPreview(); setConstruction({ action: construction.action, type: construction.action === 'extend' ? 'garden' : null }); return; }
        setPaletteCollapsed(true);
      }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => {
    if(representativeId)return;
    if (!selectedSiteId && !selectedFeatureId && !populationFocus) return;
    const timer = window.setInterval(() => {
      const current = stateRef.current;
      const target = selectedSiteId ? current?.cells.find(c => c.id === selectedSiteId) : current?.region.features.find(f => f.id === selectedFeatureId);
      const focused = populationFocus ? current?.village.population.cohorts?.find(c => c.id === populationFocus)?.assignmentId ?? populationFocus : null;
      const anchor = target ? terrainRef.current?.projectCell(target) : focused ? terrainRef.current?.projectPopulation(focused) : null;
      if (!target && !focused) return;
      if (anchor) setMenuAnchor(anchor); else closePanels();
    }, 100);
    return () => window.clearInterval(timer);
  }, [selectedSiteId, selectedFeatureId, populationFocus, representativeId]);


  useEffect(()=>{
    if(!representativeId)return;
    const timer=window.setInterval(()=>{
      const view=terrainRef.current?.representativeCameraMode()??'village';setRepresentativeView(view);
      const info=terrainRef.current?.representativeInfo(representativeId);
      if(info)setRepresentative(info);
      else if(view==='village'){closePanels();return;}
      if(view==='village'){
        const anchor=terrainRef.current?.projectRepresentative(representativeId);
        if(anchor)setMenuAnchor(anchor);
      }
    },200);
    return ()=>window.clearInterval(timer);
  },[representativeId]);

  function handleAreaGesture(first: Cell, last: Cell, commit: boolean) {
    if (paletteCollapsed || modeRef.current !== 'construction' || terrainView !== 'village' || actionInFlight.current || arrivalActive
      || constructionIntentState === 'uncertain') return;
    if (!construction || construction.action === 'upgrade' || !construction.type || construction.action === 'extend' && !construction.buildingId) return;
    setError(null);
    touchOrigin.current = null;
    const nextSelection = { first, last };
    setSelection(nextSelection);
    if (!commit || !state) return;
    const intent = constructionContext(state, construction.type, first, last);
    if (intent.action === 'upgrade') {
      const currentQuote = upgradePreview(state, intent.siteId!);
      if (!sameUpgradeQuote(shownUpgrade.current, currentQuote)) {
        setError(currentQuote?.error ?? 'Le devis a changé. Vérifiez le coût affiché avant de recommencer.');
        setPaletteCollapsed(false); return;
      }
      const quote = shownUpgrade.current!;
      void executeConstruction({ kind: 'upgrade', commandId: crypto.randomUUID(), worldSlug: state.world.slug,
        villageId: state.village.id, buildingId: quote.buildingId, expectedCosts: quote.costs,
        expectedLevel: quote.nextLevel, success: `Amélioration de ${quote.name} lancée` });
      return;
    }
    const buildingId = intent.action === 'extend' ? intent.buildingId : undefined;
    const nextArea = previewArea(state, construction.type === 'university'
      ? campusRange(last,quarterTurns)
      : construction.type === 'stonemason' ? stonemasonRange(last,quarterTurns) : nextSelection, Boolean(spatial || construction.type === 'university' || construction.type === 'stonemason'), buildingId);
    const currentLevel = buildingId ? state.cells.find(cell => cell.building?.id === buildingId)?.building?.level ?? 1 : 1;
    const currentDefinition = state.buildingTypes.find(item => item.code === construction.type);
    const nextCosts = constructionCosts(currentDefinition?.levels.find(item => item.level === currentLevel),houseVariant)
      .map(cost => ({ ...cost, amount: cost.amount * (spatial ? nextArea.count : 1) }));
    const currentWood = displayedWood;
    const canAfford = nextCosts.every(cost => cost.amount <= (cost.resourceCode === 'wood' ? currentWood
      : state.village.resources.find(resource => resource.code === cost.resourceCode)?.amount ?? 0));
    const nextError = nextArea.error ?? (!canAfford ? 'Ressources insuffisantes.' : null);
    if (nextError || !nextArea.cells.length) { setError(nextError); return; }
    if (buildingId && nextArea.count === 0) return;
    const shown = presentedArea.current;
    if (!shown || shown.houseVariant !== houseVariant || shown.quarterTurns !== quarterTurns || shown.buildingId !== buildingId || JSON.stringify(shown.cells) !== JSON.stringify(nextArea.cells) || JSON.stringify(shown.costs) !== JSON.stringify(nextCosts)) {
      setError('L’aperçu a changé. Vérifiez l’emprise et le coût, puis cliquez à nouveau.'); setPaletteCollapsed(false); return;
    }
    const anchor = construction.type === 'university' || construction.type === 'stonemason' ? last : spatial ? first : nextArea.cells[0]!;
    const command: ConstructionCommand = buildingId
      ? { kind: 'expand', commandId: crypto.randomUUID(), worldSlug: state.world.slug, villageId: state.village.id,
        buildingId, cells: nextArea.cells, expectedCosts: nextCosts, success: 'Extension du Jardin lancée' }
      : { kind: 'build', commandId: crypto.randomUUID(), worldSlug: state.world.slug, villageId: state.village.id,
        houseVariant, buildingType: construction.type as BuildingType, anchor, cells: nextArea.cells, quarterTurns, expectedCosts: nextCosts, success: 'Construction lancée' };
    void executeConstruction(command);
  }
  function newMixedRequest(): ExploitationRequest {
    return configuredExploitation(exploitationSettings, stateRef.current?.village.population.total ?? 1, crypto.randomUUID());
  }
  function changeExploitationSettings(settings: ExploitationSettings) {
    setExploitationSettings(settings);
    if (exploitationIntentState === 'idle') {
      terrainRef.current?.cancelGesture(); hoveredExploitation.current = null;
      presentedExploitation.current = null; setMixedRequest(null); setMixedPreview(null); setMixedCells([]);
    }
    if (mixedRequest && exploitationIntentState === 'error') {
      presentedExploitation.current = null;
      setMixedPreview(null);
      setMixedRequest(configuredExploitation(settings, stateRef.current?.village.population.total ?? 1, crypto.randomUUID(), mixedRequest));
      setError(null);
    }
  }
  function cancelWorldGesture() {
    terrainRef.current?.cancelGesture();
    presentedExploitation.current = null; acceptedExploitation.current.clear(); hoveredExploitation.current = null;
    touchOrigin.current = null; setSelection(null); mixedGesture.current = null;
    if (exploitationIntentState !== 'uncertain' && exploitationIntentState !== 'submitting') {
      releasedExploitation.current = null; uncertainRequest.current = null; setMixedRequest(null); setMixedPreview(null); setMixedCells([]);
      setExploitationIntentState('idle'); setMixedUncertain(false);
    }
    if (constructionIntentState === 'error') clearConstructionError();
    setError(null);
  }
  function cancelDraft() {
    cancelWorldGesture();
    exitConstruction();
  }
  function toggleHud() {
    cancelWorldGesture(); closePanels(); setShowScience(false); setShowWorksites(false);
    setPaletteCollapsed(value=>!value);
  }
  function chooseMode(mode: ActiveWorldMode, toggleActive = false) {
    if(toggleActive && mode===modeRef.current){toggleHud();return;}
    if (mode !== 'exploitation') setExploitationSettings(current => ({ ...current, woodMode: 'cut' }));
    cancelDraft(); closePanels(); setShowScience(false); setShowWorksites(false); setPopulationFocus(null); setPopulationFilter('all');
    if (modeNavigation.current.choose(mode)) { terrainRef.current?.showVillage(); return; }
    modeRef.current = mode; setWorldMode(mode); terrainRef.current?.setWorldMode(mode);
    setPaletteCollapsed(mode==='exploration');
    if (mode === 'construction') setConstruction({ action: 'build', type: null });
    if (mode === 'population') { setShowPopulation(true); setMenuAnchor(populationAnchor()); }
    if (mode === 'exploitation' && uncertainRequest.current) {
      setMixedRequest(uncertainRequest.current); setMixedUncertain(true); setExploitationIntentState('uncertain');
    }
  }
  function changeView(view: TerrainViewMode) {
    if (view !== 'village') setExploitationSettings(current => ({ ...current, woodMode: 'cut' }));
    setTerrainView(view); cancelDraft(); closePanels(); setShowScience(false); setShowWorksites(false);
    const mode = modeNavigation.current.changeView(view); modeRef.current = mode; setWorldMode(mode); terrainRef.current?.setWorldMode(mode);
    if (view === 'village' && mode === 'construction') setConstruction({ action: 'build', type: null });
    if (view === 'village' && mode === 'population') { setShowPopulation(true); setMenuAnchor(populationAnchor()); }
  }
  function collectExploitation(cell: Cell | null, newGesture = false, previewOnly = false) {
    if (paletteCollapsed || modeRef.current !== 'exploitation' || terrainView !== 'village' || arrivalActive || actionInFlight.current || uncertainRequest.current) return;
    if (previewOnly && (mixedGesture.current || exploitationIntentState !== 'idle' || showDev)) return;
    if (!cell) {
      if (!newGesture && mixedGesture.current) {
        const request = mixedGesture.current.request;
        if (request.gardens.length || request.wood.length || request.stone.length) {
          setMixedRequest(request); setMixedUncertain(false); setError(null); closePanels();
          finalizeReleasedExploitation(request);
        }
        else { setMixedRequest(null); setMixedPreview(null); setMixedCells([]); setExploitationIntentState('idle'); }
      } else { setMixedCells([]); setExploitationIntentState('idle'); }
      mixedGesture.current = null; return;
    }
    const warm = newGesture && !previewOnly && hoveredExploitation.current?.key === cellKey(cell)
      && hoveredExploitation.current.settings === JSON.stringify(exploitationSettings) ? hoveredExploitation.current.request : null;
    if (newGesture && !previewOnly) {
      if (!warm) { presentedExploitation.current = null; acceptedExploitation.current.clear(); setMixedRequest(null); setMixedPreview(null); }
      else if (presentedExploitation.current?.commandId === warm.commandId)
        for (const key of exploitationTargetKeys(presentedExploitation.current.preview)) acceptedExploitation.current.add(key);
      releasedExploitation.current = null; setMixedCells([]); setError(null);
      mixedGesture.current = { request: warm ?? newMixedRequest(), filter: exploitationSettings.filter };
      setExploitationIntentState('selecting');
    }
    const gesture = previewOnly ? { request: newMixedRequest(), filter: exploitationSettings.filter } : mixedGesture.current;
    const current = stateRef.current;
    if (!gesture || !current) return;
    let request = gesture.request;
    const { filter } = gesture;
    const garden = current.cells.flatMap(c => c.building?.garden && !c.building.garden.harvest ? c.building.garden.plots : []).find(p => cellKey(p) === cellKey(cell) && !p.harvest && p.storedCarrots >= 1);
    let changed = false;
    if (garden && (filter === 'all' || filter === 'gardens') && !request.gardens.some(p => cellKey(p) === cellKey(cell))) {
      request = { ...request, commandId: crypto.randomUUID(), gardens: [...request.gardens, cell] }; changed = true;
    }
    for (const feature of terrainRef.current?.featuresAt(cell) ?? current.region.features.filter(f => cellKey(f) === cellKey(cell))) {
      const family = feature.deposit?.resourceCode === 'wood' ? 'wood' : feature.deposit?.resourceCode === 'stone' ? 'stone' : null;
      if (family && (filter === 'all' || filter === family) && !request[family].includes(feature.id)) {
        request = { ...request, commandId: crypto.randomUUID(), [family]: [...request[family], feature.id] }; changed = true;
      }
    }
    if (changed) { gesture.request = request; setMixedRequest(request); }
    if (previewOnly) { acceptedExploitation.current.clear(); hoveredExploitation.current = { key: cellKey(cell), settings: JSON.stringify(exploitationSettings), request }; setMixedCells([]); if (!changed) { setMixedRequest(null); setMixedPreview(null); } }
    if (garden && request.gardens.some(p => cellKey(p) === cellKey(cell)) || (terrainRef.current?.featuresAt(cell) ?? []).some(f => request.wood.includes(f.id) || request.stone.includes(f.id)))
      setMixedCells(previous => previous.some(p => cellKey(p) === cellKey(cell)) ? previous : [...previous, cell]);
  }
  async function submitExploitation(request: ExploitationRequest) {
    const current = stateRef.current;
    if (modeRef.current !== 'exploitation' || !current || actionInFlight.current || arrivalActive) return;
    actionInFlight.current = true; setPendingAction(true); setError(null);
    setExploitationIntentState('submitting');
    sessionStorage.setItem(pendingExploitationKey(current.village.id), JSON.stringify(request));
    try {
      const snapshot = await startExploitation(worldSlug, current.village.id, request);
      applySnapshot(snapshot); markOracleProgress();
      sessionStorage.removeItem(pendingExploitationKey(current.village.id));
      uncertainRequest.current = null; releasedExploitation.current = null; setMixedUncertain(false); setMixedRequest(null); setMixedPreview(null); setMixedCells([]);
      setExploitationIntentState('idle');
      const order = snapshot.state.village.exploitationOrders?.find(item => item.workerCap === request.workerCap && !current.village.exploitationOrders?.some(old => old.id === item.id));
      pushNotification(order ? `Exploitation lancée · ${order.mobilized} habitant(s) mobilisé(s) / plafond ${order.workerCap}` : 'Exploitation confirmée');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Lancement impossible.'; setError(message);
      if (reason instanceof ApiError && reason.status < 500) {
        sessionStorage.removeItem(pendingExploitationKey(current.village.id));
        uncertainRequest.current = null; releasedExploitation.current = null; setMixedUncertain(false); setMixedRequest(request);
        setExploitationIntentState('error');
      } else {
        uncertainRequest.current = request; releasedExploitation.current = null; setMixedUncertain(true); setMixedRequest(request);
        setExploitationIntentState('uncertain');
      }
      pushNotification(message, 'warning');
    } finally { actionInFlight.current = false; setPendingAction(false); }
  }
  function finalizeReleasedExploitation(request: ExploitationRequest) {
    try {
      const finalized = freezeExploitation(request, presentedExploitation.current, acceptedExploitation.current);
      releasedExploitation.current = null;
      setMixedRequest(finalized);
      if (finalized.woodMode === 'clear' && finalized.wood.length) { setExploitationIntentState('confirm-clear'); return; }
      void submitExploitation(finalized);
    } catch (reason) {
      releasedExploitation.current = null;
      setError(reason instanceof Error ? reason.message : 'S?lection ? vérifier.');
      setExploitationIntentState('error');
    }
  }
  function retryExploitation() {
    if (uncertainRequest.current) { void submitExploitation(uncertainRequest.current); return; }
    if (!mixedRequest) return;
    // A known refusal creates a fresh identity, using the corrected displayed parameters.
    try {
      const frozen = freezeExploitation(mixedRequest, presentedExploitation.current, acceptedExploitation.current);
      const request = { ...frozen, commandId: crypto.randomUUID() };
      setMixedRequest(request); setError(null);
      if (request.woodMode === 'clear' && request.wood.length) setExploitationIntentState('confirm-clear');
      else void submitExploitation(request);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'S?lection ? vérifier.'); }
  }
  function removeExploitationTarget(family: 'gardens' | 'wood' | 'stone', key: string) {
    if (!mixedRequest || exploitationIntentState === 'uncertain') return;
    const request: ExploitationRequest = family === 'gardens'
      ? { ...mixedRequest, commandId: crypto.randomUUID(), gardens: mixedRequest.gardens.filter(cell => `garden:${cell.cellX}:${cell.cellY}` !== key) }
      : { ...mixedRequest, commandId: crypto.randomUUID(), [family]: mixedRequest[family].filter(id => id !== key) };
    acceptedExploitation.current.delete(key); presentedExploitation.current = null;
    releasedExploitation.current = null; setMixedRequest(request); setMixedPreview(null); setError(null); setExploitationIntentState('error');
  }
  function runPopulation(action: 'feed' | 'rest') { if (!state || modeRef.current !== 'population' || arrivalActive) return; const intent = populationIntent.current?.action === action && populationIntent.current.count === populationCount ? populationIntent.current : { action, count: populationCount, id: crypto.randomUUID() }; populationIntent.current = intent; void runAction(() => action === 'feed' ? feedPopulation(worldSlug, state.village.id, intent.count, intent.id) : restPopulation(worldSlug, state.village.id, intent.count, intent.id), action === 'feed' ? `${intent.count} habitant(s) ont mangé` : `${intent.count} habitant(s) au repos`).then((ok) => { if (ok) populationIntent.current = null; }); }
  async function discoverSupplies(buildingId: string) {
    const currentState = stateRef.current;
    if (actionInFlight.current || !currentState || modeRef.current !== 'exploitation' || arrivalActive) return;
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
  function useConstructionTarget(siteId: string, anchor: ScreenAnchor, inspect = false) {
    const current = stateRef.current;
    if (!current || !construction || modeRef.current !== 'construction' || actionInFlight.current || constructionIntentState === 'uncertain') return;
    const site = current.cells.find(cell => cell.id === siteId);
    const building = site?.building ?? (site?.footprint ? current.cells.find(cell => cell.building?.id === site.footprint?.buildingId)?.building : null);
    if (!building) { setError('Aucun bâtiment à cet emplacement.'); return; }
    if (inspect) { closePanels(); setSelectedSiteId(siteId); setMenuAnchor(anchor); return; }
    if (construction.action === 'extend') {
      if (building.type !== 'garden' || building.status !== 'completed') { setError('Choisissez un Jardin terminé.'); return; }
      clearPreview(); setConstruction({ action: 'extend', type: 'garden', buildingId: building.id });
      pushNotification('Jardin choisi · glissez pour dessiner son extension'); return;
    }
    if (construction.action === 'upgrade') {
      const currentQuote = upgradePreview(current, siteId);
      if (!sameUpgradeQuote(shownUpgrade.current, currentQuote)) {
        setHoveredBuildingId(siteId); setPaletteCollapsed(false);
        setError(currentQuote?.error ?? 'Vérifiez le coût et le prochain niveau affich?s avant de cliquer.'); return;
      }
      const quote = shownUpgrade.current!;
      void executeConstruction({ kind: 'upgrade', commandId: crypto.randomUUID(), worldSlug: current.world.slug,
        villageId: current.village.id, buildingId: quote.buildingId, expectedCosts: quote.costs,
        expectedLevel: quote.nextLevel, success: `Amélioration de ${quote.name} lanc?e` });
      return;
    }
    closePanels(); setSelectedSiteId(siteId); setMenuAnchor(anchor);
  }

  function commandWorksite(id: string, action: 'pause' | 'resume' | 'stop' | 'set-cap', cap?: number) {
    if (!state || modeRef.current !== 'exploitation') return;
    void runAction(() => changeWorksite(worldSlug, state.village.id, id,
      { commandId: crypto.randomUUID(), action, ...(cap === undefined ? {} : { workerCap: cap }) }));
  }

  if (loading) return <main className="center-message">Chargement du monde…</main>;
  if (needsLogin) return <main className="center-message"><a href={LOBBY_URL}>Se connecter pour entrer dans ce monde</a></main>;
  if (!state) return <main className="center-message" role="alert">{error ?? 'Village indisponible.'}</main>;
  return <main className="game-shell">
    <Suspense fallback={<div className="center-message">L'oracle se rhabille...</div>}><VillageScene worldMode={paletteCollapsed ? 'exploration' : worldMode} noclip={noclip} populationFilter={populationFilter} populationFocus={state.village.population.cohorts?.find(c => c.id === populationFocus)?.assignmentId ?? populationFocus}
      onEyesFound={() => void discoverEyes()} onArrivalActive={setArrivalActive} state={state} serverOffsetMs={serverOffsetMs} terrainRef={terrainRef}
      pendingHarvestCells={worldMode === 'exploitation' ? pendingHarvestCells : []} highlightedSiteIds={highlightedSiteIds}
      constructionMode={!paletteCollapsed && !workshop && worldMode === 'construction' && constructionDomain==='buildings' && terrainView === 'village'} showTravelPaths={showTravelPaths} selectedRouteId={selectedRouteId}
      cosmologyDebug={cosmologyDebug} devOpen={showDev} constructionAction={worldMode === 'construction' ? construction?.action ?? null : null} constructionType={construction?.type ?? null} onBuildingHover={setHoveredBuildingId} paletteOpen={!paletteCollapsed}
      constructionQuarterTurns={quarterTurns} constructionHouseVariant={houseVariant} selectingArea={!paletteCollapsed && !workshop && constructionDomain==='buildings' && worldMode === 'construction' && Boolean(construction?.type) && construction?.action !== 'upgrade'
        && (construction?.action !== 'extend' || Boolean(construction.buildingId)) && !pendingAction && terrainView === 'village'}
      preview={!paletteCollapsed && worldMode === 'construction' ? area : null} previewInvalid={Boolean(selectionError)} onAreaGesture={handleAreaGesture}
      onGardenHarvest={collectExploitation} onWorldGestureCancelled={cancelWorldGesture} onSiteSelected={(id, anchor, inspect) => {
        if(modeRef.current==='population'&&id.startsWith('representative:')){
          closePanels();setPopulationFocus(null);const personId=id.slice(15);
          terrainRef.current?.selectRepresentative(personId);setRepresentativeId(personId);
          setRepresentative(terrainRef.current?.representativeInfo(personId)??null);setMenuAnchor(anchor);return;
        }
        if (modeRef.current === 'population' && id.startsWith('population:')) { closePanels(); setPopulationFocus(id.slice(11)); setShowPopulation(true); setMenuAnchor(anchor); return; }
        if (modeRef.current === 'construction') { useConstructionTarget(id, anchor, inspect); return; }
        if (modeRef.current !== 'exploration') { closePanels(); setSelectedSiteId(id); setMenuAnchor(anchor); if (modeRef.current === 'population') setShowPopulation(true); }
      }} onFeatureSelected={(id, anchor) => {
        if (modeRef.current === 'exploitation') { closePanels(); setSelectedFeatureId(id); setMenuAnchor(anchor); }
      }} onCameraMoved={() => {}} onViewChanged={changeView} /></Suspense>
    <WorldModeBar mode={worldMode} collapsed={paletteCollapsed} onChoose={mode=>chooseMode(mode,true)} />
    {worldMode === 'exploitation' && terrainView === 'village' && <div hidden={paletteCollapsed}><ExploitationPalette settings={exploitationSettings} population={state.village.population}
      request={mixedRequest} preview={mixedPreview} intentState={exploitationIntentState} error={error} pending={pendingAction || arrivalActive} collapsed={paletteCollapsed}
      onChange={changeExploitationSettings} onToggle={toggleHud}
      onWorksites={() => { closePanels(); setShowWorksites(value => !value); }}
      onGardens={() => { closePanels(); setShowGardens(true); setMenuAnchor({ x: 16, y: window.innerHeight - 300 }); }}
      onConfirmClear={() => { if (mixedRequest) void submitExploitation(mixedRequest); }}
      onCancelIntent={cancelWorldGesture}
      onRetry={retryExploitation} onRemoveTarget={removeExploitationTarget} /></div>}
    {worldMode === 'population' && !paletteCollapsed && terrainView === 'village' && <div className="mode-toolbar population-toolbar">
      <span>Population {state.village.population.total} · Repos {state.village.population.resting} · Disponibles {state.village.population.available} · Affectés {state.village.population.working}</span>
      <button type="button" onClick={() => { closePanels(); setShowPopulation(true); setMenuAnchor({ x: window.innerWidth / 2, y: window.innerHeight - 280 }); }}>Habitants et cohortes</button>
      <button type="button" onClick={() => setShowScience(value => !value)}>Arbre des connaissances</button></div>}
    {oracleCat && !arrivalActive && <aside className="oracle-cat-visit" role="dialog" aria-label="L'Oracle">
      <strong>L'Oracle</strong><p>Je cherche mon chat… Vous ne l'auriez pas aperçu ?</p>
      <button type="button" onClick={() => setOracleCat(false)}>Fermer</button>
    </aside>}
    <Hud devOpen={showDev} devActive={noclip||cosmologyDebug||showTravelPaths} onDev={()=>{setShowDev(value=>!value);cancelWorldGesture();}} state={state} displayedWood={displayedWood} notifications={notifications} onPopulation={() => chooseMode('population')} onJournal={() => { closePanels(); setShowJournal(true); setMenuAnchor(populationAnchor()); }} />

    {showScience && worldMode === 'population' && terrainView === 'village' && state.science && <SciencePanel target={selectedFeatureId && depositDetails ? depositDetails.deposit : {cellX:state.village.anchorCellX,cellY:state.village.anchorCellY}} science={state.science} villageId={state.village.id} buildingId={selectedBuilding?.type === 'university' ? selectedBuilding.id : null} pending={pendingAction} serverNow={serverNow} error={error} onClose={() => setShowScience(false)} onCommand={command => { if (modeRef.current !== 'population' || arrivalActive) return; void runAction(() => commandScience(worldSlug, state.village.id, command), 'Université · commande prise en compte'); }} />}
    <DevDrawer onFactory={enabled=>void runAction(()=>setFactoryEnabled(worldSlug,enabled,state.village.id))} noclip={noclip} onNoclip={setNoclip} open={showDev} view={terrainView} state={state} showTravelPaths={showTravelPaths} selectedRouteId={selectedRouteId}
      cosmology={cosmologyDebug} onOpen={open => { setShowDev(open); if (open) cancelWorldGesture(); }} onTravelPaths={setShowTravelPaths}
      onRoute={setSelectedRouteId} onCosmology={setCosmologyDebug} onReset={() => { setNoclip(false);terrainRef.current?.resetCosmology(); setCosmologyDebug(false); setShowTravelPaths(false); setSelectedRouteId(null); }} />
    {showWorksites && worldMode === 'exploitation' && terrainView === 'village' && <WorksitePanel orders={state.village.exploitationOrders ?? []} serverNow={serverNow} worksites={state.village.worksites} pending={pendingAction} onAction={commandWorksite} />}
    {menuAnchor && showGardens && worldMode === 'exploitation' ? <WorldContextMenu anchor={menuAnchor}><div><strong>Choisir un Jardin</strong>{gardenSites.map((site, index) => <button type="button" key={site.id} onClick={() => { setShowGardens(false); setSelectedSiteId(site.id); }}>Jardin {index + 1} · {site.cellX}, {site.cellY} · {site.building!.garden!.activeCellCount} parcelle(s)</button>)}</div></WorldContextMenu> : null}
    {representative && menuAnchor && worldMode==='population' && <WorldContextMenu anchor={representativeView==='village'?menuAnchor:{x:window.innerWidth-330,y:110}}><RepresentativePanel person={representative} view={representativeView} onView={mode=>terrainRef.current?.representativeCamera(mode)} onClose={closePanels}/></WorldContextMenu>}
    {menuAnchor && showPopulation && worldMode === 'population' ? <WorldContextMenu anchor={menuAnchor}><PopulationPanel buildingId={selectedBuilding?.id ?? null} assignmentIds={buildingAssignmentIds} focus={populationFocus} onFocus={(id, filter) => { setPopulationFocus(id); setPopulationFilter(filter); }} population={state.village.population} pending={pendingAction} count={populationCount} onCount={(count) => setPopulationCount(Math.max(1, Math.min(state.village.population.available || 1, count || 1)))} onFeed={() => runPopulation('feed')} onRest={() => runPopulation('rest')} />{error ? <p className="error">{error}</p> : null}</WorldContextMenu> : null}
    {menuAnchor && showJournal ? <WorldContextMenu anchor={menuAnchor}><OracleJournal accomplishments={state.village.accomplishments} /></WorldContextMenu> : null}
    {menuAnchor && selectedBuilding && worldMode === 'exploitation' && state.buildingTypes.find(d=>d.code===selectedBuilding.type)?.levels.find(l=>l.level===selectedBuilding.level)?.processing && <WorldContextMenu anchor={menuAnchor}><ProcessingPanel key={selectedBuilding.id} slug={worldSlug} villageId={state.village.id} building={selectedBuilding} recipe={state.buildingTypes.find(d=>d.code===selectedBuilding.type)!.levels.find(l=>l.level===selectedBuilding.level)!.processing!} orders={state.village.processingOrders??[]} serverNow={serverNow} revision={state.serverTime} pending={pendingAction} error={error} onCommand={command=>runAction(()=>commandProcessing(worldSlug,state.village.id,command))}/></WorldContextMenu>}
    {menuAnchor && selectedBuilding && worldMode === 'exploitation' && !state.buildingTypes.find(d=>d.code===selectedBuilding.type)?.levels.find(l=>l.level===selectedBuilding.level)?.processing ? <WorldContextMenu anchor={menuAnchor}><BuildingPanel mode={worldMode} building={selectedBuilding} definition={state.buildingTypes.find((item) => item.code === selectedBuilding.type)!} serverNow={serverNow} pending={pendingAction} pendingHarvestKeys={pendingHarvestKeys} readyCarrots={selectedBuilding.garden ? gardenReady(selectedBuilding.garden, serverNow) : 0} availableWorkers={state.village.population.available} onUpgrade={() => {}} onPrepareGardens={() => {
      closePanels(); setExploitationSettings(current => ({ ...current, filter: 'gardens' })); pushNotification('Outil Jardins prêt · glissez sur les parcelles à récolter.');
    }} onDiscover={() => void discoverSupplies(selectedBuilding.id)} />
    {selectedBuilding.type==='town-hall'&&state.village.market&&<MarketPanel key={selectedBuilding.id} slug={worldSlug} villageId={state.village.id} building={selectedBuilding} market={state.village.market} stocks={state.village.resources} serverNow={serverNow} revision={state.serverTime} pending={pendingAction} error={error}
      onCommand={command=>runAction(()=>commandMarket(worldSlug,state.village.id,command))}
      onUpgrade={()=>{const quote=upgradePreview(state,selectedSiteId);if(!quote||quote.error){setError(quote?.error??'Devis indisponible.');return;}
        void executeConstruction({kind:'upgrade',commandId:crypto.randomUUID(),worldSlug,villageId:state.village.id,buildingId:quote.buildingId,expectedCosts:quote.costs,expectedLevel:quote.nextLevel,success:'Amélioration de l’hôtel de ville lancée'});}}/>}
    {error&&selectedBuilding.type!=='town-hall'?<p className="error">{error}</p>:null}</WorldContextMenu> : null}
    {menuAnchor && selectedBuilding && worldMode === 'construction' ? <WorldContextMenu anchor={menuAnchor}><BuildingPanel mode="population" building={selectedBuilding} definition={state.buildingTypes.find((item) => item.code === selectedBuilding.type)!} serverNow={serverNow} pending={pendingAction} readyCarrots={selectedBuilding.garden ? gardenReady(selectedBuilding.garden, serverNow) : 0} availableWorkers={state.village.population.available} onUpgrade={() => {}} onPrepareGardens={() => {}} onDiscover={() => {}} /></WorldContextMenu> : null}
    {menuAnchor && selectedFeatureId && worldMode === 'exploitation' ? <WorldContextMenu anchor={menuAnchor}><DepositPanel details={depositDetails} loading={depositLoading} pending={pendingAction} onPrepare={(family, woodMode) => {
      closePanels(); setExploitationSettings(current => ({ ...current, filter: family, ...(woodMode ? { woodMode } : {}) }));
      pushNotification(`Outil ${family === 'wood' ? woodMode === 'clear' ? 'Défrichage' : 'Bois' : 'Pierre'} prêt · glissez dans le monde.`);
    }} />{error ? <p className="error">{error}</p> : null}</WorldContextMenu> : null}
    {terrainView === 'village' && worldMode === 'construction' && contextualConstruction ? <div hidden={paletteCollapsed}><ConstructionPanel houseVariant={houseVariant} upgrade={upgrade} construction={contextualConstruction} definitions={state.buildingTypes} area={area} costs={costs} error={selectionError ?? error} pending={pendingAction} gardenWorkerNeed={gardenWorkerNeed}
      intentState={constructionIntentState} onRetry={retryConstruction} onClearError={clearConstructionError}
      collapsed={paletteCollapsed} onToggle={() => setPaletteCollapsed(value => !value)} onChoose={(type,variant) => { clearConstructionError(); clearPreview(); if(variant)setHouseVariant(variant);setConstruction({ action: 'build', type }); }}
      domain={constructionDomain} factoryEnabled={import.meta.env.DEV&&Boolean(state.factoryEnabled)} onWorkshop={()=>{clearPreview();cancelWorldGesture();setWorkshop('buildings');}}
      infrastructure={<InfrastructureTools state={state} scene={terrainRef} active={constructionDomain==='infrastructure'&&!paletteCollapsed&&!showDev&&!workshop&&!arrivalActive} onSnapshot={applySnapshot} onWorkshop={()=>{clearPreview();cancelWorldGesture();setWorkshop('infrastructure');}}/>}
      onDomainChange={domain => { clearPreview(); clearConstructionError(); setConstructionDomain(domain);setConstruction({action:'build',type:null}); }} /></div> : null}
    {workshop&&<section className="factory-workshop" aria-label="Atelier"><button onClick={()=>setWorkshop(null)}>Retour au village</button>{state.factoryEnabled?<iframe title={`Atelier ${workshop}`} src={`/factory-preview.html?world=${encodeURIComponent(state.world.slug)}&domain=${workshop}`}/>:<p>L’accès aux ateliers a été désactivé.</p>}</section>}
  </main>;
}
