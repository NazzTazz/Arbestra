import { LevelingPanel } from './ui/LevelingPanel';
import { TerraformPanel } from './ui/TerraformPanel';
import type { LevelingRequest } from '@arbestra/contracts';
import { useObservationPublisher } from './observation';
import { clientTime, setStatisticsEnabled, statisticsEnabled, subscribeStatistics } from './dev/statistics';
import { useExpeditions } from './ui/use-expeditions';
import { useHarvestTool } from './ui/use-harvest-tool';
import { applyVillageFrame, latestVillageSnapshot, reconcileVillageSnapshot } from '@arbestra/contracts';
import { VillageSynchronization, villageRequestGeneration } from './api/village-sync';
import {
  acceptInfrastructurePresentation,
  currentInfrastructurePresentation,
  infrastructurePresentationState,
  type InfrastructurePresentation,
} from './api/infrastructure-presentation';
import {
  acceptConstructionPresentation,
  currentConstructionPresentation,
  constructionPresentationState,
} from './api/construction-presentation';
import { HarvestFeedbackLayer } from './ui/HarvestFeedback';
import { ExploitationShowroom, type ExploitationCategory } from './ui/ExploitationShowroom';
import { nearestExploitationTarget, type ExploitationChoice } from './ui/exploitation-navigation';
import type { StarterController } from './spawn-map/starter-controller';
import { StarterResume } from './spawn-map/StarterResume';
import { randomUUID } from './random-uuid';
import { RepresentativePanel } from './ui/RepresentativePanel';
import { ProcessingPanel } from './ui/ProcessingPanel';
import { MarketPanel } from './ui/MarketPanel';
import { commandPlayerMarket } from './api/client';
import { constructionCosts } from '@arbestra/contracts';
import { commandProcessing } from './api/client';
import { processingCommandBuilding, useVillageSyncV2 } from './api/processing-v2';
import { SYNC_V2_VILLAGE } from './api/sync-v2-initial';
import { SyncV2HttpError } from './api/sync-v2-transport';
import type { ProcessingCommand } from '@arbestra/contracts';
import { setFactoryEnabled } from './api/client';
import { InfrastructureTools } from './ui/InfrastructureTools';
import { DemolitionTool } from './ui/DemolitionTool';
import type { RepresentativeInfo } from './scene/village-workers';
import type { InhabitantCameraMode } from './scene/inhabitant-camera';
import { constructionContext, upgradePreview, sameUpgradeQuote, type UpgradePreview } from './ui/construction-intent';
import { discoverCatEyes } from './api/client';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { BuildingType, ConstructionConfirmation, DepositDetails, Garden, VillageState } from '@arbestra/contracts';
import type { TerrainHandle } from './scene/VillageScene';
import type { TerrainViewMode } from './scene/BabylonVillageScene';

import {
  ApiError,
  buildBuilding,
  changeWorksite,
  discoverOrRefreshSupplies,
  expandGarden,
  getStoneDepositDetails,
  getVillage,
  type TimedVillageState,
  type TimedVillageUpdate,
  type TimedInfrastructureConfirmation,
  upgradeBuilding,
} from './api/client';
import {
  campusRange,
  stonemasonRange,
  cellKey,
  previewArea,
  touchesCell,
  type Cell,
  type CellRange,
} from './scene/construction-selection';
import { ConstructionPanel, type ConstructionChoice, type ConstructionDomain } from './ui/ConstructionPanel';
import { Hud } from './ui/Hud';
import { usePresentationClock } from './ui/use-presentation-clock';
import { projectedWood } from './ui/resource-counter';
import { useResourceFeedback } from './ui/use-resource-feedback';
import { completedMarketTransactions, marketCommandDelivers } from './ui/market-deliveries';
import { WorldModeNavigation, type ActiveWorldMode } from './ui/world-mode';
import { WorldModeBar } from './ui/WorldModeBar';
import { ExploitationPalette, type ExploitationIntentState, type ExploitationSettings } from './ui/ExploitationPanel';
import { previewExploitation, startExploitation } from './api/client';
import type { ExploitationRequest, ExploitationPreview } from '@arbestra/contracts';
import { type GameNotification } from './ui/NotificationStack';
import { OracleJournal } from './ui/OracleJournal';
import { useOracleHint } from './ui/useOracleHint';
import { BuildingPanel, DepositPanel, WorksitePanel } from './ui/PlayerPanels';
import { HarvestCancelButton, WoodModeBubble, WoodModeIndicator } from './ui/WoodGestureHud';
import { DemolitionCancelButton, usePendingDemolition } from './ui/PendingDemolition';
import { WorkforceHud } from './ui/WorkforceHud';
import { type ScreenAnchor, WorldContextMenu } from './ui/WorldContextMenu';
import { SciencePanel } from './ui/SciencePanel';
import { commandScience } from './api/client';
import { commandLeveling, commandTerraform } from './api/client';
import { DevDrawer } from './ui/DevDrawer';
import {
  configuredExploitation,
  freezeExploitation,
  exploitationTargetKeys,
  pendingExploitationCap,
  directGardenExploitation,
} from './ui/exploitation-intent';

import { WorldLoading } from './ui/WorldLoading';
import type { InitialLoadProgress } from './scene/initial-village-load';
import { initialVillageRead, initialWorldName, requestedWorldSlug } from './api/initial-village';
import { worldPage } from './api/world-address';
let sceneModule: Promise<typeof import('./scene/VillageScene')> | undefined;
const loadScene = () => (sceneModule ??= import('./scene/VillageScene'));
const VillageScene = lazy(() => loadScene().then((module) => ({ default: module.VillageScene })));
const worldSlug = requestedWorldSlug;
const LOBBY_URL = import.meta.env.VITE_LOBBY_URL ?? `${window.location.protocol}//${window.location.hostname}:5173`;
const populationAnchor = (): ScreenAnchor => ({ x: window.innerWidth / 2, y: window.innerHeight - 220 });

type ConstructionCommand = {
  commandId: string;
  worldSlug: string;
  villageId: string;
  expectedCosts: Array<{ resourceCode: string; amount: number }>;
  success: string;
} & (
  | {
      kind: 'build';
      houseVariant: 'stone' | 'logs' | 'beams';
      buildingType: BuildingType;
      anchor: Cell;
      cells: Cell[];
      quarterTurns: number;
    }
  | {
      kind: 'expand';
      buildingId: string;
      cells: Cell[];
    }
  | {
      kind: 'upgrade';
      buildingId: string;
      expectedLevel: number;
    }
);
type ConstructionIntentState = 'idle' | 'submitting' | 'error' | 'uncertain';

const pendingExploitationKey = (villageId: string) => `arbestra:pending-exploitation:${worldSlug}:${villageId}`;
const pendingConstructionKey = (villageId: string) => `arbestra:pending-construction:${worldSlug}:${villageId}`;
const NO_PENDING_HARVESTS: Cell[] = [];
const NO_PENDING_TREES: Array<{ featureId: string; treeIndex: number | null }> = [];

function gardenReady(garden: Garden, serverNow: number): number {
  return garden.plots.reduce(
    (sum, plot) =>
      sum +
      Math.floor(
        Math.min(
          plot.capacity,
          plot.storedCarrots +
            (plot.productionPerHour * Math.max(0, serverNow - Date.parse(plot.productionUpdatedAt))) / 3_600_000,
        ),
      ),
    0,
  );
}

export function App({ starter }: { starter?: StarterController } = {}) {
  const beforeTownHall = starter?.beforeTownHall ?? false;
  const starterActive = Boolean(starter?.active);
  const [levelingPreview, setLevelingPreview] = useState<import('@arbestra/contracts').LevelingPreview | null>(null);
  const [leveling, setLeveling] = useState<Omit<LevelingRequest, 'workerCount'> | null>(null);
  const [canonicalState, setState] = useState<VillageState | null>(starter?.state ?? null);
  const [constructionPresentation, setConstructionPresentation] = useState<ConstructionConfirmation | null>(null);
  const constructionPresentationRef = useRef<ConstructionConfirmation | null>(null);
  const state = useMemo(
    () => constructionPresentationState(canonicalState, constructionPresentation),
    [canonicalState, constructionPresentation],
  );
  const resourceServerTime = canonicalState
    ? (currentConstructionPresentation(canonicalState, constructionPresentation)?.serverTime ??
      canonicalState.serverTime)
    : '';
  const observationActive = useObservationPublisher(starterActive ? null : canonicalState);
  const stateRef = useRef<VillageState | null>(starter?.state ?? null);
  const synchronization = useRef<VillageSynchronization | null>(null);
  const [infrastructurePresentation, setInfrastructurePresentation] = useState<InfrastructurePresentation | null>(null);
  const infrastructurePresentationRef = useRef<InfrastructurePresentation | null>(null);
  const sceneState = useMemo(
    () => (state ? infrastructurePresentationState(state, infrastructurePresentation) : null),
    [state, infrastructurePresentation],
  );
  const applyInfrastructureConfirmation = useCallback((update: TimedInfrastructureConfirmation) => {
    const current = stateRef.current;
    if (!current) return;
    // V2 publishes the committed plan itself; no V1-fenced overlay.
    if (villageV2Ref.current.ready) {
      villageV2Ref.current.refresh();
      return;
    }
    const result = acceptInfrastructurePresentation(
      current,
      infrastructurePresentationRef.current,
      update.confirmation,
      update.requestGeneration,
      villageRequestGeneration(),
    );
    if (result.kind === 'resync') {
      synchronization.current?.reconnect();
      return;
    }
    if (result.kind === 'applied') {
      infrastructurePresentationRef.current = result.presentation;
      setInfrastructurePresentation(result.presentation);
    }
  }, []);
  const refreshFlight = useRef<Promise<void> | null>(null);
  const initialFlight = useRef<Promise<TimedVillageState> | null>(null);
  const offsetRef = useRef(0);
  const [loading, setLoading] = useState(!starter);
  const [worldLabel, setWorldLabel] = useState(worldSlug);
  const [initialProgress, setInitialProgress] = useState<{ key: string; progress: InitialLoadProgress } | null>(null);
  const sceneKey = state ? `${state.world.id}:${state.world.generationVersion}:${state.village.id}` : '';
  const initialReady = initialProgress?.key === sceneKey && initialProgress.progress.phase === 'ready';
  const [needsLogin, setNeedsLogin] = useState(false);
  const expeditions = useExpeditions(worldSlug, state?.world.id, state?.village.id, !needsLogin && initialReady);
  const expireSession = useCallback(() => setNeedsLogin(true), []);
  // Set after the V2 hook below: once V2 owns the village, V1 responses only
  // trigger an immediate V2 delta read instead of replacing the state.
  const villageV2Ref = useRef<{
    ready: boolean;
    refresh: () => void;
    construct?: ReturnType<typeof useVillageSyncV2>['construct'];
    upgrade?: ReturnType<typeof useVillageSyncV2>['upgrade'];
    expand?: ReturnType<typeof useVillageSyncV2>['expand'];
    science?: ReturnType<typeof useVillageSyncV2>['science'];
    discoverSupplies?: ReturnType<typeof useVillageSyncV2>['discoverSupplies'];
    discoverCatEyes?: ReturnType<typeof useVillageSyncV2>['discoverCatEyes'];
    exploit?: ReturnType<typeof useVillageSyncV2>['exploit'];
    trade?: ReturnType<typeof useVillageSyncV2>['trade'];
    level?: ReturnType<typeof useVillageSyncV2>['level'];
    terraform?: ReturnType<typeof useVillageSyncV2>['terraform'];
    changeWorksite?: ReturnType<typeof useVillageSyncV2>['changeWorksite'];
  }>({ ready: false, refresh: () => {} });
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState(false);
  const actionInFlight = useRef(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [populationFocus, setPopulationFocus] = useState<string | null>(null);
  const [representativeId, setRepresentativeId] = useState<string | null>(null);
  const [representative, setRepresentative] = useState<RepresentativeInfo | null>(null);
  const [representativeView, setRepresentativeView] = useState<InhabitantCameraMode>('village');
  const [noclip, setNoclip] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [showScience, setShowScience] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<ScreenAnchor | null>(null);
  const [construction, setConstruction] = useState<ConstructionChoice | null>(
    starter ? { action: 'build', type: null } : null,
  );
  const [constructionDomain, setConstructionDomain] = useState<ConstructionDomain>('buildings');
  const [quarterTurns, setQuarterTurns] = useState(0);
  const [houseVariant, setHouseVariant] = useState<'stone' | 'logs' | 'beams'>('logs');
  const [workshop, setWorkshop] = useState<'buildings' | 'infrastructure' | null>(null);
  const [constructionIntentState, setConstructionIntentState] = useState<ConstructionIntentState>('idle');
  const constructionCommand = useRef<ConstructionCommand | null>(null);
  const [selection, setSelection] = useState<CellRange | null>(null);
  const touchOrigin = useRef<Cell | null>(null);
  const [notifications, setNotifications] = useState<GameNotification[]>([]);
  const resourceFeedback = useResourceFeedback();
  const showResourceChanges = resourceFeedback.showChanges;
  const notificationId = useRef(0);
  const notificationTimers = useRef<number[]>([]);
  const [depositDetails, setDepositDetails] = useState<DepositDetails | null>(null);
  const terrainRef = useRef<TerrainHandle>(null);
  const [depositLoading, setDepositLoading] = useState(false);
  const [showWorksites, setShowWorksites] = useState(false);
  const depositRequest = useRef(0);

  const [showGardens, setShowGardens] = useState(false);
  const [showTravelPaths, setShowTravelPaths] = useState(false);
  const [showDev, setShowDev] = useState(false);
  const showStatistics = useSyncExternalStore(subscribeStatistics, statisticsEnabled, () => false);
  const [cosmologyDebug, setCosmologyDebug] = useState(false);
  const [terrainView, setTerrainView] = useState<TerrainViewMode>('village');
  const [arrivalActive, setArrivalActive] = useState(false);
  const [oracleCat, setOracleCat] = useState(false);
  const [oracleProvisions, setOracleProvisions] = useState<{ villageKey: string; message: string } | null>(null);
  const catRequest = useRef(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  const pushNotification = useCallback((message: string, tone: GameNotification['tone'] = 'default') => {
    const id = notificationId.current++;
    setNotifications((current) => [{ id, message, tone }, ...current].slice(0, 3));
    notificationTimers.current.push(
      window.setTimeout(() => setNotifications((current) => current.filter((item) => item.id !== id)), 3_800),
    );
  }, []);
  useEffect(() => () => notificationTimers.current.forEach(window.clearTimeout), []);
  const markOracleProgress = useOracleHint(
    state ? `${state.world.id}:${state.village.id}` : null,
    state?.cells.some((cell) => cell.building?.hiddenSuppliesAvailable) ?? false,
    pendingAction,
    (message) => {
      if (state) setOracleProvisions({ villageKey: `${state.world.id}:${state.village.id}`, message });
    },
  );

  const starterRef = useRef(starter);
  starterRef.current = starter;
  const applySnapshot = useCallback(
    (update: TimedVillageUpdate) => {
      return clientTime('apply', () => {
        const previous = stateRef.current;
        if (update.requestGeneration !== undefined && update.requestGeneration !== villageRequestGeneration()) return;
        let snapshot: TimedVillageState;
        if ('frame' in update) {
          if (!previous) {
            synchronization.current?.reconnect();
            return;
          }
          const result = applyVillageFrame(previous, update.frame);
          if (result.kind === 'resync') {
            synchronization.current?.reconnect();
            return;
          }
          if (result.kind !== 'applied') return;
          snapshot = {
            state: result.state,
            serverOffsetMs: update.serverOffsetMs,
            ...(update.requestGeneration !== undefined ? { requestGeneration: update.requestGeneration } : {}),
          };
        } else snapshot = update;
        const fromV2 = 'state' in update && update.source === 'v2';
        if (!fromV2 && villageV2Ref.current.ready) {
          villageV2Ref.current.refresh();
          return;
        }
        if (
          previous &&
          (previous.world.id !== snapshot.state.world.id || previous.village.id !== snapshot.state.village.id)
        )
          return;
        // The V2 session orders its own states; V1 revisions do not apply to them.
        if (!fromV2) {
          if (previous?.syncRevision !== undefined) {
            if (snapshot.state.syncRevision === undefined) {
              synchronization.current?.reconnect();
              return;
            }
          }
          if (previous && latestVillageSnapshot(previous, snapshot.state) === previous) return;
        }
        snapshot = { ...snapshot, state: reconcileVillageSnapshot(previous, snapshot.state) };
        if (previous) {
          if (previous.science && snapshot.state.science) {
            const before = previous.science,
              after = snapshot.state.science;
            if (
              !before.programs.some((p) => p.code === 'astronomy-1' && !['available', 'blocked'].includes(p.status)) &&
              after.programs.some((p) => p.code === 'astronomy-1' && !['available', 'blocked'].includes(p.status))
            )
              pushNotification(
                'Les récits des habitants intriguent les chercheurs : une campagne astronomique commence.',
              );
            for (const program of after.programs)
              if (
                program.status === 'acquired' &&
                !before.programs.some((p) => p.code === program.code && p.status === 'acquired')
              )
                pushNotification(
                  program.code === 'astronomy-1'
                    ? 'Le monde est annulaire. Dézoome pour découvrir sa forme.'
                    : `Connaissance acquise : ${program.title}`,
                );
          }
          const priorAccomplishments = new Set(previous.village.accomplishments.map((item) => item.code));
          if (
            snapshot.state.village.accomplishments.some(
              (item) => item.code === 'cat-eyes' && !priorAccomplishments.has(item.code),
            )
          )
            setOracleCat(true);
          if (
            snapshot.state.village.accomplishments.some(
              (item) => item.code === 'town-hall-supplies' && !priorAccomplishments.has(item.code),
            )
          )
            pushNotification("Oracle — Un coffre, 2 000 carottes, et personne n'avait regardé. Admirable.");
          if (
            snapshot.state.village.accomplishments.some(
              (item) => item.code === 'first-harvest' && !priorAccomplishments.has(item.code),
            )
          )
            pushNotification('Oracle — Votre première récolte ! Ces carottes-là, vous les avez méritées.');
          const prior = new Map(
            previous.cells.flatMap((cell) => (cell.building ? [[cell.building.id, cell.building] as const] : [])),
          );
          if (
            snapshot.state.village.accomplishments.some(
              (item) => item.code === 'first-woodcut' && !priorAccomplishments.has(item.code),
            )
          )
            pushNotification('Oracle — Du bois pour le village, et un peu plus de ciel entre les branches.');
          for (const cell of snapshot.state.cells) {
            if (cell.building?.status === 'completed' && prior.get(cell.building.id)?.status === 'under-construction')
              pushNotification('Construction terminée');
          }
        }
        showResourceChanges(previous, snapshot.state);
        // Same pair as the "+N": the column rises with the credited amounts.
        const deliveries = completedMarketTransactions(previous, snapshot.state);
        if (deliveries) terrainRef.current?.marketBeacon(deliveries);
        const presentation = currentInfrastructurePresentation(snapshot.state, infrastructurePresentationRef.current);
        if (presentation !== infrastructurePresentationRef.current) {
          infrastructurePresentationRef.current = presentation;
          setInfrastructurePresentation(presentation);
        }
        const confirmed = currentConstructionPresentation(snapshot.state, constructionPresentationRef.current);
        if (confirmed !== constructionPresentationRef.current) {
          constructionPresentationRef.current = confirmed;
          setConstructionPresentation(confirmed);
        }
        stateRef.current = snapshot.state;
        setState(snapshot.state);
        starterRef.current?.onSnapshot(snapshot.state);
        setServerOffsetMs(snapshot.serverOffsetMs);
        offsetRef.current = snapshot.serverOffsetMs;
      });
    },
    [pushNotification, showResourceChanges],
  );

  const villageV2Mode = SYNC_V2_VILLAGE && !starterActive;
  const villageV2 = useVillageSyncV2({
    worldSlug,
    worldId: state?.world.id,
    villageId: state?.village.id,
    enabled: initialReady && !needsLogin && !beforeTownHall,
    village: villageV2Mode,
    onState: applySnapshot,
    onExpired: expireSession,
    onNotice: pushNotification,
  });
  // Road cells are V2-native: the tool waits for the V2 village session.
  const roadCellsApi = useMemo(
    () =>
      villageV2Mode && villageV2.villageReady
        ? { command: villageV2.roadCells, preview: villageV2.previewRoadCells }
        : null,
    [villageV2Mode, villageV2.villageReady, villageV2.roadCells, villageV2.previewRoadCells],
  );
  // Demolition is V2-native too (docs/SPEC-DEMOLITION.md §9).
  const demolish = villageV2Mode && villageV2.villageReady ? villageV2.demolish : null;
  // The waiting order survives mode and tool changes, not a change of village.
  const pendingDemolition = usePendingDemolition({
    demolish,
    villageKey: state ? `${state.world.id}:${state.village.id}` : '',
    onNotice: pushNotification,
    onSettled: () => terrainRef.current?.demolitionClear(),
  });
  const roadAnchorsApi = useMemo(
    () =>
      villageV2Mode && villageV2.villageReady
        ? { command: villageV2.roadAnchors, preview: villageV2.previewRoadAnchors }
        : null,
    [villageV2Mode, villageV2.villageReady, villageV2.roadAnchors, villageV2.previewRoadAnchors],
  );
  villageV2Ref.current = {
    ready: villageV2Mode && villageV2.villageReady,
    refresh: villageV2.refresh,
    construct: villageV2.construct,
    upgrade: villageV2.upgrade,
    expand: villageV2.expand,
    science: villageV2.science,
    discoverSupplies: villageV2.discoverSupplies,
    discoverCatEyes: villageV2.discoverCatEyes,
    exploit: villageV2.exploit,
    trade: villageV2.trade,
    level: villageV2.level,
    terraform: villageV2.terraform,
    changeWorksite: villageV2.changeWorksite,
  };
  const discoverEyes = useCallback(async () => {
    const current = stateRef.current;
    if (!current || catRequest.current || current.village.accomplishments.some((item) => item.code === 'cat-eyes'))
      return;
    catRequest.current = true;
    try {
      const v2 = villageV2Ref.current;
      // On V2 the confirmation's effects carry the accomplishment.
      if (v2.ready && v2.discoverCatEyes) {
        await v2.discoverCatEyes();
        return;
      }
      const result = await discoverCatEyes(current.world.slug, current.village.id);
      if (stateRef.current?.village.id !== current.village.id) return;
      applySnapshot(result);
    } catch {
      /* The scene retries only while a valid observation continues. */
    } finally {
      catRequest.current = false;
    }
  }, [applySnapshot]);

  useEffect(() => {
    if (!starter) return;
    if (starter.beforeTownHall) {
      stateRef.current = starter.state;
      setState(starter.state);
    } else {
      if (
        stateRef.current?.village.id !== starter.state.village.id ||
        stateRef.current.world.id !== starter.state.world.id
      ) {
        synchronization.current?.close();
        synchronization.current = null;
        stateRef.current = null;
      }
      applySnapshot({ state: starter.state, serverOffsetMs: offsetRef.current });
    }
    setLoading(false);
  }, [starter?.state, starter?.beforeTownHall, applySnapshot]);

  const [worldMode, setWorldMode] = useState<ActiveWorldMode>(starter ? 'construction' : 'exploration');
  const [paletteCollapsed, setPaletteCollapsed] = useState(!starter);
  const modeNavigation = useRef(new WorldModeNavigation());
  const modeRef = useRef(worldMode);
  modeRef.current = worldMode;
  const [exploitationSettings, setExploitationSettings] = useState<ExploitationSettings>(() => {
    const fallback: ExploitationSettings = {
      workerMode: 'auto',
      workerCap: 10,
      durationMs: null,
      cohortId: null,
      filter: 'all',
      woodMode: 'cut',
      detailed: false,
      activityCaps: { gardens: 1, wood: 10, stone: 10 },
      activityDurations: { gardens: null, wood: null, stone: null },
    };
    return fallback;
  });
  const [mixedRequest, setMixedRequest] = useState<ExploitationRequest | null>(null);
  const [mixedPreview, setMixedPreview] = useState<ExploitationPreview | null>(null);
  const mixedPreviewCommand = useRef<string | null>(null);
  const exploitationPreviewFlight = useRef<Promise<void>>(Promise.resolve());
  const [, setMixedUncertain] = useState(false);
  const [exploitationIntentState, setExploitationIntentState] = useState<ExploitationIntentState>('idle');
  const uncertainRequest = useRef<ExploitationRequest | null>(null);
  const recoveredVillage = useRef<string | null>(null);
  const mixedGesture = useRef<{
    request: ExploitationRequest;
    filter: ExploitationSettings['filter'];
    deferred: boolean;
    cells: Cell[];
  } | null>(null);
  const exploitationActive = useRef(false);
  const exploitationQueue = useRef<Array<{ request: ExploitationRequest; cells: Cell[] }>>([]);
  const [queuedExploitationCount, setQueuedExploitationCount] = useState(0);
  const [queuedExploitationCells, setQueuedExploitationCells] = useState<Cell[]>([]);
  const releasedExploitation = useRef<string | null>(null);
  const releasedExploitationCap = useRef<number | null>(null);
  const [hoveredBuildingId, setHoveredBuildingId] = useState<string | null>(null);
  const shownUpgrade = useRef<UpgradePreview | null>(null);
  const presentedArea = useRef<{
    cells: Cell[];
    costs: Array<{ resourceCode: string; amount: number }>;
    buildingId: string | undefined;
    quarterTurns: number;
    houseVariant: string;
  } | null>(null);
  const hoveredExploitation = useRef<{ key: string; settings: string; request: ExploitationRequest } | null>(null);
  const presentedExploitation = useRef<{ commandId: string; preview: ExploitationPreview } | null>(null);
  const acceptedExploitation = useRef(new Set<string>());
  const settingsContext = useRef<string | null>(null);
  const [mixedCells, setMixedCells] = useState<Cell[]>([]);
  const [exploitationCategory, setExploitationCategory] = useState<ExploitationCategory>('exploit');
  const [artisanChoice, setArtisanChoice] = useState<'sawmill' | 'stonemason' | null>(null);
  const harvest = useHarvestTool({
    state,
    scene: terrainRef,
    slug: worldSlug,
    woodMode: exploitationSettings.woodMode,
    enabled:
      worldMode === 'exploitation' &&
      exploitationCategory === 'exploit' &&
      !paletteCollapsed &&
      terrainView === 'village' &&
      !arrivalActive &&
      !showDev &&
      !uncertainRequest.current,
    onAccepted: () => markOracleProgress(),
  });
  // The wood tool (docs/SPEC-GRAMMAIRE-GESTUELLE.md): its mode shows while it is in use.
  const woodToolActive =
    worldMode === 'exploitation' &&
    exploitationCategory === 'exploit' &&
    harvest.filter === 'wood' &&
    !paletteCollapsed &&
    terrainView === 'village' &&
    !uncertainRequest.current;
  const [woodModeBubble, setWoodModeBubble] = useState<{
    mode: 'cut' | 'clear';
    x: number;
    y: number;
    at: number;
  } | null>(null);
  /** A long press switches cutting and clearing, globally; it applies to the wood tool only. */
  function toggleWoodMode(point: { x: number; y: number }): boolean {
    if (!woodToolActive) return false;
    const mode = exploitationSettings.woodMode === 'clear' ? 'cut' : 'clear';
    setExploitationSettings((current) => ({ ...current, woodMode: mode }));
    setWoodModeBubble({ mode, x: point.x, y: point.y, at: Date.now() });
    try {
      navigator.vibrate?.(30);
    } catch {
      /* Vibration is optional. */
    }
    return true;
  }
  // Leaving Exploitation puts the wood tool back to cutting (Tristan, 29 October):
  // coming back, a player never clears without having asked for it again.
  useEffect(() => {
    if (worldMode !== 'exploitation')
      setExploitationSettings((current) => (current.woodMode === 'cut' ? current : { ...current, woodMode: 'cut' }));
  }, [worldMode]);
  const chooseExploitation = (choice: ExploitationChoice) => {
    cancelWorldGesture();
    closePanels();
    if (choice === 'gardens' || choice === 'wood' || choice === 'stone') harvest.setFilter(choice);
    else setArtisanChoice(choice);
    const current = stateRef.current;
    if (!current) return;
    const target = nearestExploitationTarget(
      current,
      choice,
      terrainRef.current?.viewCenter() ?? { cellX: current.village.anchorCellX, cellY: current.village.anchorCellY },
      terrainRef.current?.naturalFeatures() ?? current.region.features,
    );
    if (target) terrainRef.current?.focusCell(target);
    else
      pushNotification(
        choice === 'sawmill'
          ? 'Aucune scierie repérée.'
          : choice === 'stonemason'
            ? 'Aucun tailleur de pierre repéré.'
            : choice === 'gardens'
              ? 'Aucun jardin repéré.'
              : choice === 'wood'
                ? 'Aucun bosquet repéré.'
                : 'Aucun gisement de pierre repéré.',
      );
  };
  const pendingHarvestCells = useMemo(
    () => [...harvest.pendingCells, ...mixedCells, ...queuedExploitationCells],
    [harvest.pendingCells, mixedCells, queuedExploitationCells],
  );
  const pendingHarvestKeys = useMemo(() => new Set(pendingHarvestCells.map(cellKey)), [pendingHarvestCells]);
  useEffect(() => {
    if (!state) return;
    const key = `arbestra:exploitation-settings:${state.world.id}:${state.village.id}`;
    if (settingsContext.current !== key) {
      settingsContext.current = key;
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
        if (saved) setExploitationSettings((current) => ({ ...current, ...saved, cohortId: null, woodMode: 'cut' }));
      } catch {
        /* Invalid preferences never authorize a command. */
      }
      return;
    }
    sessionStorage.setItem(key, JSON.stringify({ ...exploitationSettings, cohortId: null, woodMode: 'cut' }));
  }, [state?.village.id, exploitationSettings]);
  useEffect(() => {
    presentedExploitation.current =
      mixedRequest && mixedPreview && mixedPreviewCommand.current === mixedRequest.commandId
        ? { commandId: mixedRequest.commandId, preview: mixedPreview }
        : null;
    if (
      mixedRequest &&
      mixedPreview &&
      mixedPreviewCommand.current === mixedRequest.commandId &&
      exploitationIntentState === 'selecting'
    )
      for (const key of exploitationTargetKeys(mixedPreview)) acceptedExploitation.current.add(key);
    if (
      mixedRequest &&
      mixedPreview &&
      presentedExploitation.current &&
      releasedExploitation.current === mixedRequest.commandId
    )
      finalizeReleasedExploitation(mixedRequest);
  }, [mixedRequest, mixedPreview, exploitationIntentState]);
  useEffect(() => {
    if (
      ['error', 'preview-required', 'confirm-clear', 'uncertain'].includes(exploitationIntentState) ||
      constructionIntentState === 'uncertain' ||
      constructionIntentState === 'error'
    )
      setPaletteCollapsed(false);
  }, [exploitationIntentState, constructionIntentState]);
  const previewRequest =
    ['submitting', 'uncertain', 'confirm-clear'].includes(exploitationIntentState) ||
    (mixedRequest && directGardenExploitation(mixedRequest))
      ? null
      : mixedRequest;
  useEffect(() => {
    if (!previewRequest || !stateRef.current) return;
    const mixedRequest = previewRequest;
    let cancelled = false;
    setMixedPreview(null);
    mixedPreviewCommand.current = null;
    const villageId = stateRef.current.village.id;
    const timer = window.setTimeout(() => {
      const previous = exploitationPreviewFlight.current;
      exploitationPreviewFlight.current = (async () => {
        await previous;
        if (cancelled) return;
        try {
          const preview = await previewExploitation(worldSlug, villageId, mixedRequest, AbortSignal.timeout(15_000));
          if (!cancelled) {
            mixedPreviewCommand.current = mixedRequest.commandId;
            setMixedPreview(preview);
          }
        } catch (reason) {
          if (!cancelled) {
            hoveredExploitation.current = null;
            setError(reason instanceof Error ? reason.message : 'Aperçu indisponible.');
            if (releasedExploitation.current === mixedRequest.commandId) {
              releasedExploitation.current = null;
              setExploitationIntentState('error');
            } else setExploitationIntentState((current) => (current === 'preview-required' ? 'error' : current));
          }
        }
      })();
    }, 90);
    // Aborting fetch does not cancel the server transaction: finish the running
    // preview, discard its result, then calculate only the latest selection.
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [previewRequest]);

  const refresh = useCallback(async () => {
    if (beforeTownHall || !initialReady) return;
    if (villageV2Ref.current.ready) {
      villageV2Ref.current.refresh();
      return;
    }
    if (synchronization.current) {
      synchronization.current.reconnect();
      return;
    }
    if (actionInFlight.current) return;
    if (refreshFlight.current) return refreshFlight.current;
    refreshFlight.current = (async () => {
      try {
        applySnapshot(await getVillage(worldSlug, stateRef.current?.village.id));
      } catch {
        /* Background refresh is best effort. */
      }
    })().finally(() => {
      refreshFlight.current = null;
    });
    return refreshFlight.current;
  }, [applySnapshot, beforeTownHall, initialReady]);

  useEffect(() => {
    void loadScene().catch(() => {});
    if (starter) return;
    let cancelled = false;
    initialFlight.current ??= initialVillageRead();
    void initialWorldName().then((name) => {
      if (!cancelled && name) setWorldLabel(name);
    });
    void initialFlight.current
      .then((snapshot) => {
        if (!cancelled) applySnapshot(snapshot);
      })
      .catch((reason) => {
        if (cancelled) return;
        if (reason instanceof ApiError && reason.status === 401) setNeedsLogin(true);
        else setError(reason instanceof Error ? reason.message : 'Chargement impossible.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applySnapshot]);
  useEffect(() => {
    if (!state || recoveredVillage.current === state.village.id) return;
    recoveredVillage.current = state.village.id;
    try {
      const exploitation = JSON.parse(
        sessionStorage.getItem(pendingExploitationKey(state.village.id)) ?? 'null',
      ) as ExploitationRequest | null;
      if (exploitation?.commandId) {
        uncertainRequest.current = exploitation;
        setMixedRequest(exploitation);
        setExploitationIntentState('uncertain');
        pushNotification('Un ordre d’exploitation envoyé reste à vérifier.', 'warning');
      }
      const construction = JSON.parse(
        sessionStorage.getItem(pendingConstructionKey(state.village.id)) ?? 'null',
      ) as ConstructionCommand | null;
      if (
        construction?.commandId &&
        construction.worldSlug === state.world.slug &&
        construction.villageId === state.village.id
      ) {
        constructionCommand.current = construction;
        setConstructionIntentState('uncertain');
        pushNotification('Une commande de construction envoyée reste à vérifier.', 'warning');
      }
    } catch {
      /* A malformed session hint is ignored; server state remains authoritative. */
    }
  }, [state?.village.id, pushNotification]);
  // Idle exploration/exploitation needs no application-wide one-second render.
  // The wood counter owns its clock; visible countdowns and quotes retain theirs.
  const livePanelClock = Boolean(
    (menuAnchor && selectedSiteId) ||
      showScience ||
      showWorksites ||
      (worldMode === 'construction' && !paletteCollapsed),
  );
  const now = usePresentationClock(livePanelClock);

  // V1 stream only while V2 does not own the village (or is unavailable).
  const villageV1Stream = !villageV2Mode || villageV2.status === 'unavailable';
  useEffect(() => {
    if (
      !villageV1Stream ||
      !initialReady ||
      needsLogin ||
      beforeTownHall ||
      !state ||
      state.village.id !== stateRef.current?.village.id
    )
      return;
    const stream = new VillageSynchronization(state.world.slug, state.world.id, state.village.id, {
      current: () => stateRef.current,
      onExpeditionReceipt: expeditions.receive,
      accept: applySnapshot,
      offset: () => offsetRef.current,
      onExpired: () => setNeedsLogin(true),
    });
    synchronization.current = stream;
    return () => {
      stream.close();
      if (synchronization.current === stream) synchronization.current = null;
    };
  }, [
    state?.world.id,
    state?.village.id,
    beforeTownHall,
    needsLogin,
    applySnapshot,
    expeditions.receive,
    initialReady,
    villageV1Stream,
  ]);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    return () => {
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
    };
  }, [refresh]);

  const inspectedFeature = selectedFeatureId
    ? (terrainRef.current?.naturalFeatures().find((f) => f.id === selectedFeatureId) ??
      state?.region.features.find((f) => f.id === selectedFeatureId))
    : undefined;
  const depositUnmapped = inspectedFeature?.deposit === null;
  const loadDeposit = useCallback(async (featureId: string) => {
    if (!stateRef.current) return;
    const request = ++depositRequest.current;
    setDepositLoading(true);
    try {
      const details = await getStoneDepositDetails(worldSlug, stateRef.current.village.id, featureId);
      if (request !== depositRequest.current) return;
      terrainRef.current?.acceptDeposit(details.deposit);
      setDepositDetails(details);
    } catch (reason) {
      if (request === depositRequest.current)
        setError(reason instanceof Error ? reason.message : 'Inspection impossible.');
    } finally {
      if (request === depositRequest.current) setDepositLoading(false);
    }
  }, []);
  useEffect(() => {
    // Public scenery may have no player-known deposit. Do not issue a request
    // that the same authoritative knowledge policy will necessarily refuse.
    depositRequest.current++;
    setDepositDetails(null);
    setDepositLoading(false);
    if (selectedFeatureId && !depositUnmapped) void loadDeposit(selectedFeatureId);
  }, [selectedFeatureId, depositUnmapped, loadDeposit]);

  const selectedSite = useMemo(
    () => state?.cells.find((cell) => cell.id === selectedSiteId) ?? null,
    [selectedSiteId, state],
  );
  const selectedBuilding = useMemo(
    () =>
      selectedSite?.building ??
      (selectedSite?.footprint
        ? (state?.cells.find((cell) => cell.building?.id === selectedSite.footprint?.buildingId)?.building ?? null)
        : null),
    [selectedSite, state],
  );
  const processingOrders = villageV2.status === 'ready' ? villageV2.orders : (state?.village.processingOrders ?? []);
  const gardenSites = useMemo(
    () =>
      state?.cells.filter((cell) => cell.building?.garden).sort((a, b) => a.cellX - b.cellX || a.cellY - b.cellY) ?? [],
    [state],
  );
  useEffect(() => {
    if (showGardens && gardenSites.length === 1) {
      setSelectedSiteId(gardenSites[0]!.id);
      setShowGardens(false);
    }
  }, [showGardens, gardenSites]);
  const definition = state?.buildingTypes.find((item) => item.code === construction?.type);
  const context =
    state && selection && construction?.type
      ? constructionContext(state, construction.type, selection.first, selection.last)
      : null;
  const contextualConstruction = construction
    ? {
        type: construction.type,
        action: context?.action ?? 'build',
        ...(context?.buildingId ? { buildingId: context.buildingId } : {}),
      }
    : null;
  const extensionId = context?.action === 'extend' ? context.buildingId : undefined;
  const spatial = definition?.progressionMode === 'spatial';
  const area = useMemo(
    () =>
      state && selection && context?.action !== 'upgrade'
        ? previewArea(
            state,
            construction?.type === 'university'
              ? campusRange(selection.last, quarterTurns)
              : construction?.type === 'stonemason'
                ? stonemasonRange(selection.last, quarterTurns)
                : selection,
            spatial || construction?.type === 'university' || construction?.type === 'stonemason',
            extensionId,
            construction?.type ?? undefined,
          )
        : null,
    [state, selection, spatial, extensionId, construction?.type, context?.action, quarterTurns],
  );
  const highlightedSiteIds = useMemo(() => {
    if (!state || !construction?.buildingId) return [];
    const active = state.cells.filter(
      (cell) => cell.footprint?.buildingId === construction.buildingId && cell.footprint?.state === 'active',
    );
    return state.cells
      .filter((cell) => cell.canBuild && active.some((other) => touchesCell(cell, other, state.world)))
      .map(cellKey);
  }, [state, construction?.buildingId]);
  const level = extensionId
    ? (state?.cells.find((cell) => cell.building?.id === extensionId)?.building?.level ?? 1)
    : 1;
  const costs = constructionCosts(
    definition?.levels.find((item) => item.level === level),
    houseVariant,
  ).map((cost) => ({ ...cost, amount: cost.amount * (spatial ? (area?.count ?? 0) : 1) }));
  const serverNow = now + serverOffsetMs;
  const displayedWood = state ? projectedWood(state.village, resourceServerTime, serverNow) : 0;
  const affordable = costs.every(
    (cost) =>
      cost.amount <=
      (cost.resourceCode === 'wood'
        ? displayedWood
        : (state?.village.resources.find((resource) => resource.code === cost.resourceCode)?.amount ?? 0)),
  );
  const selectionError = area?.error ?? (area && !affordable ? 'Ressources insuffisantes.' : null);
  const existingGardenCells = extensionId
    ? (state?.cells.filter((cell) => cell.footprint?.buildingId === extensionId && cell.footprint?.state === 'active')
        .length ?? 0)
    : 0;
  const gardenWorkerNeed = spatial && area ? existingGardenCells + area.count : null;

  const upgrade =
    state && context?.action === 'upgrade' ? upgradePreview(state, context.siteId ?? hoveredBuildingId) : null;
  useEffect(() => {
    shownUpgrade.current = paletteCollapsed ? null : upgrade;
  });
  useEffect(() => {
    presentedArea.current = area
      ? { cells: area.cells, costs, buildingId: extensionId, quarterTurns, houseVariant }
      : null;
  });

  function closePanels() {
    terrainRef.current?.selectRepresentative(null);
    setRepresentativeId(null);
    setRepresentative(null);
    setRepresentativeView('village');
    depositRequest.current++;
    setSelectedSiteId(null);
    setSelectedFeatureId(null);
    setDepositDetails(null);
    setShowJournal(false);
    setShowGardens(false);
    setMenuAnchor(null);
  }
  function clearPreview() {
    terrainRef.current?.cancelGesture();
    setHoveredBuildingId(null);
    shownUpgrade.current = null;
    presentedArea.current = null;
    touchOrigin.current = null;
    setSelection(null);
    setError(null);
  }
  function exitConstruction() {
    setConstruction(null);
    clearPreview();
  }
  async function runAction(
    action: () => Promise<TimedVillageUpdate | void>,
    success?: string,
    exit = false,
  ): Promise<boolean> {
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    setPendingAction(true);
    setError(null);
    try {
      // A V2 gesture has already updated the session through its effects.
      const result = await action();
      if (result) applySnapshot(result);
      markOracleProgress();
      if (exit) exitConstruction();
      if (success) pushNotification(success);
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Action impossible.';
      setError(message);
      pushNotification(message, 'warning');
      return false;
    } finally {
      actionInFlight.current = false;
      setPendingAction(false);
    }
  }

  async function runProcessing(command: ProcessingCommand): Promise<boolean> {
    if (villageV2.status !== 'ready')
      return runAction(() => commandProcessing(worldSlug, stateRef.current!.village.id, command));
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    setPendingAction(true);
    setError(null);
    try {
      await villageV2.command(command);
      markOracleProgress();
      return true;
    } catch (reason) {
      // Unknown outcomes keep the same UUID; the panel offers to verify it.
      const message =
        reason instanceof SyncV2HttpError && reason.code === 'SCOPE_CATCHING_UP'
          ? 'Le village rattrape son retard. Vérifiez la même commande dans un instant.'
          : reason instanceof Error && reason.name === 'AbortError'
            ? 'Réponse interrompue. Vérifiez la même commande.'
            : reason instanceof Error
              ? reason.message
              : 'Action impossible.';
      setError(message);
      pushNotification(message, 'warning');
      return false;
    } finally {
      actionInFlight.current = false;
      setPendingAction(false);
    }
  }

  async function executeConstruction(command: ConstructionCommand): Promise<void> {
    if (actionInFlight.current) return;
    constructionCommand.current = command;
    actionInFlight.current = true;
    setPendingAction(true);
    setError(null);
    setConstructionIntentState('submitting');
    sessionStorage.setItem(pendingConstructionKey(command.villageId), JSON.stringify(command));
    try {
      const current = stateRef.current;
      const syncBase =
        current?.village.id === command.villageId &&
        current.world.slug === command.worldSlug &&
        current.syncRevision !== undefined
          ? { revision: current.syncRevision, serverTime: current.serverTime }
          : undefined;
      const v2 = villageV2Ref.current;
      // Construction commands on the V2 contract: their ACK effects update the
      // village; a new footprint also rereads the presentation.
      if (command.kind === 'upgrade' && v2.ready && v2.upgrade)
        await v2.upgrade(command.buildingId, {
          commandId: command.commandId,
          expectedCosts: command.expectedCosts,
          expectedLevel: command.expectedLevel,
        });
      else if (command.kind === 'expand' && v2.ready && v2.expand)
        await v2.expand(command.buildingId, {
          commandId: command.commandId,
          cells: command.cells,
          expectedCosts: command.expectedCosts,
        });
      else if (command.kind === 'build' && v2.ready && v2.construct)
        await v2.construct({
          commandId: command.commandId,
          buildingType: command.buildingType,
          anchorCellX: command.anchor.cellX,
          anchorCellY: command.anchor.cellY,
          cells: command.cells,
          expectedCosts: command.expectedCosts,
          quarterTurns: command.quarterTurns ?? 0,
          houseVariant: command.houseVariant ?? 'stone',
        });
      else {
        const snapshot =
          command.kind === 'build'
            ? await buildBuilding(
                command.worldSlug,
                command.villageId,
                command.buildingType,
                command.anchor,
                command.cells,
                command.commandId,
                command.expectedCosts,
                command.quarterTurns,
                command.houseVariant,
                syncBase,
              )
            : command.kind === 'expand'
              ? await expandGarden(
                  command.worldSlug,
                  command.villageId,
                  command.buildingId,
                  command.cells,
                  command.commandId,
                  command.expectedCosts,
                  syncBase,
                )
              : await upgradeBuilding(
                  command.worldSlug,
                  command.villageId,
                  command.buildingId,
                  command.commandId,
                  command.expectedCosts,
                  command.expectedLevel,
                  syncBase,
                );
        if ('construction' in snapshot && villageV2Ref.current.ready) villageV2Ref.current.refresh();
        else if ('construction' in snapshot) {
          const current = stateRef.current;
          if (current) {
            const confirmed = acceptConstructionPresentation(
              current,
              constructionPresentationRef.current,
              snapshot.construction,
              snapshot.requestGeneration,
              villageRequestGeneration(),
            );
            constructionPresentationRef.current = confirmed;
            setConstructionPresentation(confirmed);
          }
        } else applySnapshot(snapshot);
      }
      markOracleProgress();
      clearPreview();
      sessionStorage.removeItem(pendingConstructionKey(command.villageId));
      constructionCommand.current = null;
      setConstructionIntentState('idle');
      pushNotification(command.success);
    } catch (reason) {
      const message =
        reason instanceof Error && reason.name === 'TimeoutError'
          ? 'Réponse trop longue. Vérifiez la même commande.'
          : reason instanceof Error
            ? reason.message
            : 'Commande de construction impossible.';
      setError(message);
      pushNotification(message, 'warning');
      if ((reason instanceof ApiError || reason instanceof SyncV2HttpError) && reason.status < 500) {
        sessionStorage.removeItem(pendingConstructionKey(command.villageId));
        setConstructionIntentState('error');
      } else setConstructionIntentState('uncertain');
    } finally {
      actionInFlight.current = false;
      setPendingAction(false);
    }
  }

  function retryConstruction() {
    const previous = constructionCommand.current;
    if (!previous || actionInFlight.current) return;
    const command = constructionIntentState === 'uncertain' ? previous : { ...previous, commandId: randomUUID() };
    void executeConstruction(command);
  }

  function clearConstructionError() {
    if (constructionIntentState === 'uncertain') return;
    constructionCommand.current = null;
    setConstructionIntentState('idle');
    setError(null);
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!initialReady || leveling) return;
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (actionInFlight.current && !(event.key === 'Escape' && exploitationActive.current))
      )
        return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest('input, textarea, select')) return;
      if (starterActive && modeRef.current === 'construction') {
        if (event.key.toLowerCase() === 'r') {
          starter?.onRotate();
          event.preventDefault();
          return;
        }
        if (event.key === 'Escape') {
          starter?.onManual();
          event.preventDefault();
          return;
        }
      }
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        chooseMode(modeRef.current === 'construction' ? 'exploration' : 'construction');
      }
      if (
        event.key.toLowerCase() === 'r' &&
        !event.repeat &&
        modeRef.current === 'construction' &&
        constructionDomain === 'buildings' &&
        construction?.type &&
        !paletteCollapsed &&
        !workshop
      ) {
        event.preventDefault();
        setQuarterTurns((t) => (t + 1) % 4);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (exploitationIntentState === 'uncertain' || constructionIntentState === 'uncertain') {
          setPaletteCollapsed(true);
          return;
        }
        if (harvest.hasDraft() || mixedRequest || selection || mixedGesture.current) {
          cancelWorldGesture();
          return;
        }
        if (
          representativeId ||
          selectedSiteId ||
          selectedFeatureId ||
          showJournal ||
          showScience ||
          showWorksites ||
          showGardens
        ) {
          closePanels();
          setShowScience(false);
          setShowWorksites(false);
          return;
        }
        if (modeRef.current === 'construction' && construction?.type) {
          clearPreview();
          setConstruction({ action: construction.action, type: construction.action === 'extend' ? 'garden' : null });
          return;
        }
        setPaletteCollapsed(true);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => {
    if (representativeId) return;
    if (!selectedSiteId && !selectedFeatureId && !populationFocus) return;
    const timer = window.setInterval(() => {
      const current = stateRef.current;
      const target = selectedSiteId
        ? current?.cells.find((c) => c.id === selectedSiteId)
        : current?.region.features.find((f) => f.id === selectedFeatureId);
      const focused = populationFocus
        ? (current?.village.population.cohorts?.find((c) => c.id === populationFocus)?.assignmentId ?? populationFocus)
        : null;
      const anchor = target
        ? terrainRef.current?.projectCell(target)
        : focused
          ? terrainRef.current?.projectPopulation(focused)
          : null;
      if (!target && !focused) return;
      if (anchor) setMenuAnchor(anchor);
      else closePanels();
    }, 100);
    return () => window.clearInterval(timer);
  }, [selectedSiteId, selectedFeatureId, populationFocus, representativeId]);

  useEffect(() => {
    if (!representativeId) return;
    const timer = window.setInterval(() => {
      const view = terrainRef.current?.representativeCameraMode() ?? 'village';
      setRepresentativeView(view);
      const info = terrainRef.current?.representativeInfo(representativeId);
      if (info) setRepresentative(info);
      else if (view === 'village') {
        closePanels();
        return;
      }
      if (view === 'village') {
        const anchor = terrainRef.current?.projectRepresentative(representativeId);
        if (anchor) setMenuAnchor(anchor);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [representativeId]);

  function handleAreaGesture(first: Cell, last: Cell, commit: boolean) {
    if (
      leveling ||
      paletteCollapsed ||
      modeRef.current !== 'construction' ||
      terrainView !== 'village' ||
      actionInFlight.current ||
      arrivalActive ||
      constructionIntentState === 'uncertain'
    )
      return;
    if (
      !construction ||
      construction.action === 'upgrade' ||
      !construction.type ||
      (construction.action === 'extend' && !construction.buildingId)
    )
      return;
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
        setPaletteCollapsed(false);
        return;
      }
      const quote = shownUpgrade.current!;
      void executeConstruction({
        kind: 'upgrade',
        commandId: randomUUID(),
        worldSlug: state.world.slug,
        villageId: state.village.id,
        buildingId: quote.buildingId,
        expectedCosts: quote.costs,
        expectedLevel: quote.nextLevel,
        success: `Amélioration de ${quote.name} lancée`,
      });
      return;
    }
    const buildingId = intent.action === 'extend' ? intent.buildingId : undefined;
    const nextArea = previewArea(
      state,
      construction.type === 'university'
        ? campusRange(last, quarterTurns)
        : construction.type === 'stonemason'
          ? stonemasonRange(last, quarterTurns)
          : nextSelection,
      Boolean(spatial || construction.type === 'university' || construction.type === 'stonemason'),
      buildingId,
      construction.type,
    );
    if (nextArea.needsLeveling && (construction.type === 'university' || construction.type === 'stonemason')) {
      setLeveling({ buildingType: construction.type, anchor: { ...last }, quarterTurns });
      return;
    }
    const currentLevel = buildingId
      ? (state.cells.find((cell) => cell.building?.id === buildingId)?.building?.level ?? 1)
      : 1;
    const currentDefinition = state.buildingTypes.find((item) => item.code === construction.type);
    const nextCosts = constructionCosts(
      currentDefinition?.levels.find((item) => item.level === currentLevel),
      houseVariant,
    ).map((cost) => ({ ...cost, amount: cost.amount * (spatial ? nextArea.count : 1) }));
    const currentWood = displayedWood;
    const canAfford = nextCosts.every(
      (cost) =>
        cost.amount <=
        (cost.resourceCode === 'wood'
          ? currentWood
          : (state.village.resources.find((resource) => resource.code === cost.resourceCode)?.amount ?? 0)),
    );
    const nextError = nextArea.error ?? (!canAfford ? 'Ressources insuffisantes.' : null);
    if (nextError || !nextArea.cells.length) {
      setError(nextError);
      return;
    }
    if (buildingId && nextArea.count === 0) return;
    const shown = presentedArea.current;
    if (
      !shown ||
      shown.houseVariant !== houseVariant ||
      shown.quarterTurns !== quarterTurns ||
      shown.buildingId !== buildingId ||
      JSON.stringify(shown.cells) !== JSON.stringify(nextArea.cells) ||
      JSON.stringify(shown.costs) !== JSON.stringify(nextCosts)
    ) {
      setError('L’aperçu a changé. Vérifiez l’emprise et le coût, puis cliquez à nouveau.');
      setPaletteCollapsed(false);
      return;
    }
    const anchor =
      construction.type === 'university' || construction.type === 'stonemason'
        ? last
        : spatial
          ? first
          : nextArea.cells[0]!;
    const command: ConstructionCommand = buildingId
      ? {
          kind: 'expand',
          commandId: randomUUID(),
          worldSlug: state.world.slug,
          villageId: state.village.id,
          buildingId,
          cells: nextArea.cells,
          expectedCosts: nextCosts,
          success: 'Extension du Jardin lancée',
        }
      : {
          kind: 'build',
          commandId: randomUUID(),
          worldSlug: state.world.slug,
          villageId: state.village.id,
          houseVariant,
          buildingType: construction.type as BuildingType,
          anchor,
          cells: nextArea.cells,
          quarterTurns,
          expectedCosts: nextCosts,
          success: 'Construction lancée',
        };
    void executeConstruction(command);
  }
  function newMixedRequest(): ExploitationRequest {
    return configuredExploitation(exploitationSettings, stateRef.current?.village.population.total ?? 1, randomUUID());
  }
  function changeExploitationSettings(settings: ExploitationSettings) {
    setExploitationSettings(settings);
    if (exploitationIntentState === 'idle') {
      terrainRef.current?.cancelGesture();
      hoveredExploitation.current = null;
      presentedExploitation.current = null;
      setMixedRequest(null);
      setMixedPreview(null);
      setMixedCells([]);
    }
    if (mixedRequest && ['error', 'preview-required'].includes(exploitationIntentState)) {
      presentedExploitation.current = null;
      setMixedPreview(null);
      setMixedRequest(
        configuredExploitation(settings, stateRef.current?.village.population.total ?? 1, randomUUID(), mixedRequest),
      );
      setError(null);
    }
  }
  function cancelWorldGesture() {
    harvest.cancel();
    exploitationQueue.current = [];
    setQueuedExploitationCount(0);
    setQueuedExploitationCells([]);
    terrainRef.current?.cancelGesture();
    presentedExploitation.current = null;
    acceptedExploitation.current.clear();
    hoveredExploitation.current = null;
    touchOrigin.current = null;
    setSelection(null);
    mixedGesture.current = null;
    if (exploitationIntentState !== 'uncertain' && exploitationIntentState !== 'submitting') {
      exploitationActive.current = false;
      releasedExploitation.current = null;
      uncertainRequest.current = null;
      setMixedRequest(null);
      setMixedPreview(null);
      setMixedCells([]);
      setExploitationIntentState('idle');
      setMixedUncertain(false);
    }
    if (constructionIntentState === 'error') clearConstructionError();
    setError(null);
  }
  function cancelDraft() {
    cancelWorldGesture();
    exitConstruction();
  }
  function toggleHud() {
    cancelWorldGesture();
    closePanels();
    setShowScience(false);
    setShowWorksites(false);
    setPaletteCollapsed((value) => !value);
  }
  function chooseMode(mode: ActiveWorldMode, toggleActive = false) {
    if (beforeTownHall && (mode === 'population' || mode === 'exploitation' || mode === 'terraform')) return;
    if (toggleActive && mode === modeRef.current) {
      toggleHud();
      return;
    }
    // The wood mode (cutting or clearing) is kept for the session (docs/SPEC-GRAMMAIRE-GESTUELLE.md §3).
    cancelDraft();
    closePanels();
    setShowScience(false);
    setShowWorksites(false);
    setPopulationFocus(null);
    if (modeNavigation.current.choose(mode)) {
      terrainRef.current?.showVillage();
      return;
    }
    modeRef.current = mode;
    setWorldMode(mode);
    terrainRef.current?.setWorldMode(mode);
    setPaletteCollapsed(mode === 'exploration');
    if (mode === 'construction') {
      setConstructionDomain('buildings');
      setConstruction({ action: 'build', type: null });
    }
    if (mode === 'exploitation' && uncertainRequest.current) {
      setMixedRequest(uncertainRequest.current);
      setMixedUncertain(true);
      setExploitationIntentState('uncertain');
    }
  }
  function changeView(view: TerrainViewMode) {
    setTerrainView(view);
    cancelDraft();
    closePanels();
    setShowScience(false);
    setShowWorksites(false);
    const mode = modeNavigation.current.changeView(view);
    modeRef.current = mode;
    setWorldMode(mode);
    terrainRef.current?.setWorldMode(mode);
    if (view === 'village' && mode === 'construction') setConstruction({ action: 'build', type: null });
  }
  function collectExploitation(cell: Cell | null, newGesture = false, previewOnly = false) {
    if (
      paletteCollapsed ||
      modeRef.current !== 'exploitation' ||
      terrainView !== 'village' ||
      arrivalActive ||
      uncertainRequest.current
    )
      return;
    if (actionInFlight.current && !exploitationActive.current) return;
    if (previewOnly && (mixedGesture.current || exploitationIntentState !== 'idle' || showDev)) return;
    if (!cell) {
      if (mixedGesture.current?.deferred) {
        const { request, cells } = mixedGesture.current;
        if (exploitationTargetKeys(request).length) exploitationQueue.current.push({ request, cells });
        mixedGesture.current = null;
        publishExploitationQueue();
        drainExploitationQueue();
        return;
      }
      if (!newGesture && mixedGesture.current) {
        const request = mixedGesture.current.request;
        if (request.gardens.length || request.wood.length || request.stone.length) {
          exploitationActive.current = true;
          setMixedRequest(request);
          setMixedUncertain(false);
          setError(null);
          closePanels();
          releasedExploitationCap.current = pendingExploitationCap(request);
          const direct = directGardenExploitation(request);
          if (direct) void submitExploitation(direct);
          else if (
            presentedExploitation.current?.commandId !== request.commandId &&
            releasedExploitationCap.current !== null
          ) {
            releasedExploitation.current = request.commandId;
            setExploitationIntentState('verifying');
          } else finalizeReleasedExploitation(request);
        } else {
          setMixedRequest(null);
          setMixedPreview(null);
          setMixedCells([]);
          setExploitationIntentState('idle');
        }
      } else {
        setMixedCells([]);
        setExploitationIntentState('idle');
      }
      mixedGesture.current = null;
      return;
    }
    const deferred = !previewOnly && (exploitationActive.current || exploitationQueue.current.length > 0);
    const warm =
      !deferred &&
      newGesture &&
      !previewOnly &&
      hoveredExploitation.current?.key === cellKey(cell) &&
      hoveredExploitation.current.settings === JSON.stringify(exploitationSettings)
        ? hoveredExploitation.current.request
        : null;
    if (newGesture && !previewOnly) {
      if (deferred)
        mixedGesture.current = {
          request: newMixedRequest(),
          filter: exploitationSettings.filter,
          deferred: true,
          cells: [],
        };
      else {
        if (!warm) {
          presentedExploitation.current = null;
          acceptedExploitation.current.clear();
          setMixedRequest(null);
          setMixedPreview(null);
        } else if (presentedExploitation.current?.commandId === warm.commandId)
          for (const key of exploitationTargetKeys(presentedExploitation.current.preview))
            acceptedExploitation.current.add(key);
        releasedExploitation.current = null;
        setMixedCells([]);
        setError(null);
        mixedGesture.current = {
          request: warm ?? newMixedRequest(),
          filter: exploitationSettings.filter,
          deferred: false,
          cells: [],
        };
        setExploitationIntentState('selecting');
      }
    }
    const gesture = previewOnly
      ? { request: newMixedRequest(), filter: exploitationSettings.filter, deferred: false, cells: [] as Cell[] }
      : mixedGesture.current;
    const current = stateRef.current;
    if (!gesture || !current) return;
    let request = gesture.request;
    const { filter } = gesture;
    const garden = current.cells
      .flatMap((c) => (c.building?.garden && !c.building.garden.harvest ? c.building.garden.plots : []))
      .find((p) => cellKey(p) === cellKey(cell) && !p.harvest && p.storedCarrots >= 1);
    let changed = false;
    if (
      garden &&
      (filter === 'all' || filter === 'gardens') &&
      !request.gardens.some((p) => cellKey(p) === cellKey(cell))
    ) {
      request = { ...request, commandId: randomUUID(), gardens: [...request.gardens, cell] };
      changed = true;
    }
    for (const feature of terrainRef.current?.featuresAt(cell) ??
      current.region.features.filter((f) => cellKey(f) === cellKey(cell))) {
      const family =
        feature.deposit?.resourceCode === 'wood' ? 'wood' : feature.deposit?.resourceCode === 'stone' ? 'stone' : null;
      if (family && (filter === 'all' || filter === family) && !request[family].includes(feature.id)) {
        request = { ...request, commandId: randomUUID(), [family]: [...request[family], feature.id] };
        changed = true;
      }
    }
    if (changed) {
      gesture.request = request;
      gesture.cells.push(cell);
      if (gesture.deferred) {
        publishExploitationQueue();
        return;
      }
      setMixedRequest(request);
    }
    if (gesture.deferred) return;
    if (previewOnly) {
      acceptedExploitation.current.clear();
      hoveredExploitation.current = { key: cellKey(cell), settings: JSON.stringify(exploitationSettings), request };
      setMixedCells([]);
      if (!changed) {
        setMixedRequest(null);
        setMixedPreview(null);
      }
    }
    if (
      (garden && request.gardens.some((p) => cellKey(p) === cellKey(cell))) ||
      (terrainRef.current?.featuresAt(cell) ?? []).some(
        (f) => request.wood.includes(f.id) || request.stone.includes(f.id),
      )
    )
      setMixedCells((previous) =>
        previous.some((p) => cellKey(p) === cellKey(cell)) ? previous : [...previous, cell],
      );
  }
  function publishExploitationQueue() {
    const draft = mixedGesture.current?.deferred ? mixedGesture.current : null;
    setQueuedExploitationCount(exploitationQueue.current.length + (draft?.cells.length ? 1 : 0));
    setQueuedExploitationCells([...exploitationQueue.current.flatMap((item) => item.cells), ...(draft?.cells ?? [])]);
  }
  function drainExploitationQueue() {
    if (
      exploitationActive.current ||
      actionInFlight.current ||
      uncertainRequest.current ||
      modeRef.current !== 'exploitation'
    )
      return;
    const next = exploitationQueue.current.shift();
    if (!next) return;
    exploitationActive.current = true;
    hoveredExploitation.current = null;
    presentedExploitation.current = null;
    acceptedExploitation.current = new Set(exploitationTargetKeys(next.request));
    releasedExploitationCap.current = pendingExploitationCap(next.request);
    releasedExploitation.current = releasedExploitationCap.current === null ? null : next.request.commandId;
    setMixedRequest(next.request);
    setMixedPreview(null);
    setMixedCells(next.cells);
    setExploitationIntentState(releasedExploitation.current ? 'verifying' : 'preview-required');
    setError(null);
    publishExploitationQueue();
    const direct = directGardenExploitation(next.request);
    if (direct) {
      releasedExploitation.current = null;
      void submitExploitation(direct);
    }
  }
  async function submitExploitation(request: ExploitationRequest) {
    const current = stateRef.current;
    if (modeRef.current !== 'exploitation' || !current || actionInFlight.current || arrivalActive) return;
    actionInFlight.current = true;
    setPendingAction(true);
    setError(null);
    exploitationActive.current = true;
    let succeeded = false;
    hoveredExploitation.current = null;
    setExploitationIntentState('submitting');
    sessionStorage.setItem(pendingExploitationKey(current.village.id), JSON.stringify(request));
    try {
      const v2 = villageV2Ref.current;
      // On V2 the confirmation's effects have already updated the village.
      if (v2.ready && v2.exploit) await v2.exploit(request);
      else applySnapshot(await startExploitation(worldSlug, current.village.id, request));
      const after = stateRef.current?.village.id === current.village.id ? stateRef.current : null;
      markOracleProgress();
      succeeded = true;
      sessionStorage.removeItem(pendingExploitationKey(current.village.id));
      uncertainRequest.current = null;
      releasedExploitation.current = null;
      setMixedUncertain(false);
      setMixedRequest(null);
      setMixedPreview(null);
      setMixedCells([]);
      setExploitationIntentState('idle');
      const order = after?.village.exploitationOrders?.find(
        (item) =>
          item.workerCap === request.workerCap &&
          !current.village.exploitationOrders?.some((old) => old.id === item.id),
      );
      pushNotification(
        order
          ? `Exploitation lancée · ${order.mobilized} habitant(s) mobilisé(s) / plafond ${order.workerCap}`
          : 'Exploitation confirmée',
      );
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Lancement impossible.';
      setError(message);
      if ((reason instanceof ApiError || reason instanceof SyncV2HttpError) && reason.status < 500) {
        sessionStorage.removeItem(pendingExploitationKey(current.village.id));
        uncertainRequest.current = null;
        releasedExploitation.current = null;
        setMixedUncertain(false);
        setMixedRequest(request);
        setExploitationIntentState('error');
      } else {
        uncertainRequest.current = request;
        releasedExploitation.current = null;
        setMixedUncertain(true);
        setMixedRequest(request);
        setExploitationIntentState('uncertain');
      }
      pushNotification(message, 'warning');
    } finally {
      actionInFlight.current = false;
      setPendingAction(false);
      if (succeeded) {
        exploitationActive.current = false;
        drainExploitationQueue();
      }
    }
  }
  function finalizeReleasedExploitation(request: ExploitationRequest) {
    // Auto without a displayed bound requires a new gesture after the estimate.
    // Keep that policy, but distinguish waiting for an estimate from a refusal.
    if (presentedExploitation.current?.commandId !== request.commandId) {
      releasedExploitation.current = null;
      setError(null);
      setExploitationIntentState('preview-required');
      return;
    }
    try {
      const finalized = freezeExploitation(
        request,
        presentedExploitation.current,
        acceptedExploitation.current,
        releasedExploitationCap.current ?? Infinity,
      );
      releasedExploitation.current = null;
      setMixedRequest(finalized);
      if (finalized.woodMode === 'clear' && finalized.wood.length) {
        setExploitationIntentState('confirm-clear');
        return;
      }
      void submitExploitation(finalized);
    } catch (reason) {
      releasedExploitation.current = null;
      setError(reason instanceof Error ? reason.message : 'S?lection ? vérifier.');
      setExploitationIntentState('error');
    }
  }
  function retryExploitation() {
    if (uncertainRequest.current) {
      void submitExploitation(uncertainRequest.current);
      return;
    }
    if (!mixedRequest) return;
    const direct = directGardenExploitation(mixedRequest);
    if (direct) {
      void submitExploitation({ ...direct, commandId: randomUUID() });
      return;
    }
    if (presentedExploitation.current?.commandId !== mixedRequest.commandId) {
      const request = { ...mixedRequest, commandId: randomUUID() };
      releasedExploitationCap.current = pendingExploitationCap(request);
      releasedExploitation.current = releasedExploitationCap.current === null ? null : request.commandId;
      setMixedRequest(request);
      setError(null);
      setExploitationIntentState(releasedExploitation.current ? 'verifying' : 'preview-required');
      return;
    }
    // A known refusal creates a fresh identity, using the corrected displayed parameters.
    try {
      const frozen = freezeExploitation(mixedRequest, presentedExploitation.current, acceptedExploitation.current);
      const request = { ...frozen, commandId: randomUUID() };
      setMixedRequest(request);
      setError(null);
      if (request.woodMode === 'clear' && request.wood.length) setExploitationIntentState('confirm-clear');
      else void submitExploitation(request);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'S?lection ? vérifier.');
    }
  }
  function removeExploitationTarget(family: 'gardens' | 'wood' | 'stone', key: string) {
    if (!mixedRequest || exploitationIntentState === 'uncertain') return;
    const request: ExploitationRequest =
      family === 'gardens'
        ? {
            ...mixedRequest,
            commandId: randomUUID(),
            gardens: mixedRequest.gardens.filter((cell) => `garden:${cell.cellX}:${cell.cellY}` !== key),
          }
        : { ...mixedRequest, commandId: randomUUID(), [family]: mixedRequest[family].filter((id) => id !== key) };
    acceptedExploitation.current.delete(key);
    presentedExploitation.current = null;
    releasedExploitation.current = null;
    setMixedRequest(request);
    setMixedPreview(null);
    setError(null);
    setExploitationIntentState('error');
  }
  async function discoverSupplies(buildingId: string) {
    const currentState = stateRef.current;
    if (
      actionInFlight.current ||
      !currentState ||
      !['exploitation', 'exploration'].includes(modeRef.current) ||
      arrivalActive
    )
      return;
    actionInFlight.current = true;
    setPendingAction(true);
    setError(null);
    try {
      const v2 = villageV2Ref.current;
      if (v2.ready && v2.discoverSupplies) await v2.discoverSupplies(buildingId);
      else {
        const result = await discoverOrRefreshSupplies(worldSlug, currentState.village.id, buildingId);
        applySnapshot(result.snapshot);
        if (result.alreadyDiscovered) pushNotification('Les réserves avaient déjà été fouillées');
      }
      markOracleProgress();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Fouille impossible.';
      setError(message);
      pushNotification(message, 'warning');
    } finally {
      actionInFlight.current = false;
      setPendingAction(false);
    }
  }
  function useConstructionTarget(siteId: string, anchor: ScreenAnchor, inspect = false) {
    const current = constructionPresentationState(stateRef.current, constructionPresentationRef.current);
    if (
      !current ||
      !construction ||
      modeRef.current !== 'construction' ||
      actionInFlight.current ||
      constructionIntentState === 'uncertain'
    )
      return;
    const site = current.cells.find((cell) => cell.id === siteId);
    const building =
      site?.building ??
      (site?.footprint
        ? current.cells.find((cell) => cell.building?.id === site.footprint?.buildingId)?.building
        : null);
    if (!building) {
      setError('Aucun bâtiment à cet emplacement.');
      return;
    }
    if (inspect) {
      closePanels();
      setSelectedSiteId(siteId);
      setMenuAnchor(anchor);
      return;
    }
    if (construction.action === 'extend') {
      if (building.type !== 'garden' || building.status !== 'completed') {
        setError('Choisissez un Jardin terminé.');
        return;
      }
      clearPreview();
      setConstruction({ action: 'extend', type: 'garden', buildingId: building.id });
      pushNotification('Jardin choisi · glissez pour dessiner son extension');
      return;
    }
    if (construction.action === 'upgrade') {
      const currentQuote = upgradePreview(current, siteId);
      if (!sameUpgradeQuote(shownUpgrade.current, currentQuote)) {
        setHoveredBuildingId(siteId);
        setPaletteCollapsed(false);
        setError(currentQuote?.error ?? 'Vérifiez le coût et le prochain niveau affich?s avant de cliquer.');
        return;
      }
      const quote = shownUpgrade.current!;
      void executeConstruction({
        kind: 'upgrade',
        commandId: randomUUID(),
        worldSlug: current.world.slug,
        villageId: current.village.id,
        buildingId: quote.buildingId,
        expectedCosts: quote.costs,
        expectedLevel: quote.nextLevel,
        success: `Amélioration de ${quote.name} lanc?e`,
      });
      return;
    }
    closePanels();
    setSelectedSiteId(siteId);
    setMenuAnchor(anchor);
  }

  function commandWorksite(id: string, action: 'pause' | 'resume' | 'stop' | 'set-cap', cap?: number) {
    if (!state || modeRef.current !== 'exploitation') return;
    const change = { commandId: randomUUID(), action, ...(cap === undefined ? {} : { workerCap: cap }) };
    void runAction(async () => {
      const v2 = villageV2Ref.current;
      if (!v2.ready || !v2.changeWorksite) return changeWorksite(worldSlug, state.village.id, id, change);
      await v2.changeWorksite(id, change);
    });
  }

  if (loading)
    return <WorldLoading worldName={worldLabel} message="Lecture du village et de ses trajets" lobbyUrl={LOBBY_URL} />;
  if (needsLogin)
    return (
      <WorldLoading
        worldName={state?.world.name ?? worldLabel}
        error="Connectez-vous pour entrer dans ce monde."
        lobbyUrl={LOBBY_URL}
      />
    );
  if (!state)
    return (
      <WorldLoading
        worldName={worldLabel}
        error={error ?? 'Village indisponible.'}
        onRetry={() => location.reload()}
        lobbyUrl={LOBBY_URL}
      />
    );
  return (
    <>
      {observationActive && (
        <div
          role="status"
          style={{
            position: 'fixed',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            padding: '8px 16px',
            background: '#102924ed',
            color: '#d4fff2',
            border: '1px solid #7dbbaa',
            borderRadius: 6,
          }}
        >
          Assistance : observation administrative active
        </div>
      )}
      <main
        className="game-shell"
        data-initial-loading={!initialReady}
        inert={!initialReady}
        aria-hidden={!initialReady}
      >
        {initialReady && !starter && state.world.generationVersion === 3 && (
          <StarterResume slug={worldSlug} villageId={state.village.id} />
        )}
        <Suspense fallback={null}>
          <VillageScene
            onInitialLoad={(progress) => setInitialProgress({ key: sceneKey, progress })}
            preparing={beforeTownHall}
            starterGhost={starterActive && worldMode === 'construction' && !paletteCollapsed ? starter!.ghost : null}
            onStarterManual={starterActive ? starter!.onManual : undefined}
            worldMode={paletteCollapsed ? 'exploration' : worldMode}
            noclip={noclip}
            populationFilter="all"
            populationFocus={
              state.village.population.cohorts?.find((c) => c.id === populationFocus)?.assignmentId ?? populationFocus
            }
            onEyesFound={() => void discoverEyes()}
            onArrivalActive={setArrivalActive}
            state={sceneState ?? state}
            serverOffsetMs={serverOffsetMs}
            terrainRef={terrainRef}
            pendingHarvestCells={worldMode === 'exploitation' ? pendingHarvestCells : NO_PENDING_HARVESTS}
            pendingHarvestTrees={worldMode === 'exploitation' ? harvest.pendingTrees : NO_PENDING_TREES}
            harvestWoodMode={woodToolActive ? exploitationSettings.woodMode : 'cut'}
            onWoodModeToggle={toggleWoodMode}
            highlightedSiteIds={highlightedSiteIds}
            constructionMode={
              !paletteCollapsed &&
              !workshop &&
              (worldMode === 'construction' || worldMode === 'terraform') &&
              terrainView === 'village'
            }
            showTravelPaths={showTravelPaths}
            selectedRouteId={selectedRouteId}
            cosmologyDebug={cosmologyDebug}
            devOpen={showDev}
            constructionAction={worldMode === 'construction' ? (construction?.action ?? null) : null}
            constructionType={starterActive ? 'starter' : (construction?.type ?? null)}
            onBuildingHover={setHoveredBuildingId}
            paletteOpen={!paletteCollapsed}
            constructionQuarterTurns={quarterTurns}
            constructionHouseVariant={houseVariant}
            selectingArea={
              starterActive
                ? worldMode === 'construction' && !paletteCollapsed && !starter!.pending
                : !paletteCollapsed &&
                  !workshop &&
                  constructionDomain === 'buildings' &&
                  worldMode === 'construction' &&
                  Boolean(construction?.type) &&
                  construction?.action !== 'upgrade' &&
                  (construction?.action !== 'extend' || Boolean(construction.buildingId)) &&
                  !pendingAction &&
                  terrainView === 'village'
            }
            preview={
              !paletteCollapsed && worldMode === 'construction'
                ? starterActive
                  ? starter!.preview
                  : leveling && levelingPreview
                    ? {
                        cells: levelingPreview.quote.affectedCells ?? levelingPreview.quote.cells,
                        count: (levelingPreview.quote.affectedCells ?? levelingPreview.quote.cells).length,
                        error: null,
                        needsLeveling: true,
                      }
                    : area
                : null
            }
            previewInvalid={starterActive ? Boolean(starter!.preview.error) : Boolean(selectionError)}
            onAreaGesture={
              starterActive ? (_first, last, commit) => starter!.onGesture(last, commit) : handleAreaGesture
            }
            onGardenHarvest={(cell, fresh, previewOnly, tree) =>
              uncertainRequest.current
                ? collectExploitation(cell, fresh, previewOnly)
                : harvest.collect(cell, fresh, previewOnly, tree)
            }
            onWorldGestureCancelled={cancelWorldGesture}
            onSiteSelected={(id, anchor, inspect) => {
              if (modeRef.current === 'population' && id.startsWith('representative:')) {
                closePanels();
                setPopulationFocus(null);
                const personId = id.slice(15);
                terrainRef.current?.selectRepresentative(personId);
                setRepresentativeId(personId);
                setRepresentative(terrainRef.current?.representativeInfo(personId) ?? null);
                setMenuAnchor(anchor);
                return;
              }
              if (modeRef.current === 'population' && id.startsWith('population:')) {
                closePanels();
                setPopulationFocus(id.slice(11));
                setMenuAnchor(anchor);
                return;
              }
              if (modeRef.current === 'construction') {
                useConstructionTarget(id, anchor, inspect);
                return;
              }
              if (modeRef.current === 'exploration') {
                const current = stateRef.current;
                const site = current?.cells.find((c) => c.id === id);
                const building =
                  site?.building ??
                  current?.cells.find((c) => c.building?.id === site?.footprint?.buildingId)?.building;
                if (!building || !['town-hall', 'sawmill', 'stonemason', 'university'].includes(building.type)) return;
                closePanels();
                setError(null);
                setSelectedSiteId(id);
                setMenuAnchor(anchor);
                setShowScience(building.type === 'university');
                return;
              }
              closePanels();
              setSelectedSiteId(id);
              setMenuAnchor(anchor);
            }}
            onFeatureSelected={(id, anchor) => {
              if (modeRef.current === 'exploitation') {
                closePanels();
                setError(null);
                setSelectedFeatureId(id);
                setMenuAnchor(anchor);
              }
            }}
            onCameraMoved={() => {}}
            onViewChanged={changeView}
          />
        </Suspense>
        <WorldModeBar
          beforeTownHall={beforeTownHall}
          mode={worldMode}
          collapsed={paletteCollapsed}
          onChoose={(mode) => chooseMode(mode, true)}
        />
        <HarvestFeedbackLayer items={harvest.feedback} scene={terrainRef} />
        {woodToolActive && <WoodModeIndicator mode={exploitationSettings.woodMode} />}
        <WoodModeBubble bubble={woodModeBubble} />
        {terrainView === 'village' && (
          <DemolitionCancelButton pending={pendingDemolition.pending} onCancel={pendingDemolition.cancel} />
        )}
        {worldMode === 'exploitation' && terrainView === 'village' && (
          <HarvestCancelButton
            gesture={harvest.lastGesture}
            result={harvest.cancelResult}
            onCancel={harvest.cancelLast}
            onDismiss={harvest.dismissCancel}
          />
        )}
        {worldMode === 'exploitation' &&
          terrainView === 'village' &&
          !paletteCollapsed &&
          !uncertainRequest.current && (
            <ExploitationShowroom
              category={exploitationCategory}
              selected={exploitationCategory === 'exploit' ? harvest.filter : artisanChoice}
              networkError={harvest.networkError}
              onCategory={(category) => {
                cancelWorldGesture();
                closePanels();
                setExploitationCategory(category);
              }}
              onChoose={chooseExploitation}
              onWorksites={() => {
                closePanels();
                setShowWorksites((value) => !value);
              }}
            />
          )}
        {worldMode === 'exploitation' && terrainView === 'village' && uncertainRequest.current && (
          <div hidden={paletteCollapsed}>
            <ExploitationPalette
              settings={exploitationSettings}
              population={state.village.population}
              queuedCount={queuedExploitationCount}
              request={mixedRequest}
              preview={mixedPreview}
              intentState={exploitationIntentState}
              error={error}
              pending={pendingAction || arrivalActive}
              collapsed={paletteCollapsed}
              onChange={changeExploitationSettings}
              onToggle={toggleHud}
              onWorksites={() => {
                closePanels();
                setShowWorksites((value) => !value);
              }}
              onGardens={() => {
                closePanels();
                setShowGardens(true);
                setMenuAnchor({ x: 16, y: window.innerHeight - 300 });
              }}
              onConfirmClear={() => {
                if (mixedRequest) void submitExploitation(mixedRequest);
              }}
              onCancelIntent={cancelWorldGesture}
              onRetry={retryExploitation}
              onRemoveTarget={removeExploitationTarget}
            />
          </div>
        )}
        {oracleProvisions?.villageKey === `${state.world.id}:${state.village.id}` && !arrivalActive && (
          <aside
            className="oracle-provisions-overlay"
            role="dialog"
            aria-labelledby="oracle-provisions-title"
            aria-describedby="oracle-provisions-message"
          >
            <strong id="oracle-provisions-title">L’Oracle</strong>
            <p id="oracle-provisions-message">{oracleProvisions.message}</p>
            <button type="button" onClick={() => setOracleProvisions(null)}>
              Masquer
            </button>
          </aside>
        )}
        {oracleCat && !arrivalActive && (
          <aside className="oracle-cat-visit" role="dialog" aria-label="L'Oracle">
            <strong>L'Oracle</strong>
            <p>Je cherche mon chat… Vous ne l'auriez pas aperçu ?</p>
            <button type="button" onClick={() => setOracleCat(false)}>
              Fermer
            </button>
          </aside>
        )}
        <Hud
          beforeTownHall={beforeTownHall}
          devOpen={showDev}
          devActive={noclip || cosmologyDebug || showTravelPaths || showStatistics}
          onDev={() => {
            setShowDev((value) => !value);
            cancelWorldGesture();
          }}
          state={state}
          resourceServerTime={resourceServerTime}
          displayedWood={displayedWood}
          serverOffsetMs={serverOffsetMs}
          notifications={notifications}
          resourceFeedback={resourceFeedback.items}
          onResourceFeedbackEnd={resourceFeedback.dismiss}
          onPopulation={() => chooseMode('population')}
          onJournal={() => {
            closePanels();
            setShowJournal(true);
            setMenuAnchor(populationAnchor());
          }}
        />

        {showScience &&
          (worldMode === 'population' || worldMode === 'exploration') &&
          terrainView === 'village' &&
          state.science && (
            <SciencePanel
              key={selectedBuilding?.type === 'university' ? selectedBuilding.id : 'knowledge'}
              expeditions={expeditions.entries}
              target={
                selectedFeatureId && depositDetails
                  ? depositDetails.deposit
                  : { cellX: state.village.anchorCellX, cellY: state.village.anchorCellY }
              }
              science={state.science}
              villageId={state.village.id}
              buildingId={selectedBuilding?.type === 'university' ? selectedBuilding.id : null}
              pending={pendingAction}
              serverNow={serverNow}
              error={error}
              onClose={() => setShowScience(false)}
              onCommand={(command) => {
                if (!['population', 'exploration'].includes(modeRef.current) || arrivalActive) return;
                if (command.action === 'survey' || command.action === 'explore') {
                  expeditions.submit(command);
                  return;
                }
                void runAction(async () => {
                  const v2 = villageV2Ref.current;
                  if (!v2.ready || !v2.science) return commandScience(worldSlug, state.village.id, command);
                  await v2.science(command);
                }, 'Université · commande prise en compte');
              }}
            />
          )}
        <DevDrawer
          onFactory={(enabled) => void runAction(() => setFactoryEnabled(worldSlug, enabled, state.village.id))}
          noclip={noclip}
          onNoclip={setNoclip}
          open={showDev}
          view={terrainView}
          state={state}
          showTravelPaths={showTravelPaths}
          selectedRouteId={selectedRouteId}
          cosmology={cosmologyDebug}
          onOpen={(open) => {
            setShowDev(open);
            if (open) cancelWorldGesture();
          }}
          onTravelPaths={setShowTravelPaths}
          onRoute={setSelectedRouteId}
          onCosmology={setCosmologyDebug}
          onReset={() => {
            setStatisticsEnabled(false);
            setNoclip(false);
            terrainRef.current?.resetCosmology();
            setCosmologyDebug(false);
            setShowTravelPaths(false);
            setSelectedRouteId(null);
          }}
          renderLab={() => terrainRef.current?.renderLab() ?? null}
          onMarketBeacon={() => terrainRef.current?.marketBeacon()}
        />
        <WorkforceHud
          key={`${state.world.id}:${state.village.id}`}
          state={state}
          onConfirmed={markOracleProgress}
          view={
            paletteCollapsed || terrainView !== 'village' || arrivalActive || beforeTownHall || showDev
              ? null
              : worldMode === 'population'
                ? 'population'
                : worldMode === 'exploitation' && exploitationCategory === 'exploit'
                  ? showWorksites
                    ? 'pools'
                    : harvest.filter === 'wood' || harvest.filter === 'stone'
                      ? harvest.filter
                      : null
                  : null
          }
        />
        {showWorksites &&
          worldMode === 'exploitation' &&
          terrainView === 'village' &&
          state.village.worksites.some(
            (s) => !s.poolResource && ['running', 'paused', 'stopping'].includes(s.status),
          ) && (
            <details className="legacy-worksites">
              <summary>Autres chantiers</summary>
              <WorksitePanel
                orders={state.village.exploitationOrders ?? []}
                serverNow={serverNow}
                worksites={state.village.worksites.filter((s) => !s.poolResource)}
                pending={pendingAction}
                onAction={commandWorksite}
              />
            </details>
          )}
        {menuAnchor && showGardens && worldMode === 'exploitation' ? (
          <WorldContextMenu anchor={menuAnchor}>
            <div>
              <strong>Choisir un Jardin</strong>
              {gardenSites.map((site, index) => (
                <button
                  type="button"
                  key={site.id}
                  onClick={() => {
                    setShowGardens(false);
                    setSelectedSiteId(site.id);
                  }}
                >
                  Jardin {index + 1} · {site.cellX}, {site.cellY} · {site.building!.garden!.activeCellCount} parcelle(s)
                </button>
              ))}
            </div>
          </WorldContextMenu>
        ) : null}
        {representative && menuAnchor && worldMode === 'population' && (
          <WorldContextMenu
            anchor={representativeView === 'village' ? menuAnchor : { x: window.innerWidth - 330, y: 110 }}
          >
            <RepresentativePanel
              person={representative}
              view={representativeView}
              onView={(mode) => terrainRef.current?.representativeCamera(mode)}
              onClose={closePanels}
            />
          </WorldContextMenu>
        )}
        {menuAnchor && showJournal ? (
          <WorldContextMenu anchor={menuAnchor}>
            <OracleJournal accomplishments={state.village.accomplishments} />
          </WorldContextMenu>
        ) : null}
        {menuAnchor &&
          selectedBuilding &&
          (worldMode === 'exploitation' || worldMode === 'exploration') &&
          state.buildingTypes
            .find((d) => d.code === selectedBuilding.type)
            ?.levels.find((l) => l.level === selectedBuilding.level)?.processing && (
            <WorldContextMenu anchor={menuAnchor}>
              <ProcessingPanel
                key={selectedBuilding.id}
                slug={worldSlug}
                villageId={state.village.id}
                building={selectedBuilding}
                recipe={
                  state.buildingTypes
                    .find((d) => d.code === selectedBuilding.type)!
                    .levels.find((l) => l.level === selectedBuilding.level)!.processing!
                }
                orders={processingOrders}
                unresolved={
                  villageV2.unresolved.find(
                    (command) => processingCommandBuilding(command, processingOrders) === selectedBuilding.id,
                  ) ?? null
                }
                onDiscard={villageV2.discard}
                serverNow={serverNow}
                revision={state.serverTime}
                pending={pendingAction}
                error={error}
                onCommand={runProcessing}
              />
            </WorldContextMenu>
          )}
        {menuAnchor &&
        selectedBuilding &&
        (worldMode === 'exploitation' || (worldMode === 'exploration' && selectedBuilding.type !== 'university')) &&
        !state.buildingTypes
          .find((d) => d.code === selectedBuilding.type)
          ?.levels.find((l) => l.level === selectedBuilding.level)?.processing ? (
          <WorldContextMenu anchor={menuAnchor}>
            <BuildingPanel
              mode="exploitation"
              building={selectedBuilding}
              definition={state.buildingTypes.find((item) => item.code === selectedBuilding.type)!}
              serverNow={serverNow}
              pending={pendingAction}
              pendingHarvestKeys={pendingHarvestKeys}
              readyCarrots={selectedBuilding.garden ? gardenReady(selectedBuilding.garden, serverNow) : 0}
              availableWorkers={state.village.population.available}
              onUpgrade={() => {}}
              onPrepareGardens={() => {
                closePanels();
                harvest.setFilter('gardens');
                setExploitationSettings((current) => ({ ...current, filter: 'gardens' }));
                pushNotification('Outil Jardins prêt · glissez sur les parcelles à récolter.');
              }}
              onDiscover={() => void discoverSupplies(selectedBuilding.id)}
            />
            {selectedBuilding.type === 'town-hall' && state.village.market && (
              <MarketPanel
                key={selectedBuilding.id}
                slug={worldSlug}
                villageId={state.village.id}
                building={selectedBuilding}
                market={state.village.market}
                stocks={state.village.resources}
                serverNow={serverNow}
                revision={state.serverTime}
                pending={pendingAction}
                error={error}
                onCommand={async (command) => {
                  const done = await runAction(async () => {
                    const v2 = villageV2Ref.current;
                    if (!v2.ready || !v2.trade) return commandPlayerMarket(worldSlug, state.village.id, command);
                    await v2.trade(command);
                  });
                  // A direct Oracle purchase leaves no trace in the state; its credit
                  // (and the "+N") was applied before the command resolved.
                  if (done && marketCommandDelivers(command)) terrainRef.current?.marketBeacon();
                  return done;
                }}
                onUpgrade={() => {
                  const quote = upgradePreview(state, selectedSiteId);
                  if (!quote || quote.error) {
                    setError(quote?.error ?? 'Devis indisponible.');
                    return;
                  }
                  void executeConstruction({
                    kind: 'upgrade',
                    commandId: randomUUID(),
                    worldSlug,
                    villageId: state.village.id,
                    buildingId: quote.buildingId,
                    expectedCosts: quote.costs,
                    expectedLevel: quote.nextLevel,
                    success: 'Amélioration de l’hôtel de ville lancée',
                  });
                }}
              />
            )}
            {error && selectedBuilding.type !== 'town-hall' ? <p className="error">{error}</p> : null}
          </WorldContextMenu>
        ) : null}
        {menuAnchor && selectedBuilding && worldMode === 'construction' ? (
          <WorldContextMenu anchor={menuAnchor}>
            <BuildingPanel
              mode="population"
              building={selectedBuilding}
              definition={state.buildingTypes.find((item) => item.code === selectedBuilding.type)!}
              serverNow={serverNow}
              pending={pendingAction}
              readyCarrots={selectedBuilding.garden ? gardenReady(selectedBuilding.garden, serverNow) : 0}
              availableWorkers={state.village.population.available}
              onUpgrade={() => {}}
              onPrepareGardens={() => {}}
              onDiscover={() => {}}
            />
          </WorldContextMenu>
        ) : null}
        {menuAnchor && selectedFeatureId && worldMode === 'exploitation' ? (
          <WorldContextMenu anchor={menuAnchor}>
            <DepositPanel
              trees={terrainRef.current?.groveTrees(selectedFeatureId) ?? null}
              details={depositDetails}
              unmapped={depositUnmapped}
              loading={depositLoading}
              pending={pendingAction}
              onPrepare={(family, woodMode) => {
                closePanels();
                harvest.setFilter(family);
                setExploitationSettings((current) => ({
                  ...current,
                  filter: family,
                  ...(woodMode ? { woodMode } : {}),
                }));
                pushNotification(
                  `Outil ${family === 'wood' ? (woodMode === 'clear' ? 'Défrichage' : 'Bois') : 'Pierre'} prêt · glissez dans le monde.`,
                );
              }}
            />
            {error ? <p className="error">{error}</p> : null}
          </WorldContextMenu>
        ) : null}
        {starterActive && worldMode === 'construction' && (
          <div hidden={paletteCollapsed}>
            <ConstructionPanel
              starter={{ choices: starter!.choices, selected: starter!.selected, onChoose: starter!.onChoose }}
              houseVariant="logs"
              construction={{ action: 'build', type: starter!.selected }}
              definitions={[]}
              area={starter!.preview}
              costs={[]}
              error={starter!.error ?? starter!.preview.error}
              pending={starter!.pending}
              gardenWorkerNeed={null}
              upgrade={null}
              intentState={starter!.uncertain ? 'uncertain' : starter!.pending ? 'submitting' : 'idle'}
              collapsed={paletteCollapsed}
              onToggle={() => setPaletteCollapsed((v) => !v)}
              onChoose={() => {}}
              onDomainChange={() => {}}
              domain="buildings"
              infrastructure={null}
              factoryEnabled={false}
              onWorkshop={() => {}}
              onRetry={starter!.onRetry}
              onClearError={() => {}}
            />
            {starter!.names}
          </div>
        )}
        {starter && !starterActive && starter.choices.some((c) => c.key) && worldMode === 'construction' && (
          <button
            className="starter-resume"
            onClick={() => {
              starter.onChoose(starter.choices.find((c) => c.key)!.key);
              setPaletteCollapsed(false);
            }}
          >
            Kit initial restant
          </button>
        )}
        {!starterActive &&
        terrainView === 'village' &&
        (worldMode === 'construction' || worldMode === 'terraform') &&
        contextualConstruction ? (
          <div hidden={paletteCollapsed}>
            <ConstructionPanel
              houseVariant={houseVariant}
              upgrade={upgrade}
              construction={contextualConstruction}
              definitions={state.buildingTypes}
              area={area}
              costs={costs}
              error={selectionError ?? error}
              pending={pendingAction}
              gardenWorkerNeed={gardenWorkerNeed}
              intentState={constructionIntentState}
              onRetry={retryConstruction}
              onClearError={clearConstructionError}
              collapsed={paletteCollapsed}
              onToggle={() => setPaletteCollapsed((value) => !value)}
              onChoose={(type, variant) => {
                clearConstructionError();
                clearPreview();
                if (variant) setHouseVariant(variant);
                setConstruction({ action: 'build', type });
              }}
              domain={worldMode === 'terraform' ? 'tools' : constructionDomain}
              tool={worldMode === 'terraform' ? 'terraform' : null}
              onTool={(tool) => {
                clearPreview();
                clearConstructionError();
                if (tool === 'terraform') chooseMode(worldMode === 'terraform' ? 'construction' : 'terraform');
                else if (worldMode === 'terraform') chooseMode('construction');
                setConstructionDomain('tools');
                setConstruction({ action: 'build', type: null });
              }}
              factoryEnabled={import.meta.env.DEV && Boolean(state.factoryEnabled)}
              onWorkshop={() => {
                clearPreview();
                cancelWorldGesture();
                setWorkshop('buildings');
              }}
              demolition={(active) => (
                <DemolitionTool
                  state={sceneState ?? state}
                  scene={terrainRef}
                  ready={Boolean(demolish)}
                  pending={Boolean(pendingDemolition.pending)}
                  onSchedule={pendingDemolition.schedule}
                  active={active && worldMode === 'construction' && !showDev && !workshop && !arrivalActive}
                />
              )}
              infrastructure={
                <InfrastructureTools
                  state={sceneState ?? state}
                  scene={terrainRef}
                  active={
                    worldMode === 'construction' &&
                    constructionDomain === 'infrastructure' &&
                    !paletteCollapsed &&
                    !showDev &&
                    !workshop &&
                    !arrivalActive
                  }
                  roadCells={roadCellsApi}
                  roadAnchors={roadAnchorsApi}
                  onSnapshot={applySnapshot}
                  onConfirmation={applyInfrastructureConfirmation}
                  onWorkshop={() => {
                    clearPreview();
                    cancelWorldGesture();
                    setWorkshop('infrastructure');
                  }}
                />
              }
              onDomainChange={(domain) => {
                clearPreview();
                clearConstructionError();
                chooseMode('construction');
                setConstructionDomain(domain);
                setConstruction({ action: 'build', type: null });
              }}
            />
          </div>
        ) : null}
        {worldMode === 'terraform' && terrainView === 'village' && !arrivalActive && !beforeTownHall && !showDev && (
          <TerraformPanel
            state={state}
            scene={terrainRef}
            onSnapshot={applySnapshot}
            submit={(command) => {
              const v2 = villageV2Ref.current;
              return v2.ready && v2.terraform
                ? v2.terraform(command)
                : commandTerraform(state.world.slug, state.village.id, command);
            }}
            onStarted={() => pushNotification('Chantier de terraformation lancé.')}
          />
        )}
        {leveling && (
          <LevelingPanel
            slug={state.world.slug}
            villageId={state.village.id}
            request={leveling}
            onPreview={setLevelingPreview}
            onSnapshot={applySnapshot}
            submit={async (command) => {
              const v2 = villageV2Ref.current;
              if (!v2.ready || !v2.level) return commandLeveling(state.world.slug, state.village.id, command);
              await v2.level(command);
            }}
            onClose={() => {
              setLeveling(null);
              setLevelingPreview(null);
            }}
            onStarted={() => {
              setLeveling(null);
              setLevelingPreview(null);
              clearPreview();
              pushNotification('Chantier de nivellement lancé. Vous pourrez construire à sa fin.');
            }}
          />
        )}
        {workshop && (
          <section className="factory-workshop" aria-label="Atelier">
            <button onClick={() => setWorkshop(null)}>Retour au village</button>
            {state.factoryEnabled ? (
              <iframe
                title={`Atelier ${workshop}`}
                src={worldPage('/factory-preview.html', state.world.slug, { domain: workshop })}
              />
            ) : (
              <p>L’accès aux ateliers a été désactivé.</p>
            )}
          </section>
        )}
      </main>
      {!initialReady && (
        <WorldLoading
          worldName={state.world.name}
          message="Préparation de la scène"
          progress={initialProgress?.key === sceneKey ? initialProgress.progress : undefined}
          onRetry={() => location.reload()}
          lobbyUrl={LOBBY_URL}
        />
      )}
    </>
  );
}
