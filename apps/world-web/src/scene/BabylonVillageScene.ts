import type { ObservationPose } from '@arbestra/contracts';
import { emptyInfrastructure, interpolateObservationPose } from '@arbestra/contracts';
import { playerSceneTransport, type SceneTransport } from './scene-transport';
import {
  clientTime,
  FrameTimings,
  statisticsEnabled,
  recordFrame,
  timedFetch as fetch,
  timedJson,
} from '../dev/statistics';
import type { StarterGhost } from '../spawn-map/starter-controller';
import { poseStarterElement, spawnDelta } from '@arbestra/contracts';
import {
  automaticBraziers,
  prepareInfrastructureEdit,
  infrastructureBlockedPixels,
  infrastructureBarrierAt,
  buildingAccesses,
  WOOD_PER_TREE,
} from '@arbestra/contracts';
import { InhabitantCamera } from './inhabitant-camera';
import { cameraFocusAt } from './camera-focus';
import { buildStonemason, buildStonemasonFire } from './stonemason-factory';
import { buildProceduralBuildingLod, buildCachedProceduralBuildingLod } from './building-lod-procedural';
import { buildSawmill } from './sawmill-factory';
import { buildTownHallMarket } from './town-hall-market-factory';
import { buildPresentation } from './building-presentation';
import { VillageWorkers, type FelledTree } from './village-workers';
import { WORKER_COLOURS } from './worker-figure';
import { TimberThatch } from './timber-thatch';
import { barracksPreviewPlacement, buildBarracks } from './barracks-factory';
import { buildUniversityMonuments } from './university-factory';
import { clonePreviewMaterial, bakedPlanKey, loadBakedBuilding, buildingAssets } from './building-assets';
import { buildInfrastructurePresentation } from './infrastructure-factory';
import { InfrastructureRenderer, type InfrastructureGesture } from './infrastructure-renderer';
import { RoadCellsPlan } from './road-cells-plan';
import { RoadCellPreview, type RoadCellPreviewTone } from './road-cell-preview';
import { TerraformPreview, type TerraformVisual } from './terraform-preview';
import { selectEquipment } from './equipment-selection';
import {
  infrastructureSurface,
  infrastructurePlanSurface,
  wrapCoordinate,
  type InfrastructureOperation,
  type RoadPixel,
  type SubPoint,
} from '@arbestra/contracts';
import { sciencePreview } from '../api/client';
import { villageRoadDisplayRoutes, roadEdges, ROAD_HALF_WIDTH } from './road-profile';
import { WeatherMap, WeatherMaterial } from './weather-view';
import { LocalRain } from './weather-rain';
import { weatherAt } from './weather';
import { SolarClock } from './solar-clock';
import {
  arrivalFrame,
  landingPose,
  townHallFocus,
  VILLAGE_LANDING,
  type LandingPose,
  type VillageArrival,
} from './village-arrival';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import '@babylonjs/core/Culling/ray';
import { BoundingBox } from '@babylonjs/core/Culling/boundingBox';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { COSMOLOGY, TAU, combinedPeriod, cyclePhase, cyclePhases, illumination } from './cosmology';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Mesh as BabylonMesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Rendering/edgesRenderer';
// Register line shaders with the scene's module graph before any LinesMesh is
// rendered; a missing registration falls back to fetching a .fx URL from Vite.
import '@babylonjs/core/Shaders/color.vertex';
import '@babylonjs/core/Shaders/color.fragment';
// StandardMaterial also needs its shaders registered explicitly. Otherwise
// Babylon asks Vite for default.fx and receives index.html, blanking the scene.
import '@babylonjs/core/Shaders/default.vertex';
import '@babylonjs/core/Shaders/default.fragment';
import { Scene } from '@babylonjs/core/scene';

import type {
  NaturalFeature,
  StoneDeposit,
  TerrainChunk,
  TerrainOverview,
  TravelCell,
  VillageCell,
  VillageState,
} from '@arbestra/contracts';

import type { ScreenAnchor } from '../ui/WorldContextMenu';
import { WorldSpace, terrainDemand, delta, normalize } from './world-space';
import { TerrainStore } from './terrain-store';
import { TerrainRenderer } from './terrain-renderer';
import { CloudTransition } from './cloud-transition';
import { LodTransition } from './lod-transition';
import { RegionalVillages } from './regional-villages';
import { RegionalOverview, TorusOverview } from './terrain-overview-view';
import { RENDER_UNIT_CELLS } from './terrain-unit';
import { TERRAIN_STREAMING } from './terrain-settings';
import { bakeScenery, cloneWoodland, type SceneryPart } from './scenery-batch';
import { groveHasStumps, groveSlots, isStumpPiece, treePieceData, type GroveSlot, type TreePiece } from './grove-trees';
import { GroveInstances, type TreeLook } from './grove-instances';
import { GroveTrunkIndex } from './grove-trunks';
import { changedCases, queuedMode, woodQueue, type WoodQueue } from './wood-queue';
import { LongPress, treesAlongSegment, type GestureTree } from './wood-gesture';
import { VillageRoads } from './village-roads';
import { setSceneNight, VillageBraziers } from './village-braziers';
import { cellKey, cellsAlongSegment, type AreaPreview, type Cell } from './construction-selection';
import { gardenTileStage } from './tile-appearance';
import { GardenPlots } from './garden-plots';
import { siteSignature } from './site-signature';
import { easeIncidence, skyLight } from './sky-light';
import { fetchGardenKit, gardenHarvestState, GardenKitRenderer, type GardenPlotView } from './garden-kit';
import { freezeStaticHierarchy, refreshStaticHierarchy } from './static-transforms';
import { RenderDiagnostics } from '../dev/render-diagnostics';
import type { HarvestMode } from './halo-marker';
import { ResourceHalos, type ResourceHaloCell } from './resource-halos';
import { TreeHalos, treeHalos, type TreeHaloGrove } from './tree-halos';
import { MarketBeacon } from './market-beacon';
import { groveRayPredicate, pickedGrove, resourceOverlay } from './resource-overlay';
import { WorkerObstacles } from './worker-obstacles';

const TOWN_HALL_DOOR_Z = -1.1;
/** A rendered tree a gesture can designate (docs/SPEC-GRAMMAIRE-GESTUELLE.md §3). */
const gestureTree = (featureId: string, slot: GroveSlot): GestureTree => ({
  featureId,
  treeIndex: slot.treeIndex,
  slot: slot.index,
  x: slot.tree.x,
  y: slot.tree.y,
});
/** A tree a harvest gesture designates: its case and server index (null: the whole case). */
export interface HarvestTree {
  featureId: string;
  treeIndex: number | null;
}
/** A tree of a grove sheet: its state and what the village's queue does with it. */
export interface GroveTreeRow {
  slot: number;
  treeIndex: number | null;
  state: GroveSlot['state'];
  remaining: number;
  queued: 'cut' | 'clear' | null;
}
import {
  buildingPlan,
  planShapeKey,
  recipeFor,
  doorConnector,
  doorLaneOffset,
  planForSite,
  resolveMurets,
  transformPoint,
  type BuildingPlan,
} from './building-plan';
import type { DoorLane } from './worker-motion';
const TILE_SIZE = 2.5;
/** Base of the road cells renderer: no stroke, so a gesture never replays the historical plan. */
const EMPTY_ROAD_PLAN = Object.freeze(emptyInfrastructure());

import { InitialVillageLoad, type InitialLoadProgress } from './initial-village-load';
import { DemolitionTint } from './demolition-tint';
import { flatRoadGeometry } from './infrastructure-surface-geometry';
export type TerrainStatus = 'loading' | 'retry' | null;
export type TerrainViewMode = 'village' | 'region' | 'world';

function percentile(values: number[]): number {
  if (!values.length) return 0;
  return [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * 0.95)]!;
}

/** Inputs compared by identity: unchanged references mean unchanged content. */
function sameInputs(previous: readonly unknown[], next: readonly unknown[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}
/** Surface tint of water, under its ripples; multiplied by the material alpha. */
export const WATER_SURFACE_VEIL = 'rgba(78, 140, 196, 0.5)';

export class BabylonVillageScene {
  readonly #engine: Engine;
  readonly #scene: Scene;
  readonly #sceneStats: SceneInstrumentation | null;
  readonly #renderDiagnostics: RenderDiagnostics | null;
  readonly #camera: ArcRotateCamera;
  readonly #canvas: HTMLCanvasElement;
  readonly #villageMeshes: Mesh[] = [];
  readonly #sceneryGeometry = new Map<string, Mesh>();
  readonly #sceneryData = new Map<string, VertexData>();
  readonly #waterRippleTexture: DynamicTexture;
  readonly #waterRippleMaterial: StandardMaterial;
  readonly #workers: VillageWorkers;
  readonly #inhabitantCamera: InhabitantCamera;
  #selectedRepresentative: string | null = null;
  readonly #buildingJobs: Array<{ parent: Mesh; steps: Generator<void, Mesh, unknown>; siteId: string }> = [];
  #workerDebugAt = 0;
  #selectedFeatureId: string | null = null;
  readonly #onFeatureSelected: (featureId: string, anchor: ScreenAnchor) => void;
  readonly #selectableMeshes = new Map<string, Mesh>();
  readonly #onSiteSelected: (siteId: string, anchor: ScreenAnchor, inspect?: boolean) => void;
  readonly #onCameraMoved: () => void;
  readonly #onTerrainLoading: (loading: TerrainStatus) => void;
  #terrainLoading: TerrainStatus = null;
  #initialLoad = new InitialVillageLoad();
  #initialProgress: InitialLoadProgress | null = null;
  #initialRoutesReady = false;
  // A state published after the initial routes were prepared: redraw them
  // once the load completes rather than restart that long phase.
  #initialRoutesStale = false;
  #initialRoutesAnnounced = false;
  #initialFailure: string | null = null;
  readonly #onAreaGesture: (first: Cell, last: Cell, commit: boolean) => void;
  /** A harvest designation: a cell (gardens, stone), or with `tree` one tree of a wood case. */
  readonly #onGardenHarvest: (
    cell: Cell | null,
    newGesture: boolean,
    previewOnly?: boolean,
    tree?: HarvestTree,
  ) => void;
  readonly #onWorldGestureCancelled: () => void;
  readonly #previewMeshes: Mesh[] = [];
  readonly #resourceHalos: ResourceHalos;
  readonly #treeHalos: TreeHalos;
  readonly #marketBeacon: MarketBeacon;
  /** Foot of the town hall the current beacon stands on (canonical cell, ground height). */
  #marketBeaconAnchor: { cellX: number; cellY: number; height: number } | null = null;
  readonly #levelingAreaMaterial: StandardMaterial;
  readonly #invalidAreaMaterial: StandardMaterial;
  readonly #resizeObserver: ResizeObserver;
  readonly #siteMaterial: StandardMaterial;
  readonly #candidateMaterial: StandardMaterial;
  readonly #timberMaterial: StandardMaterial;
  readonly #lightTimberMaterial: StandardMaterial;
  readonly #darkTimberMaterial: StandardMaterial;
  readonly #roofMaterial: StandardMaterial;
  #timberThatch: TimberThatch | null = null;
  #preparing = false;
  #starterGhost: StarterGhost | null = null;
  #ghostRequest: Parameters<BabylonVillageScene['updateConstructionGhost']> | null = null;
  #areaRequest: Parameters<BabylonVillageScene['updateAreaSelection']> | null = null;
  #starterManual: (() => void) | null = null;
  #constructionGhost: Mesh | null = null;
  #constructionGhostCode: string | null = null;
  #ghostMaterials: StandardMaterial[] = [];
  #ghostOwnMaterials: Set<import('@babylonjs/core/Materials/material').Material> = new Set();

  #buildingCache = new Map<string, { signature: string; mesh: Mesh }>();
  #buildingGenerationCount = 0;
  #factoryGenerationCount = 0;
  readonly #stoneMaterial: StandardMaterial;
  readonly #pebbleMaterial: StandardMaterial;
  readonly #windowMaterial: StandardMaterial;
  readonly #soilMaterial: StandardMaterial;
  readonly #gardenTileMaterials: StandardMaterial[];
  #gardenPlots: GardenPlots | null = null;
  #gardenKit: GardenKitRenderer | null = null;
  #gardenKitRequested = false;
  #gardenKitInputs: unknown[] = [];
  #gardenHarvesting = false;
  #lastUpdate: Parameters<BabylonVillageScene['update']> | null = null;
  #weather: WeatherMap | null = null;
  readonly #rain: LocalRain;
  #rainIntensity = 0;
  readonly #leafMaterial: StandardMaterial;
  readonly #leafLightMaterial: StandardMaterial;
  readonly #leafDarkMaterial: StandardMaterial;
  readonly #trunkMaterial: StandardMaterial;
  readonly #woodlandMaterial: MultiMaterial;
  #treeKitMaterial: StandardMaterial | null = null;
  /** Grove trees felled by a worksite, by lot: masked in their grove. */
  readonly #felledTrees = new Map<string, { featureId: string; index: number; timer: number }>();
  /**
   * Grove trunks per chunk and cell for the felling test, which asks thousands
   * of times a frame: rebuilding the chunk and its groves on each call froze the
   * page for over a minute. A chunk is read again only when it changed, and only
   * its groves whose trees changed are placed again; felling is checked live.
   */
  #trunkIndex: GroveTrunkIndex | null = null;
  /**
   * Rendered groves, tree by tree (docs/SPEC-BOIS-ARBRE-UNITE.md §2): their
   * thin instances, written per tree, and the trees a gesture can designate.
   * A tree that changes rewrites its own instances (grove-instances.ts).
   */
  readonly #groves = new Map<
    string,
    { feature: NaturalFeature; instances: GroveInstances; meshes: Map<TreePiece, Mesh>; trees: GestureTree[] }
  >();
  /** Rendered groves by deposit cell, for the trees a swipe crosses. */
  readonly #groveCells = new Map<string, Set<string>>();
  /** The village's wood queue (worksite targets), and the worksites it was read from. */
  #woodQueue: WoodQueue = new Map();
  #woodQueueSource: VillageState['village']['worksites'] | null = null;
  /** Wood tool mode: what a designated tree is for, and which trees are offered. */
  #woodMode: HarvestMode = 'cut';
  /** Pending designations of the harvest tool: trees validated, waiting for their receipt. */
  #pendingTrees: Array<{ featureId: string; treeIndex: number | null }> = [];
  /** Long press of the harvest gesture: switches cutting and clearing. */
  readonly #longPress = new LongPress();
  #onWoodModeToggle: ((point: { x: number; y: number }) => boolean) | null = null;
  readonly #constructionMaterial: StandardMaterial;
  readonly #scaffoldMaterial: StandardMaterial;
  readonly #selectionMaterial: StandardMaterial;
  readonly #contactShadowMaterial: StandardMaterial;
  #contactShadowSource: Mesh | null = null;
  readonly #packedEarthMaterial: StandardMaterial;
  readonly #sawdustMaterial: StandardMaterial;
  readonly #selectionMarker: Mesh;
  readonly #deepGround: Mesh;
  readonly #regionalOverview: RegionalOverview;
  readonly #regionalVillages: RegionalVillages;
  readonly #clouds: CloudTransition;
  readonly #transition = new LodTransition(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450);
  #pendingView: TerrainViewMode | null = null;
  #arrival: { started: number; name: string; time: string; from: LandingPose; fromTarget: TravelCell } | null = null;
  #flyover: { requested: number; started: number | null; landing: boolean; local?: boolean } | null = null;
  #geographyRevision = 0;
  #globalModelAvailable(): boolean {
    return sciencePreview() || this.#state?.science?.globalModelAvailable === true;
  }
  readonly #flyoverKey = (event: KeyboardEvent): void => {
    if (!this.#initialLoad.ready) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]'))
      return;
    if (event.code === 'KeyV' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      this.startFlyover();
    } else if (event.code === 'KeyC' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (!import.meta.env.DEV || !this.#cosmologyDebug || !this.#globalModelAvailable()) return;
      event.preventDefault();
      event.stopPropagation();
      this.#endFlyover();
      this.skipArrival(true);
      this.#pendingCatView = true;
      this.showWorld();
      if (this.#mode === 'world' && !this.#transition.active && this.#torusOverview) {
        this.#torusOverview.showCatEyes();
        this.#pendingCatView = false;
      }
    } else if (event.key === 'Escape' && this.#flyover) {
      event.preventDefault();
      event.stopPropagation();
      this.#endFlyover();
      this.skipArrival(true);
    }
  };
  #arrivalPending = false;
  #presentationLight = 1;
  #baseSolar = 0;
  #baseAmbient = 0.34;
  /** Sun incidence the lighting follows, eased in time; null until the first update. */
  #skyIncidence: number | null = null;
  #skyAt = 0;
  #arrivalNextAt = 0;
  #clock: SolarClock | null = null;
  #eyesSince: number | null = null;
  #eyesRetryAt = 0;
  #villagesLoading = false;
  #villagesDue = 0;
  #villagesCenter = '';
  #projectionRetryAt = 0;
  #returnRadius = 260;
  #returnAlpha = 0;
  #returnBeta = 0;

  #torusOverview: TorusOverview | null = null;
  #overview: TerrainOverview | null = null;
  #overviewAbort: AbortController | null = null;
  #overviewLoading = false;
  #vegetationLoading = false;
  #vegetationDue = 0;
  #overviewRetryAt = 0;
  #requestedWorld = false;
  #worldFromWheel = false;
  readonly #solarLight: DirectionalLight;
  readonly #ambientLight: HemisphericLight;
  #cosmologyDebug = false;
  #cosmologyPhase: number | null = null;
  #villageSolarPreview: number | null = null;
  #cosmologyPeriod: number = COSMOLOGY.periodMs;
  #pendingSolarProfile = false;
  #pendingCatView = false;
  #cosmologyNextAt = 0;
  #cosmologyServerOffsetMs = 0;
  #cosmologyMetrics = {
    phase: 0,
    torusPhase: 0,
    sunPhase: 0,
    rotationPeriodMs: COSMOLOGY.periodMs as number,
    u: 0,
    v: 0,
    direct: 1,
    occluded: false,
    paused: false,
    updateMs: 0,
    worldRenderMs: 0,
    worldMeshes: 0,
    shadowBytes: 0,
  };
  #lastViewChangeAt = 0;
  #mode: TerrainViewMode = 'village';
  readonly #onViewChanged: (mode: TerrainViewMode) => void;
  readonly #reducedQuality =
    navigator.webdriver && (import.meta.env.PROD || !new URLSearchParams(location.search).has('terrainPerf'));
  #buildableGrid: Mesh | null = null;
  #buildableArea: Mesh | null = null;
  #travelLines: Mesh | null = null;
  #travelSurface: Mesh | null = null;
  #villageRoads: VillageRoads | null = null;
  #villageBraziers: VillageBraziers | null = null;
  #villageNight = false;
  #lastTravelSignature = '';
  #lastTravelCells = '';
  #travelCells: { routes: VillageState['travelRoutes']; selected: string | null; json: string } | null = null;
  #brazierInputs: unknown[] = [];
  #selectedSiteId: string | null = null;
  #highlightedSiteIds = new Set<string>();
  #constructionMode = false;
  #selectingArea = false;
  #harvestableSites = new Set<string>();
  #fullGardenSites = new Set<string>();
  #gardenStages = new Map<string, number>();
  #hoveredHarvestCell = '';
  #harvestVisited = new Set<string>();
  #villageAnchor: Cell = { cellX: 0, cellY: 0 };
  #space: WorldSpace | null = null;
  #store: TerrainStore | null = null;
  #renderer: TerrainRenderer | null = null;
  #state: VillageState | null = null;
  #worldMode: 'exploration' | 'exploitation' | 'population' | 'construction' | 'terraform' = 'exploration';
  #terraformRenderer: TerraformPreview | null = null;
  #terraformVisual: TerraformVisual | null = null;
  public terraformPreview(value: TerraformVisual | null) {
    this.#terraformVisual = value;
    if (!this.#space) return;
    this.#terraformRenderer ??= new TerraformPreview(this.#scene);
    this.#terraformRenderer.update(value, this.#space);
    if (import.meta.env.MODE === 'e2e')
      this.#canvas.dataset.terraformSelection = JSON.stringify(
        value
          ? {
              origin: value.origin,
              cells: value.quote.cells,
              triangles: this.#scene.meshes
                .filter((m) => m.name === 'terraform-future-ground')
                .reduce((n, m) => n + m.getTotalIndices() / 3, 0),
              at: performance.now(),
            }
          : null,
      );
  }
  #demolitionTint: DemolitionTint | null = null;
  #demolitionIndex: {
    state: VillageState;
    cells: Map<string, Array<{ cellX: number; cellY: number }>>;
    types: Map<string, string>;
    roads: Map<string, RoadPixel[]>;
  } | null = null;
  #demolitionBuildings = new Map<string, Mesh>();
  #demolitionRoads = new Set<string>();
  #demolitionRoadFrame = 0;
  /** Colours one designated target in red. Called once per newly swept target, never per frame. */
  public demolitionMark(kind: 'building' | 'road' | 'equipment', id: string) {
    const state = this.#state,
      space = this.#space;
    if (!state || !space) return;
    if (this.#demolitionIndex?.state !== state) {
      const cells = new Map<string, Array<{ cellX: number; cellY: number }>>(),
        types = new Map<string, string>(),
        roads = new Map<string, RoadPixel[]>();
      for (const cell of state.cells) {
        const building = cell.footprint?.buildingId ?? cell.building?.id;
        if (!building) continue;
        types.set(building, cell.footprint?.buildingType ?? cell.building?.type ?? '');
        const list = cells.get(building) ?? [];
        list.push(cell);
        cells.set(building, list);
      }
      // Same pixel-to-cell rounding as the swipe's road index.
      if (state.infrastructure)
        for (const p of infrastructurePlanSurface(state.infrastructure, state.world).values()) {
          if (!p.manual || p.material === 'none') continue;
          const key = `${Math.floor((p.x + 8) / 16) % space.width}:${Math.floor((p.y + 8) / 16) % space.height}`,
            list = roads.get(key) ?? [];
          list.push(p);
          roads.set(key, list);
        }
      this.#demolitionIndex = { state, cells, types, roads };
    }
    const tint = (this.#demolitionTint ??= new DemolitionTint(this.#scene));
    if (kind === 'road') {
      this.#demolitionRoads.add(id);
      // A swipe adds many cells per frame: the skin is rebuilt once, on the next frame.
      this.#demolitionRoadFrame ||= requestAnimationFrame(() => {
        this.#demolitionRoadFrame = 0;
        this.#drawDemolitionRoads();
      });
    } else if (kind === 'equipment') tint.tint(`equipment:${id}`, this.#villageBraziers?.meshesOf(id) ?? []);
    else if (this.#demolitionIndex.types.get(id) === 'garden')
      for (const cell of this.#demolitionIndex.cells.get(id) ?? []) {
        const p = space.project(cell);
        tint.patch(`garden:${cell.cellX}:${cell.cellY}`, {
          x: p.x,
          y: (this.#store?.ground(cell.cellX, cell.cellY)?.height ?? 0) + 0.19,
          z: p.z,
          width: TILE_SIZE * 0.98,
          depth: TILE_SIZE * 0.98,
        });
      }
    else {
      const root = this.#buildingCache.get(id)?.mesh;
      if (!root) return;
      this.#demolitionBuildings.set(id, root);
      tint.tint(`building:${id}`, [root]);
    }
  }
  public demolitionClear() {
    cancelAnimationFrame(this.#demolitionRoadFrame);
    this.#demolitionRoadFrame = 0;
    this.#demolitionRoads.clear();
    this.#demolitionBuildings.clear();
    this.#demolitionTint?.clear();
  }
  #drawDemolitionRoads() {
    const index = this.#demolitionIndex;
    if (!this.#space || !this.#state || !index || !this.#demolitionTint) return;
    const pixels = new Map<string, RoadPixel>();
    for (const cell of this.#demolitionRoads)
      for (const p of index.roads.get(cell) ?? []) pixels.set(`${p.x}:${p.y}`, p);
    this.#demolitionTint.road(
      pixels.size
        ? flatRoadGeometry(
            pixels,
            this.#space,
            (x, y) => this.#store?.ground(x, y)?.height ?? null,
            this.#state.world.generationVersion === 3,
            0.07,
          )
        : null,
    );
  }
  /** A rebuilt or late-loaded building keeps its designation colour. */
  #retintDemolition() {
    for (const [id, root] of this.#demolitionBuildings) {
      const current = this.#buildingCache.get(id)?.mesh;
      if (!current || (current === root && this.#demolitionTint?.count(`building:${id}`))) continue;
      this.#demolitionBuildings.set(id, current);
      this.#demolitionTint?.tint(`building:${id}`, [current]);
    }
  }
  public terrainVertexHeight(x: number, y: number) {
    return this.#store?.vertexHeight(x, y) ?? null;
  }
  #infrastructureRenderer: InfrastructureRenderer | null = null;
  #infrastructurePreview: InfrastructureRenderer | null = null;
  readonly #roadCellsPlan = new RoadCellsPlan();
  #renderedRoadPlan: import('@arbestra/contracts').InfrastructurePlan | null = null;
  #roadCellsRenderer: InfrastructureRenderer | null = null;
  #roadCellPreview: RoadCellPreview | null = null;
  /** Designated cells of a road gesture: one instance per new cell, never a rebuild. */
  public roadCellsPreviewAdd(cells: readonly { cellX: number; cellY: number }[]) {
    const space = this.#space;
    if (!space) return;
    const preview = (this.#roadCellPreview ??= new RoadCellPreview(this.#scene));
    for (const cell of cells) {
      const p = space.project(cell);
      preview.add(
        `${cell.cellX}:${cell.cellY}`,
        p.x,
        (this.#store?.ground(cell.cellX, cell.cellY)?.height ?? 0) + 0.08,
        p.z,
        TILE_SIZE * 0.86,
      );
    }
    preview.visible(this.#mode === 'village');
  }
  public roadCellsPreviewTone(tone: RoadCellPreviewTone) {
    (this.#roadCellPreview ??= new RoadCellPreview(this.#scene)).tone(tone);
  }
  public roadCellsPreviewClear() {
    this.#roadCellPreview?.clear();
  }
  #infrastructureHandler: ((gesture: InfrastructureGesture) => void) | null = null;
  #infrastructureHoverFrame = 0;
  #infrastructureHoverEvent: PointerEvent | null = null;
  #infrastructureDown: { x: number; y: number; pointerId: number } | null = null;
  #infrastructureBarriers = new Set<string>();
  #infrastructureEquipment: Array<{ x: number; y: number }> = [];
  #infrastructureGhost: Mesh | null = null;
  public infrastructureTool(handler: ((gesture: InfrastructureGesture) => void) | null) {
    if (!handler) {
      this.cancelGesture();
      cancelAnimationFrame(this.#infrastructureHoverFrame);
      this.#infrastructureHoverFrame = 0;
      this.#infrastructureHoverEvent = null;
    }
    this.#infrastructureHandler = handler;
    if (!handler) {
      this.#infrastructurePreview?.clear();
      this.#infrastructureGhost?.setEnabled(false);
    }
  }
  public infrastructurePreview(
    operation: InfrastructureOperation | null,
    invalid = false,
    preparedPlan?: import('@arbestra/contracts').InfrastructurePlan,
    preparedSurface?: ReadonlyMap<string, import('@arbestra/contracts').RoadPixel>,
  ) {
    if (!this.#space || !this.#state) return;
    this.#infrastructurePreview ??= new InfrastructureRenderer(this.#scene);
    this.#infrastructureGhost?.setEnabled(false);
    if (!operation) {
      this.#infrastructurePreview.clear();
      return;
    }
    if (operation.kind === 'road') {
      const world = this.#state.world,
        next = preparedPlan ?? prepareInfrastructureEdit(this.#state, operation, 'preview').next;
      const selected = infrastructureSurface([{ ...operation.stroke, operation: 'paint' }], world),
        full = preparedSurface ?? infrastructurePlanSurface(next, world);
      const surface = new Map([...selected].map(([key, p]) => [key, { ...(full.get(key) ?? p), manual: true }]));
      this.#infrastructurePreview.update(
        next,
        this.#space,
        (x, y) => this.#store?.ground(x, y)?.height ?? null,
        true,
        0,
        surface,
        operation.stroke.operation === 'border',
        [],
        { followTerrain: this.#state.world.generationVersion === 3 },
      );
      this.#infrastructurePreview.setInvalid(invalid);
    } else if (operation.kind === 'place' || operation.kind === 'move') {
      this.#infrastructurePreview.clear();
      this.#infrastructureGhost ??= buildInfrastructurePresentation(this.#scene, {
        fixture: 'brazier',
        material: 'earth',
        width: 4,
        border: false,
        length: 1,
        quarterTurns: 0,
      });
      const p = this.#space.project({ cellX: operation.position.x / 8, cellY: operation.position.y / 8 });
      const cell = {
        cellX: wrapCoordinate(Math.floor(operation.position.x / 8 + 0.5), this.#space.width),
        cellY: wrapCoordinate(Math.floor(operation.position.y / 8 + 0.5), this.#space.height),
      };
      const height = this.#store?.ground(cell.cellX, cell.cellY)?.height;
      this.#infrastructureGhost.position.set(p.x, (height ?? 0) + 0.02, p.z);
      this.#infrastructureGhost.rotation.y = (operation.quarterTurns * Math.PI) / 2;
      this.#infrastructureGhost.setEnabled(height !== undefined && this.#mode === 'village');
      for (const mesh of this.#infrastructureGhost.getChildMeshes()) {
        mesh.isPickable = false;
        if (mesh.material instanceof StandardMaterial) {
          mesh.material.alpha = 0.6;
          mesh.material.emissiveColor = Color3.FromHexString(invalid ? '#a82f25' : '#2a557b');
        }
      }
    }
  }
  public equipmentAt(
    point: SubPoint,
    pickedId?: string,
  ): { id: string; version: number; position: SubPoint; quarterTurns: number } | null {
    const plan = this.#state?.infrastructure;
    if (!plan || !this.#space) return null;
    const manual = plan.equipment.map((e) => ({
      id: e.id,
      version: e.version,
      position: { x: e.x, y: e.y },
      quarterTurns: e.quarterTurns,
    }));
    const selected = selectEquipment(
      manual,
      point,
      { widthCells: this.#space.width, heightCells: this.#space.height },
      pickedId,
    );
    if (selected) return selected;
    return selectEquipment(
      automaticBraziers(this.#state!).map((e) => ({ id: e.id, version: 0, position: e.position, quarterTurns: 0 })),
      point,
      { widthCells: this.#space.width, heightCells: this.#space.height },
      pickedId,
    );
  }
  #infrastructurePoint(event: PointerEvent): SubPoint | null {
    const p = this.#gridPointAtPointer(event);
    return p && this.#space
      ? {
          x: wrapCoordinate(Math.round(p.cellX * 8), this.#space.width * 8),
          y: wrapCoordinate(Math.round(p.cellY * 8), this.#space.height * 8),
        }
      : null;
  }
  #populationFocus: string | null = null;
  #populationFilter = 'all';
  #resourceOverlayAt = 0;
  #showTravel = false;
  #selectedRoute: string | null = null;
  #projectionVersion = -1;
  #projectionGroundRevision = -1;
  #projectionGroundKey = '';
  #demandAt = 0;
  #metricsAt = 0;
  #frameMs: number[] = [];
  #streamMs: number[] = [];
  #viewSignature = '';
  #terrainDemand: ReturnType<typeof terrainDemand> = [];
  #terrainIntersects: ((x: number, y: number, size: number) => boolean) | undefined;
  readonly #resumeTerrain = (): void => {
    this.#eyesSince = null;
    if (document.hidden) this.#handlePointerCancel();
    else this.#store?.revalidate();
  };
  #spaceNavigation = false;
  #onBuildingHover: (id: string | null) => void = () => {};
  #constructionAction: 'build' | 'upgrade' | 'extend' | null = null;
  readonly #navigationKeyDown = (event: KeyboardEvent): void => {
    if (!this.#initialLoad.ready) return;
    if (event.key === 'Escape') {
      this.#cameraFocus = null;
      const owned = Boolean(this.#pointerDown?.harvest || this.#pointerDown?.mouseArea);
      this.#handlePointerCancel();
      if (owned) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (event.code !== 'Space' || (event.target as HTMLElement | null)?.closest('input, textarea, select, button'))
      return;
    this.#spaceNavigation = true;
    this.#cameraFocus = null;
    if (this.#pointerDown?.harvest || this.#pointerDown?.mouseArea) this.#handlePointerCancel();
  };
  readonly #navigationKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') this.#spaceNavigation = false;
  };

  #pointerDown: {
    x: number;
    y: number;
    pointerId: number;
    inspect: boolean;
    mouseArea: boolean;
    harvest: boolean;
    first: Cell | null;
    lastPoint: Cell | null;
    /** Harvest: something designated yet (a tap at release, a swipe once it moves). */
    started?: boolean;
    /** Harvest: the tree under the press. */
    firstTree?: GestureTree | null;
  } | null = null;
  #lastDragCell = '';
  #lastPreviewSignature = '';
  #lastVisualSignature = '';
  #serverOffsetMs = 0;
  // Measured by the App when the state arrives; update() runs after network
  // and module loading, so its own reading would lag by that delay.
  #serverOffsetMeasured = false;
  #lastFrameAt = 0;
  #cameraFocus: { from: Cell; to: Cell; at: number; duration: number; radius: number; height: number } | null = null;
  #lastCameraRadius: number | null = null;
  #initialCameraFramed = false;
  #e2eCells: Array<{ id: string; x: number; z: number; cellX: number; cellY: number }> = [];
  #e2eFeatures: Array<{ id: string; x: number; z: number }> = [];
  #worldWidthUnits = 2048 * TILE_SIZE;
  #worldHeightUnits = 1024 * TILE_SIZE;

  readonly #handlePointerDown = (event: PointerEvent): void => {
    this.#cameraFocus = null;
    if (event.button === 2 && this.#starterManual && this.#worldMode === 'construction') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#starterManual();
      return;
    }
    if (
      this.#infrastructureHandler &&
      this.#mode === 'village' &&
      !this.#arrival &&
      !this.#flyover &&
      !this.#spaceNavigation &&
      (event.button === 0 || event.button === 2)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.#worldMode === 'terraform' && (!event.isPrimary || this.#infrastructureDown)) return;
      if (event.button === 2) this.#infrastructureHandler({ kind: 'right', point: this.#infrastructurePoint(event) });
      else {
        this.#infrastructureDown = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        this.#canvas.setPointerCapture(event.pointerId);
        this.#infrastructureHandler({ kind: 'down', point: this.#infrastructurePoint(event) });
      }
      return;
    }
    if (this.#inhabitantCamera.mode === 'pov' || this.#inhabitantCamera.mode === 'free') return;
    if (this.#transition.active || this.#arrival || this.#flyover) return;
    if (!event.isPrimary) {
      this.#handlePointerCancel();
      return;
    }
    if (event.button !== 0) return;
    if (this.#spaceNavigation) return;
    if (this.#mode === 'world') {
      this.#pointerDown = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        inspect: event.shiftKey,
        mouseArea: false,
        harvest: false,
        first: null,
        lastPoint: null,
      };
      return;
    }
    if (this.#mode === 'region') return;
    const mouseArea = this.#selectingArea && this.#worldMode === 'construction' && !event.shiftKey;
    const first = this.#cellAtPointer(event);
    let workshopInspection = false;
    if (this.#worldMode === 'exploitation' && this.#state) {
      const bounds = this.#canvas.getBoundingClientRect();
      const pick = this.#scene.pick(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        (mesh) => mesh.isEnabled() && mesh.isVisible && mesh.isPickable && typeof mesh.metadata?.siteId === 'string',
      );
      const site = this.#state.cells.find((c) => c.id === pick.pickedMesh?.metadata?.siteId);
      const building =
        site?.building ?? this.#state.cells.find((c) => c.building?.id === site?.footprint?.buildingId)?.building;
      workshopInspection =
        !!building &&
        (building.type === 'town-hall' ||
          this.#state.buildingTypes.some((t) => t.code === building.type && t.productionMode === 'processing'));
    }
    const harvest = this.#worldMode === 'exploitation' && first !== null && !event.shiftKey && !workshopInspection;
    const point = this.#gridPointAtPointer(event);
    this.#pointerDown = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      inspect: event.shiftKey || workshopInspection,
      mouseArea,
      harvest,
      first,
      lastPoint: point,
      started: false,
      firstTree: harvest ? this.#treeAtPointer(event, point) : null,
    };
    if (mouseArea || harvest) {
      // Consume only the construction drag. Right-drag, wheel and touch camera
      // gestures keep their usual controls.
      event.stopImmediatePropagation();
      event.preventDefault();
      this.#canvas.setPointerCapture(event.pointerId);
      this.#camera.inertialAlphaOffset = this.#camera.inertialBetaOffset = 0;
      this.#camera.inertialPanningX = this.#camera.inertialPanningY = 0;
      if (first) {
        this.#lastDragCell = cellKey(first);
        // A harvest press designates nothing yet: held still, it switches
        // cutting and clearing (docs/SPEC-GRAMMAIRE-GESTUELLE.md §2); released,
        // it is a tap; moved, a swipe.
        if (harvest) this.#longPress.start(event.clientX, event.clientY, performance.now());
        else this.#onAreaGesture(first, first, false);
      }
    }
  };

  readonly #handlePointerMove = (event: PointerEvent): void => {
    if (
      this.#infrastructureHandler &&
      this.#mode === 'village' &&
      !this.#arrival &&
      !this.#flyover &&
      !this.#spaceNavigation
    ) {
      if (
        this.#worldMode === 'terraform' &&
        (!event.isPrimary || (this.#infrastructureDown && this.#infrastructureDown.pointerId !== event.pointerId))
      )
        return;
      event.stopImmediatePropagation();
      this.#infrastructureHoverEvent = event;
      // At most one terrain ray and one HUD update per display frame.
      if (!this.#infrastructureHoverFrame)
        this.#infrastructureHoverFrame = requestAnimationFrame(() => {
          this.#infrastructureHoverFrame = 0;
          const latest = this.#infrastructureHoverEvent;
          this.#infrastructureHoverEvent = null;
          if (
            latest &&
            this.#infrastructureHandler &&
            this.#mode === 'village' &&
            !this.#arrival &&
            !this.#flyover &&
            !this.#spaceNavigation
          )
            this.#infrastructureHandler({ kind: 'hover', point: this.#infrastructurePoint(latest) });
        });
      return;
    }
    if (
      !this.#pointerDown &&
      this.#worldMode === 'exploitation' &&
      this.#mode === 'village' &&
      !this.#arrival &&
      !this.#flyover
    ) {
      const cell = this.#cellAtPointer(event),
        key = cell ? cellKey(cell) : '';
      if (cell && key !== this.#hoveredHarvestCell) {
        this.#hoveredHarvestCell = key;
        this.#onGardenHarvest(cell, true, true);
      }
    }
    if (
      !this.#pointerDown &&
      this.#worldMode === 'construction' &&
      this.#constructionAction === 'upgrade' &&
      this.#mode === 'village'
    ) {
      const bounds = this.#canvas.getBoundingClientRect();
      const pick = this.#scene.pick(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        (mesh) => mesh.isEnabled() && mesh.isVisible && mesh.isPickable && typeof mesh.metadata?.siteId === 'string',
      );
      this.#onBuildingHover(pick.pickedMesh?.metadata?.siteId ?? null);
    }
    if (this.#pointerDown?.harvest && this.#pointerDown.pointerId === event.pointerId) {
      event.stopImmediatePropagation();
      event.preventDefault();
      // A long press switched the mode: the rest of the gesture designates nothing.
      if (this.#longPress.fired) return;
      if (!this.#pointerDown.started) {
        if (!this.#longPress.move(event.clientX, event.clientY)) return;
        this.#beginHarvest();
      }
      this.#continueHarvest(event);
      return;
    }
    if (this.#pointerDown?.mouseArea && this.#pointerDown.pointerId === event.pointerId) {
      event.stopImmediatePropagation();
      const last = this.#cellAtPointer(event);
      if (last && this.#pointerDown.first && cellKey(last) !== this.#lastDragCell) {
        this.#lastDragCell = cellKey(last);
        this.#onAreaGesture(this.#pointerDown.first, last, false);
      }
      return;
    }
    if (!this.#pointerDown && this.#selectingArea && this.#worldMode === 'construction' && this.#mode === 'village') {
      const cell = this.#cellAtPointer(event);
      if (cell && cellKey(cell) !== this.#lastDragCell) {
        this.#lastDragCell = cellKey(cell);
        this.#onAreaGesture(cell, cell, false);
      }
      return;
    }
    if (!this.#pointerDown || Math.hypot(event.clientX - this.#pointerDown.x, event.clientY - this.#pointerDown.y) < 8)
      return;
    this.#pointerDown = null;
    this.#clearSelection();
  };

  readonly #handlePointerUp = (event: PointerEvent): void => {
    if (
      this.#worldMode === 'terraform' &&
      this.#infrastructureDown &&
      this.#infrastructureDown.pointerId !== event.pointerId
    )
      return;
    if (this.#infrastructureHandler && this.#infrastructureDown) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const d = this.#infrastructureDown;
      this.#infrastructureDown = null;
      const bounds = this.#canvas.getBoundingClientRect();
      const picked = this.#scene.pick(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        (mesh) =>
          mesh.isEnabled() && mesh.isVisible && mesh.isPickable && typeof mesh.metadata?.equipmentId === 'string',
      );
      this.#infrastructureHandler({
        kind: 'up',
        point: this.#infrastructurePoint(event),
        equipmentId: picked?.pickedMesh?.metadata?.equipmentId,
        drag: Math.hypot(event.clientX - d.x, event.clientY - d.y) > 8,
      });
      if (this.#canvas.hasPointerCapture(event.pointerId)) this.#canvas.releasePointerCapture(event.pointerId);
      return;
    }
    if (this.#transition.active) return;
    if (!this.#pointerDown || this.#pointerDown.pointerId !== event.pointerId) return;
    if (this.#mode === 'world') {
      const gesture = this.#pointerDown;
      this.#pointerDown = null;
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 8 && this.#torusOverview) {
        const bounds = this.#canvas.getBoundingClientRect();
        const chosen = this.#torusOverview.select(event.clientX - bounds.left, event.clientY - bounds.top);
        if (import.meta.env.DEV) this.#canvas.dataset.worldPick = chosen ? `${chosen.cellX},${chosen.cellY}` : 'none';
        if (chosen) {
          this.#worldTarget = chosen;
          this.#torusOverview.focus(chosen);
          this.#torusOverview.mark(this.#villageAnchor, chosen);
        }
      }
      return;
    }
    if (this.#mode === 'region') {
      this.#pointerDown = null;
      return;
    }
    const gesture = this.#pointerDown;
    if (gesture.harvest) {
      if (!this.#endsOnWorldSurface(event)) {
        this.#handlePointerCancel();
        return;
      }
      const switched = this.#longPress.fired;
      this.#longPress.end();
      if (!switched) {
        // A tap designates the element under it.
        if (!gesture.started) this.#beginHarvest();
        this.#continueHarvest(event);
        this.#onGardenHarvest(null, false);
      }
      this.#pointerDown = null;
      event.stopImmediatePropagation();
      event.preventDefault();
      if (this.#canvas.hasPointerCapture(event.pointerId)) this.#canvas.releasePointerCapture(event.pointerId);
      return;
    }
    if (gesture.mouseArea) {
      if (!this.#endsOnWorldSurface(event)) {
        this.#handlePointerCancel();
        return;
      }
      this.#pointerDown = null;
      event.stopImmediatePropagation();
      if (this.#canvas.hasPointerCapture(event.pointerId)) this.#canvas.releasePointerCapture(event.pointerId);
      const last = this.#cellAtPointer(event);
      if (gesture.first && last) this.#onAreaGesture(gesture.first, last, true);
      return;
    }
    const moved = Math.hypot(event.clientX - this.#pointerDown.x, event.clientY - this.#pointerDown.y);
    this.#pointerDown = null;
    if (moved >= 8) return;

    if (this.#selectingArea && this.#worldMode === 'construction' && !gesture.inspect) {
      const cell = this.#cellAtPointer(event);
      if (cell) this.#onAreaGesture(cell, cell, true);
      return;
    }

    const bounds = this.#canvas.getBoundingClientRect();
    const picked = this.#scene.pick(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      (mesh) =>
        mesh.isEnabled() &&
        mesh.isVisible &&
        mesh.isPickable &&
        (typeof mesh.metadata?.siteId === 'string' ||
          typeof mesh.metadata?.featureId === 'string' ||
          (this.#worldMode === 'population' && typeof mesh.metadata?.populationId === 'string')),
    );
    const pickedMetadata = picked.pickedMesh?.metadata;
    if (this.#worldMode === 'population' && typeof pickedMetadata?.populationId === 'string') {
      this.#onSiteSelected(`representative:${pickedMetadata.representativeId}`, { x: event.clientX, y: event.clientY });
      return;
    }
    const featureId = (
      picked.thinInstanceIndex >= 0
        ? pickedMetadata?.instanceFeatureIds?.[picked.thinInstanceIndex]
        : pickedMetadata?.featureId
    ) as string | undefined;
    if (featureId) {
      if (this.#worldMode !== 'exploitation') return;
      this.#selectedSiteId = null;
      this.#applySelection();
      this.#selectedFeatureId = featureId;
      this.#applyFeatureSelection();
      this.#onFeatureSelected(featureId, { x: event.clientX, y: event.clientY });
      return;
    }
    const siteId = picked.pickedMesh?.metadata?.siteId as string | undefined;
    if (siteId) this.selectSite(siteId, { x: event.clientX, y: event.clientY }, gesture.inspect);
    else this.#clearSelection();
  };
  /** React cancellation and native cancellation clear the same pointer owner. */
  public cancelGesture(): void {
    if (this.#infrastructureDown) {
      const down = this.#infrastructureDown;
      this.#infrastructureDown = null;
      if (this.#canvas.hasPointerCapture(down.pointerId)) this.#canvas.releasePointerCapture(down.pointerId);
      this.#infrastructureHandler?.({ kind: 'cancel', point: null });
    }
    const gesture = this.#pointerDown;
    this.#pointerDown = null;
    this.#longPress.end();
    this.#lastDragCell = '';
    this.#hoveredHarvestCell = '';
    this.#harvestVisited.clear();
    if (gesture && this.#canvas.hasPointerCapture(gesture.pointerId))
      this.#canvas.releasePointerCapture(gesture.pointerId);
  }
  readonly #handlePointerCancel = (): void => {
    const hadWorldGesture = Boolean(this.#pointerDown?.harvest || this.#pointerDown?.mouseArea);
    this.cancelGesture();
    if (hadWorldGesture) this.#onWorldGestureCancelled();
  };
  public setConstructionAction(
    action: 'build' | 'upgrade' | 'extend' | null,
    onHover: (id: string | null) => void,
  ): void {
    if (action !== this.#constructionAction) {
      this.cancelGesture();
      this.#lastDragCell = '';
    }
    this.#constructionAction = action;
    this.#onBuildingHover = onHover;
  }
  readonly #handleWheel = (event: WheelEvent): void => {
    this.#cameraFocus = null;
    if (this.#inhabitantCamera.active) return;
    if (this.#flyover) return;
    if (this.#pointerDown?.harvest || this.#pointerDown?.mouseArea) this.#handlePointerCancel();
    if (
      this.#mode === 'world' &&
      event.deltaY < 0 &&
      this.#torusOverview &&
      this.#torusOverview.camera.radius <= (this.#torusOverview.camera.lowerRadiusLimit ?? 5.8) * 1.1
    )
      this.showRegion();
    // Zooming inside Village must retain the logical building and its outline,
    // including when its graphical representation changes LOD.
    else if (this.#mode === 'region' || (this.#mode === 'village' && !this.#selectedSiteId)) this.#clearSelection();
  };

  #endsOnWorldSurface(event: PointerEvent): boolean {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    return element === this.#canvas;
  }

  /**
   * The first designation of a harvest gesture (a tap, or a press that starts
   * to move): the tree under the press, else its cell (gardens, stone). It
   * opens the gesture's draft (`newGesture`).
   */
  #beginHarvest(): void {
    const gesture = this.#pointerDown;
    if (!gesture?.first) return;
    gesture.started = true;
    this.#harvestVisited = new Set([cellKey(gesture.first)]);
    const tree = gesture.firstTree && this.#designatable(gesture.firstTree) ? gesture.firstTree : null;
    if (tree) {
      this.#harvestVisited.add(`tree:${tree.featureId}:${tree.slot}`);
      this.#onGardenHarvest(this.#groveCell(tree.featureId) ?? gesture.first, true, false, {
        featureId: tree.featureId,
        treeIndex: tree.treeIndex,
      });
    } else this.#onGardenHarvest(gesture.first, true);
  }

  /**
   * The rest of a harvest swipe (docs/SPEC-GRAMMAIRE-GESTUELLE.md §1-§2): every
   * tree and stump it crosses, each once, in the order met (the tree under the
   * pointer, and those along the segment since the last sample, read from the
   * rendered groves of the cells crossed); every garden or stone cell crossed.
   */
  #continueHarvest(event: PointerEvent): void {
    const last = this.#gridPointAtPointer(event),
      previous = this.#pointerDown?.lastPoint;
    const under = this.#treeAtPointer(event, last);
    if (under) this.#designateTree(under);
    if (!last || !previous) return;
    const world = {
      widthCells: this.#worldWidthUnits / TILE_SIZE,
      heightCells: this.#worldHeightUnits / TILE_SIZE,
    };
    const crossed = cellsAlongSegment(previous, last, world),
      start = {
        cellX: normalize(Math.round(previous.cellX), world.widthCells),
        cellY: normalize(Math.round(previous.cellY), world.heightCells),
      };
    for (const tree of treesAlongSegment(previous, last, this.#treesNear([start, ...crossed], world), world))
      this.#designateTree(tree);
    for (const cell of crossed) {
      if (!this.#harvestVisited.has(cellKey(cell))) {
        this.#harvestVisited.add(cellKey(cell));
        this.#onGardenHarvest(cell, false);
      }
    }
    this.#pointerDown!.lastPoint = last;
  }

  /** Whether the wood tool can take this tree now: cutting, a tree with wood free; clearing, anything still there. */
  #designatable(tree: GestureTree): boolean {
    const slot = this.#groves.get(tree.featureId)?.instances.slots[tree.slot];
    if (!slot) return false;
    return this.#woodMode === 'cut'
      ? (slot.state === 'standing' || slot.state === 'felled') && slot.available > 0
      : slot.state !== 'removed';
  }
  #designateTree(tree: GestureTree): void {
    const key = `tree:${tree.featureId}:${tree.slot}`;
    if (this.#harvestVisited.has(key) || !this.#designatable(tree)) return;
    this.#harvestVisited.add(key);
    const cell = this.#groveCell(tree.featureId);
    if (cell) this.#onGardenHarvest(cell, false, false, { featureId: tree.featureId, treeIndex: tree.treeIndex });
  }
  #groveCell(featureId: string): Cell | null {
    const feature = this.#groves.get(featureId)?.feature;
    return feature ? { cellX: feature.cellX, cellY: feature.cellY } : null;
  }
  /** Rendered trees of the cells a swipe crossed and of their neighbours: an index lookup, O(those trees). */
  #treesNear(cells: readonly Cell[], world: { widthCells: number; heightCells: number }): GestureTree[] {
    const groves = new Set<string>();
    for (const cell of cells)
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = (cell.cellX + dx + world.widthCells) % world.widthCells,
          y = (cell.cellY + dy + world.heightCells) % world.heightCells;
        for (const id of this.#groveCells.get(`${x}:${y}`) ?? []) groves.add(id);
      }
    return [...groves].flatMap((id) => this.#groves.get(id)?.trees ?? []);
  }

  public constructor(
    canvas: HTMLCanvasElement,
    onSiteSelected: (siteId: string, anchor: ScreenAnchor, inspect?: boolean) => void,
    onCameraMoved: () => void,
    onAreaGesture: (first: Cell, last: Cell, commit: boolean) => void,
    onFeatureSelected: (featureId: string, anchor: ScreenAnchor) => void = () => {},
    onGardenHarvest: (
      cell: Cell | null,
      newGesture: boolean,
      previewOnly?: boolean,
      tree?: HarvestTree,
    ) => void = () => {},
    onWorldGestureCancelled: () => void = () => {},
    onTerrainLoading: (loading: TerrainStatus) => void = () => {},
    onViewChanged: (mode: TerrainViewMode) => void = () => {},
    private readonly onArrival: (arrival: VillageArrival | null) => void = () => {},
    private readonly onEyesFound: () => void = () => {},
    private readonly onInitialLoad: (progress: InitialLoadProgress) => void = () => {},
    private readonly transport: SceneTransport = playerSceneTransport,
  ) {
    this.#canvas = canvas;
    this.#canvas.dataset.workerModel = 'low-poly';
    // Browser checks read the rendered trees on demand, never per frame.
    if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
      Object.defineProperty(canvas, 'arbestraTreeScreens', { configurable: true, value: () => this.#treeScreens() });
      Object.defineProperty(canvas, 'arbestraFocusCell', {
        configurable: true,
        value: (cell: Cell) => this.focusCell(cell),
      });
    }
    this.#onFeatureSelected = onFeatureSelected;
    this.#onSiteSelected = onSiteSelected;
    this.#onCameraMoved = onCameraMoved;
    this.#onAreaGesture = onAreaGesture;
    this.#onGardenHarvest = onGardenHarvest;
    this.#onWorldGestureCancelled = onWorldGestureCancelled;
    this.#onTerrainLoading = onTerrainLoading;
    this.#onViewChanged = onViewChanged;
    this.#engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
    this.#engine.maxFPS = this.#reducedQuality ? 5 : 45;
    this.#engine.setHardwareScalingLevel(Math.max(this.#reducedQuality ? 4 : 1.2, window.devicePixelRatio / 1.5));
    this.#scene = new Scene(this.#engine);
    selectEnabledCandidates(this.#scene);
    this.#sceneStats =
      import.meta.env.DEV || import.meta.env.MODE === 'e2e' || devToolsEnabled()
        ? new SceneInstrumentation(this.#scene)
        : null;
    if (this.#sceneStats) {
      this.#sceneStats.captureActiveMeshesEvaluationTime = true;
      this.#sceneStats.captureRenderTime = true;
    }
    this.#renderDiagnostics = this.#sceneStats
      ? new RenderDiagnostics(this.#engine, this.#scene, this.#sceneStats)
      : null;
    this.#scene.skipPointerMovePicking = true;
    this.#scene.clearColor = Color4.FromHexString('#8ea0a0ff');
    this.#scene.fogMode = Scene.FOGMODE_LINEAR;
    this.#scene.fogColor = Color3.FromHexString('#8ea0a0');
    this.#scene.fogStart = 280;
    this.#scene.fogEnd = 500;
    this.#scene.imageProcessingConfiguration.exposure = 0.92;
    this.#scene.imageProcessingConfiguration.contrast = 1.18;

    this.#camera = new ArcRotateCamera(
      'strategic-camera',
      -Math.PI / 2 + 0.9,
      0.84,
      window.innerWidth < 600 ? 64 : 42,
      new Vector3(0, 0.45, 0),
      this.#scene,
    );
    this.#camera.fov = 0.55;
    this.#camera.lowerRadiusLimit = 8;
    this.#camera.upperRadiusLimit = 680;
    this.#camera.lowerBetaLimit = 0.05;
    this.#camera.upperBetaLimit = 0.95;
    this.#camera.panningSensibility = 105;
    this.#camera.panningAxis = new Vector3(1, 0, 1);
    this.#camera.wheelDeltaPercentage = 0.008;
    this.#camera.pinchDeltaPercentage = 0.008;
    this.#camera.inertia = 0.72;
    this.#camera.attachControl(canvas, true);

    const daylight = new HemisphericLight('daylight', new Vector3(-0.35, 1, -0.25), this.#scene);
    this.#ambientLight = daylight;
    daylight.diffuse = new Color3(0.92, 0.94, 0.79);
    daylight.groundColor = new Color3(0.18, 0.22, 0.14);
    daylight.intensity = 0.58;
    const sun = new DirectionalLight('sun', new Vector3(-0.62, -1, 0.42), this.#scene);
    this.#solarLight = sun;
    sun.diffuse = new Color3(1, 0.82, 0.58);
    sun.position = new Vector3(24, 34, -24);
    sun.intensity = 0.8;
    sun.shadowFrustumSize = 46;
    sun.autoCalcShadowZBounds = true;

    this.#siteMaterial = this.#material('available-site', '#647442', 0);
    this.#candidateMaterial = this.#material('extension-candidate', '#39ff14', 1, '#39ff14');
    this.#levelingAreaMaterial = this.#material('leveling-area', '#ffb52e', 1, '#ffb52e');
    this.#levelingAreaMaterial.disableLighting = true;
    this.#levelingAreaMaterial.backFaceCulling = false;
    this.#invalidAreaMaterial = this.#material('invalid-area', '#ff2020', 1, '#ff2020');
    this.#candidateMaterial.disableLighting = true;
    this.#invalidAreaMaterial.disableLighting = true;
    this.#candidateMaterial.backFaceCulling = false;
    this.#invalidAreaMaterial.backFaceCulling = false;
    this.#timberMaterial = this.#material('timber', '#794521');
    this.#lightTimberMaterial = this.#material('light-timber', '#a8672f');
    this.#darkTimberMaterial = this.#material('dark-timber', '#402718');
    this.#roofMaterial = this.#material('roof', '#5d3226');
    this.#stoneMaterial = this.#material('stone', '#686a5f');
    this.#pebbleMaterial = this.#material('pebbles', '#777968');
    this.#windowMaterial = this.#material('window', '#d6a44e', 1, '#35240f');
    this.#soilMaterial = this.#material('soil', '#684025');
    this.#waterRippleTexture = this.#createWaterRippleTexture();
    this.#waterRippleMaterial = this.#material('water-ripples', '#d0eded', 0.32);
    this.#waterRippleMaterial.diffuseTexture = this.#waterRippleTexture;
    this.#waterRippleMaterial.useAlphaFromDiffuseTexture = true;
    this.#waterRippleMaterial.backFaceCulling = false;
    this.#waterRippleMaterial.specularColor.set(0, 0, 0);
    this.#gardenTileMaterials = Array.from({ length: 8 }, (_, index) => this.#tileMaterial('garden', index));
    this.#leafMaterial = this.#material('leaves', '#3f6c35');
    this.#leafLightMaterial = this.#material('leaves-light', '#668442');
    this.#leafDarkMaterial = this.#material('leaves-dark', '#294e2d');
    for (const material of [this.#leafMaterial, this.#leafLightMaterial, this.#leafDarkMaterial])
      new WeatherMaterial(
        material,
        'leaves',
        () => this.#weather,
        () => this.#space,
      );
    for (const material of [this.#soilMaterial, ...this.#gardenTileMaterials])
      new WeatherMaterial(
        material,
        'ground',
        () => this.#weather,
        () => this.#space,
      );
    new WeatherMaterial(
      this.#waterRippleMaterial,
      'water',
      () => this.#weather,
      () => this.#space,
    );
    this.#rain = new LocalRain(this.#scene, (x, z) => {
      const cell = this.#space?.inverse(x, z);
      return cell ? (this.#store?.ground(cell.cellX, cell.cellY)?.height ?? null) : null;
    });
    this.#trunkMaterial = this.#material('trunk', '#523620');
    let workerObstacles: {
      state: VillageState;
      version: number;
      routes: Array<{ destination: TravelCell; points: ReturnType<WorldSpace['path']> }>;
    } | null = null;
    let workerWidths: { routes: VillageState['travelRoutes']; widths: Map<string, number> } | null = null;
    const workerSpatial = new WorkerObstacles();
    this.#workers = new VillageWorkers(
      this.#scene,
      {
        skin: WORKER_COLOURS.skin.map((color, i) => this.#material(`worker-skin-${i}`, color)),
        clothes: WORKER_COLOURS.clothes.map((color, i) => this.#material(`worker-clothes-${i}`, color)),
        hair: WORKER_COLOURS.hair.map((color, i) => this.#material(`worker-hair-${i}`, color)),
        pants: this.#material('worker-pants', WORKER_COLOURS.pants),
        white: this.#material('worker-white', '#ffffff'),
        timber: this.#trunkMaterial,
        stone: this.#stoneMaterial,
      },
      {
        path: (path, lane) => this.#workerPath(path, lane),
        project: (cell) => this.#space!.project(cell),
        localPath: (path) => this.#pathPoints(path),
        leisurePath: (buildingId, path, lane) => this.#leisurePath(buildingId, path, lane),
        leisureVersion: () => this.#groundKey(),
        fellTree: (featureId, _near, lotId) => this.#fellTree(featureId, lotId),
        stageFree: (point, radius) => this.#stageFree(point, radius, workerSpatial),
        releaseTree: (lotId) => this.#releaseTree(lotId),
        key: (point) => {
          const cell = this.#space!.inverse(point.x, point.z);
          return `${cell.cellX.toFixed(3)}:${cell.cellY.toFixed(3)}`;
        },
        width: (point) => {
          if (!this.#state || !this.#space) return 0.8;
          if (workerWidths?.routes !== this.#state.travelRoutes) {
            const widths = new Map<string, number>();
            for (const edge of roadEdges(this.#state.travelRoutes))
              for (const cell of [edge.from, edge.to]) {
                const key = cellKey(cell);
                widths.set(key, Math.max(widths.get(key) ?? 0, edge.kind === 'paved' ? ROAD_HALF_WIDTH * 2 : 0.8));
              }
            workerWidths = { routes: this.#state.travelRoutes, widths };
          }
          const cell = this.#space.inverse(point.x, point.z);
          return (
            workerWidths.widths.get(
              `${Math.round(cell.cellX) % this.#space.width}:${Math.round(cell.cellY) % this.#space.height}`,
            ) ?? 0.8
          );
        },
        ground: (point) => {
          if (!this.#space || !this.#store) return null;
          const cell = this.#space.inverse(point.x, point.z);
          return this.#store.ground(cell.cellX, cell.cellY)?.height ?? null;
        },
        free: (point, radius, featureId, allowRoads = false) => {
          if (!this.#space || !this.#store || !this.#state) return false;
          workerSpatial.update(this.#state);
          for (const [dx, dz] of [
            [0, 0],
            [-radius, -radius],
            [radius, radius],
            [-radius, radius],
            [radius, -radius],
          ]) {
            const cell = this.#space.inverse(point.x + dx!, point.z + dz!),
              x = Math.round(cell.cellX) % this.#space.width,
              y = Math.round(cell.cellY) % this.#space.height;
            const ground = this.#store.ground(x, y);
            if (!ground || ground.code !== 1) return false;
            if (infrastructureBarrierAt(this.#infrastructureBarriers, cell, this.#state.world)) return false;
            if (workerSpatial.blocked(x, y, featureId)) return false;
          }
          const own = workerSpatial.feature(featureId);
          if (own) {
            const centre = this.#space.project(own);
            if (Math.hypot(point.x - centre.x, point.z - centre.z) < 0.42 + radius * 0.3) return false;
          }
          if (workerObstacles?.state !== this.#state || workerObstacles.version !== this.#space.version) {
            const routes = villageRoadDisplayRoutes(this.#state);
            workerObstacles = {
              state: this.#state,
              version: this.#space.version,
              routes: routes.map((r) => ({ destination: r.destination, points: this.#space!.path(r.cells) })),
            };
          }
          workerSpatial.updateEquipment(this.#infrastructureEquipment, this.#space);
          if (workerSpatial.equipmentBlocked(point, radius)) return false;
          if (!allowRoads)
            for (const route of workerObstacles.routes) {
              if (own && route.destination.cellX === own.cellX && route.destination.cellY === own.cellY) continue;
              const path = route.points;
              for (let i = 1; i < path.length; i++) {
                const a = path[i - 1]!,
                  b = path[i]!,
                  dx = b.x - a.x,
                  dz = b.z - a.z;
                const t = Math.max(
                  0,
                  Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)),
                );
                if (Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t) < radius + 0.53) return false;
              }
            }
          return true;
        },
        detailed: (point) =>
          Math.hypot(point.x - this.#camera.target.x, point.z - this.#camera.target.z) < 35 && this.#camera.radius < 95,
      },
    );
    this.#inhabitantCamera = new InhabitantCamera(
      this.#scene,
      this.#camera,
      canvas,
      (id) => this.#workers.representativePose(id),
      (x, z) => this.#walkGround(x, z),
      (x, z) => this.#canWalk(x, z),
      (id) => this.#workers.hideRepresentative(id),
    );
    this.#woodlandMaterial = new MultiMaterial('woodland-shared', this.#scene);
    this.#woodlandMaterial.subMaterials = [
      this.#trunkMaterial,
      this.#leafMaterial,
      this.#leafLightMaterial,
      this.#leafDarkMaterial,
    ];
    this.#constructionMaterial = this.#material('construction', '#c5a15d', 0.32, '#20170b');
    this.#constructionMaterial.wireframe = true;
    this.#scaffoldMaterial = this.#material('scaffold', '#9c7440', 0.88);
    this.#selectionMaterial = this.#material('selection', '#f2cf68', 1, '#6c4c13');
    this.#selectionMaterial.disableLighting = true;
    this.#contactShadowMaterial = this.#material('contact-shadow', '#17251a', 0.18);
    this.#contactShadowMaterial.disableLighting = true;
    this.#packedEarthMaterial = this.#material('packed-earth', '#4f5839');
    this.#sawdustMaterial = this.#material('sawdust', '#806b3d');

    this.#deepGround = this.#createTerrain();
    this.#regionalOverview = new RegionalOverview(
      this.#scene,
      () => this.#weather,
      () => this.#space,
    );
    this.#regionalVillages = new RegionalVillages(this.#scene, (x, y) => {
      const ground = this.#store?.ground(x, y)?.height;
      if (ground !== undefined) return ground;
      const data = this.#overview;
      if (!data) return null;
      const bx = Math.floor((normalize(x, data.world.widthCells) * data.gridWidth) / data.world.widthCells);
      const by = Math.floor((normalize(y, data.world.heightCells) * data.gridHeight) / data.world.heightCells);
      return (data.meanElevations[by * data.gridWidth + bx] ?? 0) * 0.025;
    });
    this.#clouds = new CloudTransition(this.#engine);
    for (const material of this.#scene.materials) material.freeze();
    this.#resourceHalos = new ResourceHalos(this.#scene);
    this.#treeHalos = new TreeHalos(this.#scene);
    // Prepared now, materials compiled, light in the fire cluster: a delivery creates nothing.
    this.#marketBeacon = new MarketBeacon(this.#scene);

    this.#selectionMarker = MeshBuilder.CreateBox(
      'selection-marker',
      { width: 2.64, depth: 2.64, height: 0.035 },
      this.#scene,
    );
    this.#selectionMarker.position.y = 0.12;
    this.#selectionMarker.material = this.#selectionMaterial;
    this.#selectionMarker.isPickable = false;
    this.#selectionMarker.enableEdgesRendering();
    this.#selectionMarker.edgesColor.set(1, 0.78, 0.24, 1);
    this.#selectionMarker.edgesWidth = 3;
    this.#selectionMarker.visibility = 0.08;
    this.#selectionMarker.isVisible = false;

    canvas.addEventListener('pointerdown', this.#handlePointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.#handlePointerMove, { capture: true });
    canvas.addEventListener('pointerup', this.#handlePointerUp, { capture: true });
    canvas.addEventListener('pointercancel', this.#handlePointerCancel, { capture: true });
    canvas.addEventListener('lostpointercapture', this.#handlePointerCancel);
    canvas.addEventListener('wheel', this.#handleWheel, { capture: true, passive: true });

    if (import.meta.env.MODE === 'e2e') {
      canvas.addEventListener('terrain-camera', this.#testCamera);
      canvas.addEventListener('terrain-metrics-reset', this.#testMetricsReset);
    }
    window.addEventListener('online', this.#resumeTerrain);
    window.addEventListener('blur', this.#handlePointerCancel);
    window.addEventListener('keydown', this.#flyoverKey, true);
    window.addEventListener('keydown', this.#navigationKeyDown, true);
    window.addEventListener('keyup', this.#navigationKeyUp, true);
    document.addEventListener('visibilitychange', this.#resumeTerrain);
    this.#resizeObserver = new ResizeObserver(() => {
      this.#engine.resize();
      this.#torusOverview?.fit(this.#engine);
    });
    this.#resizeObserver.observe(canvas);
    this.#engine.runRenderLoop(() => {
      if (this.#initialFailure) return;
      try {
        const now = performance.now();
        const measureFrame = statisticsEnabled();
        const frame = measureFrame ? new FrameTimings(now) : undefined;
        let renderMs = 0;
        const wasTransitioning = this.#transition.active;
        const wasLocked = this.#transition.locked;
        this.#transition.update(now, this.#clouds.covered, this.#clouds.ready);
        if (!wasLocked && this.#transition.locked) {
          this.#camera.detachControl();
          this.#torusOverview?.camera.detachControl();
        }
        if (wasTransitioning && !this.#transition.active) {
          if (!this.#flyover)
            (this.#mode === 'world' ? this.#torusOverview?.camera : this.#camera)?.attachControl(this.#canvas, true);
          if (this.#transition.failed) {
            this.#projectionRetryAt = now + 5000;
            this.#requestedWorld = false;
            this.#pendingView = null;
            this.#pendingCatView = false;
          }
          const pending = this.#pendingView;
          this.#pendingView = null;
          if (pending === 'world') this.showWorld();
          else if (pending === 'region') this.showRegion();
          else if (pending === 'village') this.showVillage();
        }
        if (this.#pendingCatView && this.#mode === 'world' && !this.#transition.active && this.#torusOverview) {
          this.#torusOverview.showCatEyes();
          this.#pendingCatView = false;
        }
        this.#updateFlyover(now);
        if (
          !this.#flyover &&
          !this.#transition.active &&
          this.#mode === 'world' &&
          this.#torusOverview &&
          this.#torusOverview.camera.radius <= (this.#torusOverview.camera.lowerRadiusLimit ?? 5.8) * 1.03
        )
          this.showRegion();
        this.#updateArrival(now);
        if (this.#mode !== 'world') {
          this.#updateCameraFocus(now);
          this.#wrapCamera();
          if (!this.#arrival && !this.#inhabitantCamera.active) this.#updateCameraProfile();
          this.#updateViewMode();
          if (import.meta.env.DEV && this.#space) {
            const target = this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
            this.#canvas.dataset.viewTarget = `${Math.floor(target.cellX)},${Math.floor(target.cellY)}`;
          }
        }
        frame?.mark('camera');
        if (this.#mode !== 'world') {
          this.#streamTerrain(now, frame);
          frame?.mark('streamingStats');
          if (this.#space) {
            this.#regionalOverview.update(
              this.#space,
              this.#space.inverse(this.#camera.target.x, this.#camera.target.z),
            );
            if (this.#store)
              this.#regionalOverview.fitGround(
                (x, y) => this.#store?.ground(x, y) ?? null,
                this.#store.groundRevision,
                now,
              );
          }
        }
        if (!this.#initialLoad.ready) {
          this.#advanceBuildings();
          const progress = this.#observeInitialLoad(false);
          if (progress.phase === 'routes' && !progress.error) {
            // Let React paint the actual phase before starting its synchronous work.
            if (!this.#initialRoutesAnnounced) {
              this.#initialRoutesAnnounced = true;
              return;
            }
            this.#refreshBuildingGround();
            this.#workers.reproject();
            this.#projectionGroundKey = this.#groundKey();
            this.#updateTravelPaths(this.#state!, this.#showTravel, this.#selectedRoute, frame);
            this.#projectionVersion = this.#renderer!.version;
            this.#projectionGroundRevision = this.#store!.groundRevision;
            this.#initialRoutesReady = true;
            return;
          }
          if (progress.phase !== 'render' || progress.error) return;
        } else this.#loadOverview(now);
        if (this.#space && this.#state) {
          const blend = Math.max(0, Math.min(1, (this.#camera.radius - 110) / 50));
          this.#villageRoads?.show(this.#mode === 'world' ? 0 : 1);
          this.#regionalOverview.detailBlend(blend);
          for (const root of this.#villageMeshes)
            for (const mesh of [root, ...root.getChildMeshes()]) {
              const visibility = (mesh.metadata?.baseVisibility ?? 1) * (this.#mode === 'world' ? 0 : 1);
              // Native building instances share source visibility; each instance still owns culling/picking.
              const target =
                'sourceMesh' in mesh
                  ? (mesh as import('@babylonjs/core/Meshes/instancedMesh').InstancedMesh).sourceMesh
                  : mesh;
              if (target.visibility !== visibility) target.visibility = visibility;
            }
          this.#regionalVillages.update(this.#space, this.#state.village.id, this.#store?.groundRevision ?? 0);
          for (const mesh of this.#renderer?.meshes() ?? []) {
            mesh.visibility = this.#overview ? 1 - blend : 1;
          }
          this.#canvas.dataset.regionalVillages = String(this.#regionalVillages.meshes.size);
        }
        frame?.mark('visibility');
        const workerServerNow = Date.now() - this.#serverOffsetMs;
        // A finger held still sends no event: the long press is polled here, O(1).
        if (this.#pointerDown?.harvest && this.#longPress.poll(now)) this.#switchWoodMode();
        this.#updateResourceOverlay(now);
        if (this.#space && this.#store) {
          const halosEnabled = this.#worldMode === 'exploitation' && this.#mode === 'village',
            zoomOpacity = 1 - (this.#camera.radius - 110) / 50;
          this.#resourceHalos.update(now, this.#space, this.#store, halosEnabled, zoomOpacity);
          this.#treeHalos.update(now, this.#space, this.#store, halosEnabled, zoomOpacity);
        }
        if (import.meta.env.DEV && now - this.#workerDebugAt > 500) {
          this.#canvas.dataset.workerTraffic = JSON.stringify(this.#workers.metrics);
          this.#workerDebugAt = now;
        }
        this.#weather?.update(Date.now() + this.#cosmologyServerOffsetMs);
        this.#updateCosmology(Date.now() + this.#cosmologyServerOffsetMs, now);
        setSceneNight(this.#scene, this.#villageNight);
        this.#villageBraziers?.animate(now, this.#villageNight, this.#mode === 'world' ? 0 : 1);
        if (this.#marketBeacon.active && this.#space && this.#marketBeaconAnchor) {
          const foot = this.#space.project(this.#marketBeaconAnchor);
          this.#marketBeacon.update(now, foot.x, this.#marketBeaconAnchor.height, foot.z, this.#mode !== 'world');
        }
        if (this.#gardenKit && this.#state) {
          // A harvest removes plants over time: refresh its plots four times a second.
          const inputs = [
            this.#state,
            this.#groundKey(),
            this.#buildingGenerationCount,
            this.#gardenHarvesting ? Math.floor((Date.now() - this.#serverOffsetMs) / 250) : 0,
          ];
          if (!sameInputs(this.#gardenKitInputs, inputs)) {
            this.#gardenKitInputs = inputs;
            this.#gardenKit.setPlots(this.#gardenPlotViews(this.#state));
          }
          this.#gardenKit.show(this.#mode !== 'world');
          this.#gardenKit.update(this.#camera.globalPosition);
        }
        this.#rain.update(
          this.#camera.target,
          this.#rainIntensity,
          this.#mode === 'village' && this.#camera.radius < 160,
        );
        this.#solarLight.intensity = this.#baseSolar * this.#presentationLight;
        this.#ambientLight.intensity = 0.08 + (this.#baseAmbient - 0.08) * this.#presentationLight;
        this.#regionalOverview.setPresentationLight(this.#presentationLight);
        frame?.mark('environment');
        if (this.#mode !== 'world') {
          this.#workers.animate(workerServerNow, this.#mode === 'village' && this.#camera.radius < 165);
          const figureBlend = 1 - Math.max(0, Math.min(1, (this.#camera.radius - 110) / 50));
          if (this.#selectedRepresentative && this.#workers.selectedRepresentative === null) {
            this.#selectedRepresentative = null;
            this.#inhabitantCamera.stop();
          }
          this.#workers.setPopulationFocus(
            this.#worldMode === 'population',
            this.#populationFocus,
            this.#populationFilter,
          );
          this.#inhabitantCamera.update(now);
          this.#workers.setVisibility(figureBlend);
          this.#animateWater(now);
          frame?.mark('population');
          const renderAt = measureFrame ? performance.now() : 0;
          this.#renderDiagnostics?.beforeRender(this.#scene);
          this.#scene.render();
          if (measureFrame) renderMs += performance.now() - renderAt;
          frame?.mark('render');
          this.#renderDiagnostics?.afterRender(this.#scene, 'village');
        } else {
          this.#workers.animate(workerServerNow, false);
          frame?.mark('population');
          const renderAt = measureFrame ? performance.now() : 0;
          if (this.#torusOverview) {
            this.#renderDiagnostics?.beforeRender(this.#torusOverview.scene);
            this.#torusOverview.scene.render();
          }
          if (measureFrame) renderMs += performance.now() - renderAt;
          frame?.mark('render');
          if (this.#torusOverview) this.#renderDiagnostics?.afterRender(this.#torusOverview.scene, 'world');
        }
        const cloudsAt = measureFrame ? performance.now() : 0;
        this.#clouds.render(this.#transition.alpha, now);
        if (measureFrame) renderMs += performance.now() - cloudsAt;
        frame?.mark('clouds');
        if (
          !this.#initialLoad.ready &&
          this.#scene.isReady() &&
          this.#observeInitialLoad(true).phase === 'ready' &&
          this.#initialRoutesStale &&
          this.#state
        )
          this.#updateTravelPaths(this.#state, this.#showTravel, this.#selectedRoute);
        if (this.#initialLoad.ready) this.#initialRoutesStale = false;
        const observing =
          this.#mode === 'world' &&
          !this.#flyover &&
          !this.#cosmologyDebug &&
          !this.#transition.active &&
          !document.hidden &&
          !this.#state?.village.accomplishments.some((item) => item.code === 'cat-eyes') &&
          this.#torusOverview?.eyesVisible();
        if (!observing) this.#eyesSince = null;
        else {
          this.#eyesSince ??= now;
          if (now - this.#eyesSince >= 1800 && now >= this.#eyesRetryAt) {
            this.#eyesRetryAt = now + 15000;
            this.onEyesFound();
          }
        }
        this.#canvas.dataset.cloudCover = String(this.#transition.alpha);
        if (import.meta.env.DEV && this.#mode === 'world')
          this.#canvas.dataset.worldCamera = JSON.stringify(this.#torusOverview?.navigationMetrics());
        // Felling layout of each wood site, readable in dev from the console.
        if (import.meta.env.DEV || import.meta.env.MODE === 'e2e' || devToolsEnabled()) {
          this.#canvas.dataset.woodPlan = JSON.stringify(this.#workers.woodPlans);
          this.#canvas.dataset.woodTrees = `${this.#woodMode} ${this.#groves.size} ${this.#groveWrites} ${this.#treeHalos.passes}`;
        }
        if (import.meta.env.MODE === 'e2e') {
          const viewport = this.#camera.viewport.toGlobal(
            this.#engine.getRenderWidth(),
            this.#engine.getRenderHeight(),
          );
          this.#canvas.dataset.worldInteractionReady = String(
            this.#mode === 'village' && !this.#transition.active && !this.#arrival && !this.#flyover,
          );
          this.#canvas.dataset.buildingScreens = JSON.stringify(
            this.#state?.cells.flatMap((site) => {
              if (!site.building) return [];
              const mesh = this.#buildingCache.get(site.building.id)?.mesh;
              if (!mesh) return [];
              const bounds = mesh.getHierarchyBoundingVectors(true),
                centre = bounds.min.add(bounds.max).scale(0.5);
              centre.y = bounds.max.y - 0.1;
              const point = Vector3.Project(centre, Matrix.Identity(), this.#scene.getTransformMatrix(), viewport);
              return [
                {
                  id: site.building.id,
                  x: point.x / this.#engine.getRenderWidth(),
                  y: point.y / this.#engine.getRenderHeight(),
                },
              ];
            }) ?? [],
          );
          this.#canvas.dataset.cellScreens = JSON.stringify(
            this.#e2eCells.map((cell) => {
              const point = Vector3.Project(
                new Vector3(cell.x, (this.#store?.ground(cell.cellX, cell.cellY)?.height ?? 0) + 0.075, cell.z),
                Matrix.Identity(),
                this.#scene.getTransformMatrix(),
                viewport,
              );
              return {
                id: cell.id,
                x: point.x / this.#engine.getRenderWidth(),
                y: point.y / this.#engine.getRenderHeight(),
              };
            }),
          );
          const renderedFeatures = new Map<string, { id: string; x: number; z: number }>();
          for (const mesh of this.#renderer?.meshes() ?? []) {
            const data = mesh.metadata as { featureId?: string; cellX: number; cellY: number } | null;
            if (data?.featureId && mesh.isEnabled())
              renderedFeatures.set(data.featureId, { id: data.featureId, ...this.#space!.project(data) });
          }
          this.#e2eFeatures = [...renderedFeatures.values()];
          this.#canvas.dataset.featureScreens = JSON.stringify(
            this.#e2eFeatures.map((feature) => {
              const point = Vector3.Project(
                new Vector3(feature.x, 0.4, feature.z),
                Matrix.Identity(),
                this.#scene.getTransformMatrix(),
                viewport,
              );
              return {
                id: feature.id,
                x: point.x / this.#engine.getRenderWidth(),
                y: point.y / this.#engine.getRenderHeight(),
              };
            }),
          );
          this.#canvas.dataset.camera = JSON.stringify([
            this.#camera.alpha,
            this.#camera.beta,
            this.#camera.radius,
            this.#camera.target.x,
            this.#camera.target.z,
          ]);
          this.#canvas.dataset.cameraLimits = JSON.stringify([
            this.#camera.lowerBetaLimit,
            this.#camera.upperBetaLimit,
          ]);
          this.#canvas.dataset.renderedPendingHarvests = String(
            this.#resourceHalos.pendingCount + this.#treeHalos.pendingCount,
          );
          this.#canvas.dataset.treeHalos = String(this.#treeHalos.instanceCount);
          this.#canvas.dataset.debugTravelPaths = String(this.#travelLines?.getTotalVertices() ?? 0);
          this.#canvas.dataset.workerPositions = JSON.stringify(
            [...this.#workers.figures].map((f) => ({
              id: f.root.name,
              enabled: f.root.isEnabled(),
              ...this.#space!.inverse(f.root.position.x, f.root.position.z),
            })),
          );
          this.#canvas.dataset.workerServerNow = String(workerServerNow);
          this.#canvas.dataset.workerFigures = String(this.#workers.figures.length);
          this.#canvas.dataset.workerVertices = String(
            this.#workers.figures.reduce(
              (sum, figure) =>
                sum + figure.root.getChildMeshes().reduce((parts, mesh) => parts + mesh.getTotalVertices(), 0),
              0,
            ),
          );
          this.#canvas.dataset.buildableGrid = JSON.stringify({
            construction: this.#constructionMode,
            minY: this.#buildableGrid?.getBoundingInfo().boundingBox.minimumWorld.y ?? null,
            vertices: this.#buildableGrid?.getTotalVertices() ?? 0,
            ready: this.#buildableGrid?.isReady(true) ?? false,
            blending: this.#buildableGrid?.material?.needAlphaBlending() ?? false,
            areaVertices: this.#buildableArea?.getTotalVertices() ?? 0,
            areaMinY: this.#buildableArea?.getBoundingInfo().boundingBox.minimumWorld.y ?? null,
          });
        }
        this.#frameMs.push(this.#lastFrameAt ? now - this.#lastFrameAt : 0);
        if (this.#frameMs.length > 3600) this.#frameMs.shift();
        this.#lastFrameAt = now;
        frame?.mark('diagnostics');
        this.#advanceBuildings();
        frame?.mark('buildings');
        if (measureFrame) recordFrame(now, renderMs, performance.now(), frame?.costs);
      } catch (error) {
        if (this.#initialLoad.ready) throw error;
        this.#initialFailure = 'La préparation du paysage a été interrompue.';
        this.#observeInitialLoad(false);
        console.error('Initial village preparation failed', error);
      }
    });
  }

  #observeInitialLoad(rendered: boolean): InitialLoadProgress {
    const assets = [...this.#buildingCache.values()].map((c) => c.mesh.metadata?.assetState);
    const progress = this.#initialLoad.observe({
      ground: this.#renderer?.groundProgress ?? { completed: 0, total: 0 },
      detailsPending: this.#renderer?.queued ?? 0,
      terrainFailed: this.#store?.degraded ?? false,
      buildingsPending: this.#buildingJobs.length > 0 || assets.includes('loading'),
      buildingsFailed: assets.includes('error'),
      routesPrepared: this.#initialRoutesReady,
      rendered,
    });
    if (this.#initialFailure) progress.error = this.#initialFailure;
    this.#canvas.dataset.initialLoad = progress.phase;
    this.#canvas.dataset.initialGround = `${progress.completed}/${progress.total}`;
    if (JSON.stringify(progress) !== JSON.stringify(this.#initialProgress)) {
      this.#initialProgress = progress;
      this.onInitialLoad(progress);
    }
    return progress;
  }

  public update(
    state: VillageState,
    highlightedSiteIds: string[] = [],
    constructionMode = false,
    showTravelPaths = false,
    selectedRouteId: string | null = null,
  ): void {
    this.#lastUpdate = [state, highlightedSiteIds, constructionMode, showTravelPaths, selectedRouteId];
    return clientTime('scene', () => {
      if (import.meta.env.DEV && new URLSearchParams(location.search).get('barracksPreview') === '1') {
        // Preview the new house kit without changing the server's persisted layouts.
        state = {
          ...state,
          cells: state.cells.map((cell) =>
            cell.building?.type === 'dwelling' && !cell.building.visualLayout
              ? {
                  ...cell,
                  building: {
                    ...cell.building,
                    visualLayout: {
                      recipe: 'stone-house',
                      version: 1,
                      quarterTurns: 0,
                      entranceFace: '-z',
                      offset: [0, 0],
                    },
                  },
                }
              : cell,
          ),
        };
      }
      this.#villageAnchor = { cellX: state.village.anchorCellX, cellY: state.village.anchorCellY };
      if (
        !this.#space ||
        this.#store?.world.id !== state.world.id ||
        this.#store.world.generationVersion !== state.world.generationVersion
      ) {
        this.#cameraFocus = null;
        this.#resourceHalos.clear();
        this.#treeHalos.clear();
        this.#renderer?.dispose();
        this.#store?.dispose();
        this.#endFlyover();
        this.#overviewAbort?.abort();
        this.#overviewAbort = new AbortController();
        this.#transition.cancel();
        this.#pendingView = null;
        this.#camera.attachControl(this.#canvas, true);
        this.#regionalOverview.clear();
        this.#regionalVillages.clear();
        this.#villagesLoading = false;
        this.#villagesDue = 0;
        this.#villagesCenter = '';
        this.#overview = null;
        this.#torusOverview?.dispose();
        this.#torusOverview = null;
        this.#overviewLoading = this.#vegetationLoading = false;
        this.#vegetationDue = 0;
        this.#requestedWorld = this.#worldFromWheel = false;
        this.#setMode('village');
        this.#space = new WorldSpace(state.world.widthCells, state.world.heightCells, this.#villageAnchor);
        this.#store = new TerrainStore(state, (chunks, signal, updatesOnly) =>
          this.#preparing
            ? fetch(
                '/api/worlds/' +
                  encodeURIComponent(state.world.slug) +
                  '/starter/terrain?chunks=' +
                  encodeURIComponent(chunks.map((c) => c.chunkX + ',' + c.chunkY).join(';')),
                { signal },
              ).then(async (r) => {
                if (!r.ok) throw Error('Terrain indisponible');
                return timedJson<TerrainResponse>(r);
              })
            : updatesOnly
              ? this.transport.getTerrainUpdates(state.world.slug, chunks, signal)
              : this.transport.getTerrain(state.world.slug, chunks, signal),
        );
        this.#weather?.dispose();
        this.#weather = new WeatherMap(this.#scene, state.world.id);
        this.#weather.update(Date.now() + this.#cosmologyServerOffsetMs);
        const material = this.#material('streamed-ground', '#ffffff');
        new WeatherMaterial(
          material,
          'ground',
          () => this.#weather,
          () => this.#space,
        );
        material.specularColor.set(0, 0, 0);
        material.backFaceCulling = state.world.generationVersion !== 3;
        material.diffuseTexture = new Texture(
          '/tiles/atlas.png',
          this.#scene,
          false,
          false,
          Texture.BILINEAR_SAMPLINGMODE,
        );
        material.freeze();
        this.#renderer = new TerrainRenderer(
          this.#scene,
          this.#store,
          this.#space,
          material,
          this.#waterRippleMaterial,
          (f) => this.#buildFeature(f),
          (c, x, y) => this.#buildDecor(c, x, y),
          (features) => this.#buildWoodland(features),
          () => this.#space!.inverse(this.#camera.target.x, this.#camera.target.z),
        );
        this.#renderer.onWoodlandUnchanged = (feature) => this.#updateGroveTrees(feature);
      }
      const revision = state.science?.geographyRevision ?? 0;
      if (this.#geographyRevision && revision !== this.#geographyRevision) {
        this.#store!.geographyChanged();
        this.#overviewAbort?.abort();
        this.#overviewAbort = new AbortController();
        this.#overview = null;
        this.#overviewLoading = false;
        this.#overviewRetryAt = 0;
        this.#vegetationLoading = false;
        this.#vegetationDue = 0;
        this.#villagesLoading = false;
        this.#villagesDue = 0;
      }
      this.#geographyRevision = revision;
      this.#state = state;
      this.#store!.observe(state);
      this.#observeWoodQueue(state.village.worksites);
      this.#showTravel = showTravelPaths;
      this.#selectedRoute = selectedRouteId;
      this.#torusOverview?.setGlobalModel(this.#globalModelAvailable());
      state = {
        ...state,
        cells: state.cells.map((c) => ({ ...c, ...this.#space!.projectFrom(c, this.#villageAnchor) })),
      };

      if (import.meta.env.MODE === 'e2e') {
        this.#e2eCells = state.cells.map(({ id, x, z, cellX, cellY }) => ({ id, x, z, cellX, cellY }));
      }
      if (!this.#initialCameraFramed) {
        const occupied = state.cells.filter((cell) => cell.footprint || cell.building);
        if (occupied.length) {
          const xs = occupied.map((cell) => cell.x),
            zs = occupied.map((cell) => cell.z);
          this.#camera.target.copyFromFloats(
            (Math.min(...xs) + Math.max(...xs)) / 2,
            0.45,
            (Math.min(...zs) + Math.max(...zs)) / 2,
          );
        }
        this.#initialCameraFramed = true;
      }
      this.#worldWidthUnits = state.world.widthCells * TILE_SIZE;
      this.#worldHeightUnits = state.world.heightCells * TILE_SIZE;
      this.#camera.upperRadiusLimit = Math.min(
        680,
        Math.max(80, Math.min(state.world.widthCells, state.world.heightCells) * TILE_SIZE * 0.7),
      );
      this.#deepGround.scaling.set(state.world.widthCells / 2048, 1, state.world.heightCells / 1024);
      if (!this.#serverOffsetMeasured) this.#serverOffsetMs = Date.now() - Date.parse(state.serverTime);
      // Start network transfers before the synchronous assembly of the campus.
      if (!this.#initialLoad.ready) this.#streamTerrain(performance.now());
      const plots = state.cells.flatMap((cell) => cell.building?.garden?.plots ?? []);
      this.#gardenStages = new Map(plots.map((plot) => [cellKey(plot), gardenTileStage(plot)]));
      if (!this.#gardenKitRequested && plots.length) {
        this.#gardenKitRequested = true;
        // The previous plots stay on screen until the kit arrives, then gardens alone rebuild.
        void fetchGardenKit().then(
          (kit) => {
            if (this.#scene.isDisposed) return;
            this.#gardenKit = new GardenKitRenderer(this.#scene, kit);
            if (this.#lastUpdate) this.update(...this.#lastUpdate);
          },
          (error) => console.error('Garden kit failed', error),
        );
      }
      this.#harvestableSites = new Set(
        state.cells.flatMap((cell) =>
          cell.building?.garden && !cell.building.garden.harvest
            ? cell.building.garden.plots.filter((plot) => plot.storedCarrots >= 1 && !plot.harvest).map(cellKey)
            : [],
        ),
      );
      this.#fullGardenSites = new Set(plots.filter((plot) => plot.full && !plot.harvest).map(cellKey));
      this.#workers.sync(state, Date.now() - this.#serverOffsetMs);
      // Prepare the baked legacy substrate once, but project route meshes only on complete ground.
      if (this.#initialLoad.ready) this.#updateTravelPaths(state, showTravelPaths, selectedRouteId);
      else {
        if (state.infrastructure) this.#renderer?.setInfrastructure(state.infrastructure);
        // A big village publishes faster than its routes are prepared: resetting
        // them here kept its loading screen up forever (Pinkystan, 26 October).
        if (this.#initialRoutesReady) this.#initialRoutesStale = true;
      }
      this.#canvas.dataset.buildingCount = String(state.cells.filter((site) => site.building).length);
      this.#canvas.dataset.completedBuildingCount = String(
        state.cells.filter((site) => site.building?.status === 'completed').length,
      );
      this.#canvas.dataset.underConstructionCount = String(
        state.cells.filter((site) => site.building?.status === 'under-construction').length,
      );
      const visualSignature = JSON.stringify({
        highlightedSiteIds,
        constructionMode,
        sites: state.cells.map((site) => [
          site.id,
          site.canBuild,
          site.building?.type,
          site.building?.status,
          site.building?.level,
          site.building?.targetLevel,
          site.footprint?.state,
          site.building?.visualLayout,
          site.cellX,
          site.cellY,
          this.#gardenStages.get(site.id),
          this.#fullGardenSites.has(site.id),
        ]),
        gardenKit: this.#gardenKit !== null,
      });
      this.#refreshBuildingGround();
      if (visualSignature === this.#lastVisualSignature) return;
      const generationStarted = performance.now();
      this.#lastVisualSignature = visualSignature;
      this.#villageMeshes.splice(0);
      this.#selectableMeshes.clear();
      this.#highlightedSiteIds = new Set(highlightedSiteIds);
      this.#constructionMode = constructionMode;
      this.#updateBuildableGrid(state);
      const planned = state.cells.flatMap((site) => {
        const plan = planForSite(state, site, (x, y) => this.#store?.ground(x, y)?.height ?? null);
        return plan ? [{ plan, anchor: site }] : [];
      });
      const boundaries = resolveMurets(planned, state.world);
      for (const { plan } of planned) if (plan.murets.length) plan.murets = boundaries.get(plan.id) ?? [];
      const plans = new Map(planned.map(({ plan }) => [plan.id, plan]));
      const retained = new Set<string>();
      for (const site of state.cells) {
        if (site.footprint && !site.building && site.footprint.buildingType !== 'garden') continue;
        const key = site.building?.id ?? site.id;
        const signature = siteSignature(state, site, {
          murets: plans.get(key)?.murets,
          gardenStage: this.#gardenStages.get(site.id),
          fullGarden: this.#fullGardenSites.has(site.id),
          gardenKit: this.#gardenKit !== null,
          highlighted: this.#highlightedSiteIds.has(site.id),
        });
        retained.add(key);
        let cached = this.#buildingCache.get(key);
        if (cached?.signature !== signature) {
          this.#buildingGenerationCount++;
          cached?.mesh.dispose(false, false);
          const mesh =
            site.building?.type === 'university'
              ? this.#createUniversity(site)
              : site.building?.visualLayout
                ? this.#createFactoryBuilding(site, plans.get(key)!)
                : site.building?.type === 'town-hall' && (site.building.targetLevel ?? site.building.level) >= 2
                  ? this.#createTownHall(site)
                  : site.building?.status === 'under-construction'
                    ? this.#createConstructionSite(site)
                    : site.footprint?.buildingType === 'garden'
                      ? this.#createGardenExtension(site)
                      : site.building
                        ? this.#createBuilding(site)
                        : this.#createAvailableSite(site);
          if (
            site.building &&
            site.building.type !== 'university' &&
            site.building.type !== 'stonemason' &&
            !site.building.visualLayout
          )
            mesh.rotation.y += ((site.building.quarterTurns ?? 0) * Math.PI) / 2;
          const base = this.#siteGround(site);
          const grounded =
            site.building?.visualLayout ||
            ['university', 'stonemason', 'garden'].includes(site.building?.type ?? '') ||
            site.footprint?.buildingType === 'garden';
          if (!grounded) mesh.position.y += base;
          mesh.metadata = { ...mesh.metadata, groundOffset: mesh.position.y - base };
          cached = { signature, mesh };
          this.#buildingCache.set(key, cached);
        }
        const mesh = cached.mesh;
        // Rebasing the local frame moves a campus; it does not change its geometry.
        if (site.building?.type === 'university') mesh.position.copyFrom(this.#universityCentre(site));
        if (!site.building && !site.footprint) {
          mesh.isVisible = this.#constructionMode && site.canBuild;
          mesh.material = this.#siteMaterial;
          for (const border of mesh.getChildMeshes()) border.isVisible = mesh.isVisible;
        }
        for (const selectable of [mesh, ...mesh.getChildMeshes()]) {
          selectable.metadata = { ...selectable.metadata, siteId: site.id };
          selectable.isPickable =
            Boolean(
              site.footprint || (this.transport.readOnly && site.building) || (this.#constructionMode && site.canBuild),
            ) &&
            !selectable.name.startsWith('garden-full-') &&
            !selectable.name.startsWith('site-border-') &&
            selectable.metadata?.buildingAttachment !== 'glass';
        }
        this.#villageMeshes.push(mesh);
        freezeStaticHierarchy(mesh);
        this.#selectableMeshes.set(site.id, mesh);
        if (site.building)
          for (const cell of state.cells.filter((c) => c.footprint?.buildingId === site.building!.id))
            this.#selectableMeshes.set(cell.id, mesh);
      }
      if (import.meta.env.DEV && new URLSearchParams(location.search).get('barracksPreview') === '1' && this.#space) {
        const placement = barracksPreviewPlacement(state),
          key = 'dev-barracks-preview';
        this.#canvas.dataset.barracksPreview = placement ? `${placement.cellX},${placement.cellY}` : 'no-free-patch';
        if (placement) {
          retained.add(key);
          const signature = JSON.stringify([state.world.id, placement]);
          let cached = this.#buildingCache.get(key);
          if (cached?.signature !== signature) {
            cached?.mesh.dispose(false, false);
            const mesh = new BabylonMesh('dev-barracks-preview', this.#scene);
            this.#timberThatch ??= new TimberThatch(this.#scene);
            buildCachedProceduralBuildingLod(
              mesh,
              'barracks-finished',
              (root) => buildBarracks(root, this.#timberThatch!),
              this.#timberThatch,
            );
            for (const child of mesh.getChildMeshes()) child.isPickable = false;
            cached = { signature, mesh };
            this.#buildingCache.set(key, cached);
          }
          const centre = this.#space.project({ cellX: placement.cellX + 0.5, cellY: placement.cellY + 2 });
          cached.mesh.position.set(centre.x, placement.base, centre.z);
          this.#villageMeshes.push(cached.mesh);
          freezeStaticHierarchy(cached.mesh);
        }
      }
      for (const [key, cached] of this.#buildingCache)
        if (!retained.has(key)) {
          cached.mesh.dispose(false, false);
          this.#buildingCache.delete(key);
        }
      this.#retintDemolition();
      this.#canvas.dataset.factoryBuildingCount = String(plans.size);
      this.#canvas.dataset.factoryGenerationCount = String(this.#factoryGenerationCount);
      this.#canvas.dataset.buildingGenerationCount = String(this.#buildingGenerationCount);
      if (import.meta.env.MODE === 'e2e')
        this.#canvas.dataset.buildingMeshIds = JSON.stringify(
          Object.fromEntries([...this.#buildingCache].map(([key, value]) => [key, value.mesh.uniqueId])),
        );
      if (import.meta.env.DEV)
        this.#canvas.dataset.factoryBuildMs = String(Math.round(performance.now() - generationStarted));
      this.#applySelection();
    });
  }

  public selectSite(siteId: string, anchor: ScreenAnchor, inspect = false): void {
    if (this.#worldMode === 'exploration' && !this.transport.readOnly) {
      const site = this.#state?.cells.find((c) => c.id === siteId);
      const building =
        site?.building ?? this.#state?.cells.find((c) => c.building?.id === site?.footprint?.buildingId)?.building;
      if (!building || !['town-hall', 'sawmill', 'stonemason', 'university'].includes(building.type)) return;
    }
    if (!this.#selectableMeshes.has(siteId)) return;
    this.#selectedFeatureId = null;
    this.#applyFeatureSelection();
    this.#selectedSiteId = siteId;
    this.#applySelection();
    this.#onSiteSelected(siteId, anchor, inspect);
  }

  #cellAtPointer(event: PointerEvent): Cell | null {
    if (this.#worldMode === 'construction' && this.#state) {
      const bounds = this.#canvas.getBoundingClientRect();
      const occupied = new Map(this.#state.cells.filter((c) => c.building || c.footprint).map((c) => [c.id, c]));
      const pick = this.#scene.pick(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        (mesh) => mesh.isEnabled() && mesh.isVisible && mesh.isPickable && occupied.has(mesh.metadata?.siteId),
      );
      const site = occupied.get(pick.pickedMesh?.metadata?.siteId);
      if (site) return { cellX: site.cellX, cellY: site.cellY };
    }
    const grove = this.#groveCellAtPointer(event);
    if (grove) return grove;
    const point = this.#gridPointAtPointer(event);
    if (!point) return null;
    return {
      cellX: Math.round(point.cellX) % (this.#worldWidthUnits / TILE_SIZE),
      cellY: Math.round(point.cellY) % (this.#worldHeightUnits / TILE_SIZE),
    };
  }

  #gridPointAtPointer(event: PointerEvent): Cell | null {
    const bounds = this.#canvas.getBoundingClientRect();
    const ray = this.#scene.createPickingRay(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      Matrix.Identity(),
      this.#camera,
    );
    if (Math.abs(ray.direction.y) < 0.00001) return null;
    const distance = (0.075 - ray.origin.y) / ray.direction.y;
    if (this.#state?.world.generationVersion === 3) {
      const hit = this.#scene.pickWithRay(ray, (mesh) => mesh.name === 'rc1-ground-unit' && mesh.isEnabled());
      return hit?.pickedPoint ? (this.#space?.inverse(hit.pickedPoint.x, hit.pickedPoint.z) ?? null) : null;
    }
    if (distance < 0) return null;
    return (
      this.#space?.inverse(ray.origin.x + ray.direction.x * distance, ray.origin.z + ray.direction.z * distance) ?? null
    );
  }

  public observationPose(): ObservationPose | null {
    if (!this.#space || !this.#state) return null;
    if (this.#transition.active) return { mode: 'transition' };
    if (this.#inhabitantCamera.mode === 'pov' || this.#inhabitantCamera.mode === 'free') return { mode: 'inhabitant' };
    if (this.#mode === 'world') return this.#torusOverview?.observationPose() ?? null;
    const cell = this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
    return {
      mode: this.#mode,
      ...cell,
      altitude: this.#camera.target.y,
      alpha: (this.#camera.alpha + Math.PI * 2) % (Math.PI * 2),
      beta: this.#camera.beta,
      radius: this.#camera.radius / 2.5,
      fov: this.#camera.fov,
    };
  }
  public applyObservationPose(p: ObservationPose): void {
    if (!this.#space || this.#transition.active) return;
    const current = this.observationPose();
    if (current && this.#state) p = interpolateObservationPose(current, p, this.#state.world, 0.25);
    if (p.mode === 'inhabitant' || p.mode === 'transition') return;
    if (p.mode === 'world') {
      if (this.#mode !== 'world') {
        this.showWorld();
        return;
      }
      this.#torusOverview?.applyObservationPose(p);
      return;
    }
    if (this.#mode !== p.mode) {
      if (p.mode === 'region') this.showRegion();
      else this.showVillage();
      return;
    }
    const pos = this.#space.project(p);
    this.#camera.target.copyFromFloats(pos.x, p.altitude, pos.z);
    this.#camera.alpha = p.alpha;
    this.#camera.beta = p.beta;
    this.#camera.radius = p.radius * 2.5;
    this.#camera.fov = p.fov;
    this.#camera.inertialAlphaOffset =
      this.#camera.inertialBetaOffset =
      this.#camera.inertialRadiusOffset =
      this.#camera.inertialPanningX =
      this.#camera.inertialPanningY =
        0;
  }
  public setWorldMode(mode: 'exploration' | 'exploitation' | 'population' | 'construction' | 'terraform'): void {
    if (this.transport.readOnly && mode !== 'exploration') return;
    if (mode !== 'exploration') this.setVillageSolarPreview(null);
    if (mode === this.#worldMode) return;
    this.#handlePointerCancel();
    if (mode !== 'population') {
      this.#inhabitantCamera.stop();
      this.selectRepresentative(null);
    }
    this.#worldMode = mode;
    this.#selectedSiteId = null;
    this.#selectedFeatureId = null;
    this.#applySelection();
    this.#applyFeatureSelection();
    this.#canvas.dataset.worldMode = mode;
    this.#resourceOverlayAt = 0;
  }

  public featuresAt(cell: Cell) {
    const chunk = this.#store?.chunk(this.#store.key(cell.cellX, cell.cellY));
    return (chunk?.features ?? this.#state?.region.features ?? []).filter((f) => cellKey(f) === cellKey(cell));
  }

  #updateResourceOverlay(now: number): void {
    if (this.#worldMode !== 'exploitation' || this.#mode !== 'village') {
      return;
    }
    if (!this.#space || !this.#store || now < this.#resourceOverlayAt) return;
    this.#resourceOverlayAt = now + 700;
    const store = this.#store;
    const features = store.demand.filter((d) => d.visible).flatMap((d) => store.chunk(d.key)?.features ?? []);
    const { cells, groves } = resourceOverlay({
      gardens: this.#harvestableSites,
      features,
      shown: (c) =>
        Boolean(this.#renderer?.rendered(c.cellX, c.cellY)) && (store.ground(c.cellX, c.cellY)?.code ?? 0) > 0,
      target: this.#space.inverse(this.#camera.target.x, this.#camera.target.z),
      world: store.world,
      // Trees already queued for this mode are not offered again (wood-queue.ts).
      wood: { mode: this.#woodMode, queued: (id, treeIndex) => queuedMode(this.#woodQueue, id, treeIndex) },
    });
    this.#resourceHalos.setAvailable(cells);
    this.#treeHalos.setAvailable(groves);
  }

  /**
   * The grove under the pointer, through its woodland thin instances: a tall
   * tree hides the ground cell behind it, so the ray picks the tree itself.
   * At most one pick per rendered frame; pointer events share its result.
   */
  #grovePick: { frame: number; cell: Cell | null; tree: GestureTree | null } | null = null;
  #groveCellAtPointer(event: PointerEvent): Cell | null {
    return this.#grovePickAt(event).cell;
  }
  #grovePickAt(event: PointerEvent): { cell: Cell | null; tree: GestureTree | null } {
    if (this.#worldMode !== 'exploitation' || this.#mode !== 'village' || !this.#store)
      return { cell: null, tree: null };
    const frame = this.#scene.getFrameId();
    if (this.#grovePick?.frame === frame) return this.#grovePick;
    const bounds = this.#canvas.getBoundingClientRect();
    const ray = this.#scene.createPickingRay(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      Matrix.Identity(),
      this.#camera,
    );
    const pick = this.#scene.pickWithRay(ray, groveRayPredicate(ray));
    const grove = pick ? pickedGrove(pick) : null;
    const rendered = grove ? this.#groves.get(grove.featureId) : undefined;
    const feature =
      rendered?.feature ??
      (grove
        ? this.#store
            .chunk(this.#store.key(grove.hint.cellX, grove.hint.cellY))
            ?.features.find((f) => f.id === grove.featureId)
        : undefined);
    const cell = feature ? { cellX: feature.cellX, cellY: feature.cellY } : null;
    // The instance picked names its tree: a tree, a lying trunk or a stump.
    const tree = grove?.slot !== undefined ? (rendered?.trees[grove.slot] ?? null) : null;
    this.#grovePick = { frame, cell, tree };
    return this.#grovePick;
  }
  /**
   * The tree under the pointer (docs/SPEC-GRAMMAIRE-GESTUELLE.md §3): the
   * woodland instance picked, else, for a low stump or trunk missed by the ray,
   * the rendered tree whose foot is nearest the ground point, within reach.
   */
  #treeAtPointer(event: PointerEvent, point: Cell | null = this.#gridPointAtPointer(event)): GestureTree | null {
    const picked = this.#grovePickAt(event).tree;
    if (picked || !point) return picked;
    const world = { widthCells: this.#worldWidthUnits / TILE_SIZE, heightCells: this.#worldHeightUnits / TILE_SIZE };
    const cell = {
      cellX: normalize(Math.round(point.cellX), world.widthCells),
      cellY: normalize(Math.round(point.cellY), world.heightCells),
    };
    return treesAlongSegment(point, point, this.#treesNear([cell], world), world)[0] ?? null;
  }

  /**
   * The validation halos of pending wood, tree by tree: the trees a gesture
   * designated (a whole case when the server cannot name them), and every tree
   * of a wood cell pending as a whole (the recovery exploitation palette).
   * Other resources keep their cell halo.
   */
  #pendingGroves(cells: Cell[]): { groves: TreeHaloGrove[]; others: Cell[] } {
    const groves: TreeHaloGrove[] = [],
      others: Cell[] = [],
      size = this.#store?.world.chunkSize ?? 32,
      wanted = new Map<string, Set<number> | 'all'>();
    for (const { featureId, treeIndex } of this.#pendingTrees) {
      const trees = wanted.get(featureId);
      if (treeIndex === null) wanted.set(featureId, 'all');
      else if (trees !== 'all') wanted.set(featureId, (trees ?? new Set()).add(treeIndex));
    }
    for (const cell of cells) {
      const wood = this.#gardenStages.has(cellKey(cell))
        ? undefined
        : this.featuresAt(cell).find((f) => f.deposit?.resourceCode === 'wood');
      if (wood) wanted.set(wood.id, 'all');
      else others.push(cell);
    }
    for (const [featureId, trees] of wanted) {
      const grove = this.#groves.get(featureId);
      if (!grove) continue;
      const slots = grove.instances.slots.filter(
        (slot) =>
          slot.state !== 'removed' && (trees === 'all' || (slot.treeIndex !== null && trees.has(slot.treeIndex))),
      );
      groves.push(...treeHalos(grove.feature, slots, size));
    }
    return { groves, others };
  }

  public setPopulationFocus(focus: string | null, filter: string): void {
    this.#populationFocus = focus;
    this.#populationFilter = filter;
  }

  #advanceBuildings() {
    if (document.hidden || this.#mode === 'world') return;
    const until = performance.now() + 8;
    while (this.#buildingJobs.length && performance.now() < until) {
      const job = this.#buildingJobs[0]!;
      if (job.parent.isDisposed()) {
        job.steps.return(job.parent);
        this.#buildingJobs.shift();
        continue;
      }
      const result = job.steps.next();
      for (const mesh of job.parent.getChildMeshes()) {
        mesh.metadata = { ...mesh.metadata, siteId: job.siteId };
        mesh.isPickable = true;
      }
      if (result.done) this.#buildingJobs.shift();
      refreshStaticHierarchy(job.parent);
    }
    if (import.meta.env.DEV) {
      this.#canvas.dataset.pendingBuildingJobs = String(this.#buildingJobs.length);
      this.#canvas.dataset.buildingAssets = JSON.stringify(
        [...this.#buildingCache.values()]
          .filter((c) => c.mesh.metadata?.assetState)
          .map((c) => ({ name: c.mesh.name, state: c.mesh.metadata.assetState })),
      );
    }
  }

  public selectRepresentative(id: string | null) {
    if (id !== this.#selectedRepresentative) this.#inhabitantCamera.stop();
    this.#workers.selectRepresentative(id);
    this.#selectedRepresentative = this.#workers.selectedRepresentative;
  }
  public representativeInfo(id: string) {
    return id === this.#selectedRepresentative ? this.#workers.representativeInfo(id) : null;
  }
  public representativeCamera(mode: 'follow' | 'pov' | 'village') {
    if (mode === 'village') {
      this.#inhabitantCamera.stop();
      return;
    }
    if (this.#worldMode === 'population' && this.#mode === 'village' && this.#selectedRepresentative)
      this.#inhabitantCamera.start(this.#selectedRepresentative, mode);
  }
  public get representativeCameraMode() {
    return this.#inhabitantCamera.mode;
  }
  public setNoclip(enabled: boolean) {
    this.#inhabitantCamera.noclip = devToolsEnabled() && enabled;
  }
  public projectRepresentative(id: string) {
    const pose = this.#workers.representativePose(id);
    return pose ? this.#projectPoint(pose.position.add(new Vector3(0, 0.35, 0))) : null;
  }
  #walkGround(x: number, z: number): number | null {
    if (!this.#space || !this.#store || !this.#renderer) return null;
    const c = this.#space.inverse(x, z),
      cx = ((Math.round(c.cellX) % this.#space.width) + this.#space.width) % this.#space.width,
      cy = ((Math.round(c.cellY) % this.#space.height) + this.#space.height) % this.#space.height;
    return this.#renderer.rendered(cx, cy) ? (this.#store.ground(cx, cy)?.height ?? null) : null;
  }
  #canWalk(x: number, z: number): boolean {
    if (!this.#space || !this.#store || !this.#state) return false;
    for (const [dx, dz] of [
      [0, 0],
      [-0.13, -0.13],
      [0.13, 0.13],
      [-0.13, 0.13],
      [0.13, -0.13],
    ]) {
      const c = this.#space.inverse(x + dx!, z + dz!),
        cx = ((Math.round(c.cellX) % this.#space.width) + this.#space.width) % this.#space.width,
        cy = ((Math.round(c.cellY) % this.#space.height) + this.#space.height) % this.#space.height;
      if (this.#store.ground(cx, cy)?.code !== 1) return false;
      const occupied = this.#state.cells.find(
        (cell) => cell.cellX === cx && cell.cellY === cy && (cell.footprint || cell.building),
      );
      if (occupied) {
        const id = occupied.footprint?.buildingId ?? occupied.building!.id;
        if (
          !buildingAccesses(this.#state, id).some((a) => {
            const xx = delta(c.cellX, a.position.cellX, this.#space!.width),
              yy = delta(c.cellY, a.position.cellY, this.#space!.height);
            return Math.abs(a.normal.x ? yy : xx) < a.width / 2 && xx * a.normal.x + yy * a.normal.y >= -0.125;
          })
        )
          return false;
      }
      if (infrastructureBarrierAt(this.#infrastructureBarriers, c, this.#state.world)) return false;
      const features = this.featuresAt({ cellX: cx, cellY: cy });
      for (const feature of features)
        if (feature.deposit?.cleared !== true && feature.deposit?.blocksCell !== false) {
          const p = this.#space.project(feature);
          if (Math.hypot(x - p.x, z - p.z) < 0.5) return false;
        }
    }
    for (const e of this.#infrastructureEquipment) {
      const p = this.#space.project({ cellX: e.x / 8, cellY: e.y / 8 });
      if (Math.hypot(x - p.x, z - p.z) < 0.3) return false;
    }
    return true;
  }

  public projectCell(cell: Cell): ScreenAnchor | null {
    if (!this.#space || this.#mode !== 'village') return null;
    const p = this.#space.project(cell),
      ground = this.#store?.ground(cell.cellX, cell.cellY);
    return this.#projectPoint(new Vector3(p.x, (ground?.height ?? 0) + 0.5, p.z));
  }

  /** Above one rendered tree's foot (a harvest feedback per tree): an index lookup. */
  public projectTree(featureId: string, treeIndex: number): ScreenAnchor | null {
    if (!this.#space || this.#mode !== 'village') return null;
    const tree = this.#groves.get(featureId)?.trees.find((t) => t.treeIndex === treeIndex);
    if (!tree) return null;
    const p = this.#space.project({ cellX: tree.x, cellY: tree.y }),
      ground = this.#store?.ground(Math.round(tree.x), Math.round(tree.y));
    return this.#projectPoint(new Vector3(p.x, (ground?.height ?? 0) + 0.5, p.z));
  }

  public projectPopulation(id: string): ScreenAnchor | null {
    const position = this.#workers.populationPosition(id);
    return position && this.#mode === 'village' ? this.#projectPoint(position) : null;
  }

  #projectPoint(position: Vector3): ScreenAnchor | null {
    const point = Vector3.Project(
      position,
      Matrix.Identity(),
      this.#scene.getTransformMatrix(),
      this.#camera.viewport.toGlobal(this.#engine.getRenderWidth(), this.#engine.getRenderHeight()),
    );
    if (point.z < 0 || point.z > 1) return null;
    const bounds = this.#canvas.getBoundingClientRect();
    const x = bounds.left + (point.x * bounds.width) / this.#engine.getRenderWidth(),
      y = bounds.top + (point.y * bounds.height) / this.#engine.getRenderHeight();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom ? null : { x, y };
  }

  public updateAreaSelection(enabled: boolean, preview: AreaPreview | null, invalid: boolean): void {
    this.#areaRequest = [enabled, preview, invalid];
    this.#selectingArea = enabled;
    if (!this.#space) return;
    const signature = JSON.stringify([preview, invalid]);
    if (signature === this.#lastPreviewSignature) return;
    this.#lastPreviewSignature = signature;
    for (const mesh of this.#previewMeshes.splice(0)) mesh.dispose(false, false);
    const obstacles = new Set((preview?.obstacleCells ?? []).map(cellKey));
    for (const cell of preview?.cells ?? []) {
      const mesh = this.#createConstructionBorder(`area-preview-${cellKey(cell)}`, TILE_SIZE - 0.06);
      const p = this.#space!.projectFrom(cell, this.#villageAnchor);
      mesh.position.set(p.x, (this.#store?.ground(cell.cellX, cell.cellY)?.height ?? 0) + 0.15, p.z);
      if (this.#state?.region.vertexHeights) {
        const data = mesh.getVerticesData('position');
        if (data) {
          for (let i = 0; i < data.length; i += 3) {
            const ground = this.#store?.ground(
              cell.cellX + data[i]! / TILE_SIZE,
              cell.cellY + data[i + 2]! / TILE_SIZE,
            );
            if (ground) data[i + 1] = data[i + 1]! + ground.height + 0.15 - mesh.position.y;
          }
          mesh.setVerticesData('position', data);
        }
      }
      mesh.material = obstacles.has(cellKey(cell))
        ? this.#invalidAreaMaterial
        : preview?.needsLeveling
          ? this.#levelingAreaMaterial
          : invalid && !preview?.newCells
            ? this.#invalidAreaMaterial
            : this.#candidateMaterial;
      mesh.isPickable = false;
      this.#previewMeshes.push(mesh);
    }
  }

  public setPreparation(value: boolean) {
    this.#preparing = value;
  }
  public setStarterGhost(value: StarterGhost | null, onManual: (() => void) | null) {
    this.#starterGhost = value;
    this.#starterManual = onManual;
  }
  public updateConstructionGhost(
    code: string | null,
    preview: AreaPreview | null,
    _invalid: boolean,
    quarterTurns = 0,
    houseVariant: 'stone' | 'logs' | 'beams' = 'stone',
  ): void {
    this.#ghostRequest = [code, preview, _invalid, quarterTurns, houseVariant];
    if (!code || !preview?.cells.length || !this.#space || this.#mode !== 'village') {
      this.#constructionGhost?.setEnabled(false);
      return;
    }
    const starter = this.#starterGhost;
    if (starter) code = 'starter:' + JSON.stringify([starter.elements, starter.relativeToHall]);
    // Gardens are already a crop-surface footprint, including arbitrary spatial extensions.
    if (code === 'garden') {
      this.#constructionGhost?.setEnabled(false);
      return;
    }
    if (code === 'dwelling' && houseVariant !== 'stone') code = `dwelling-${houseVariant}`;
    if (code !== this.#constructionGhostCode) {
      this.#constructionGhost?.dispose(false, false);
      for (const m of this.#ghostMaterials) m.dispose(false, false);
      for (const m of this.#ghostOwnMaterials) m.dispose(false, true);
      this.#ghostMaterials = [];
      this.#ghostOwnMaterials.clear();
      const assetKey = `${code}-1-finished`;
      const baked = Boolean(starter || buildingAssets[assetKey]);
      const previous = new Set(this.#scene.materials);
      if (baked) this.#constructionGhost = new BabylonMesh(`ghost-${code}`, this.#scene);
      else {
        this.#timberThatch ??= new TimberThatch(this.#scene);
        this.#constructionGhost = buildPresentation(this.#timberThatch, code);
      }
      this.#constructionGhostCode = code;
      if (!baked) this.#ghostOwnMaterials = new Set(this.#scene.materials.filter((m) => !previous.has(m)));
      const root = this.#constructionGhost;
      const style = () => {
        if (root.isDisposed() || this.#constructionGhost !== root) return;
        const clones = new Map<StandardMaterial, StandardMaterial>();
        for (const mesh of root.getChildMeshes()) {
          mesh.isPickable = false;
          if (!(mesh.material instanceof StandardMaterial)) continue;
          const source = mesh.material;
          let material = clones.get(source);
          if (!material) {
            material = clonePreviewMaterial(source);
            clones.set(source, material);
          }
          mesh.material = material;
        }
        this.#ghostMaterials = [...clones.values()];
      };
      if (starter) {
        const loads = starter.elements.map((element) => {
          const posed = poseStarterElement(element, { x: 256, y: 128 }, 0, starter.relativeToHall);
          const xs = posed.cells.map((c) => spawnDelta(c.cellX, 256, 512)),
            ys = posed.cells.map((c) => spawnDelta(c.cellY, 128, 256));
          const child = new BabylonMesh('starter-' + element.key, this.#scene);
          child.parent = root;
          child.position.set(
            ((Math.min(...xs) + Math.max(...xs)) / 2) * TILE_SIZE,
            0,
            ((Math.min(...ys) + Math.max(...ys)) / 2) * TILE_SIZE,
          );
          child.rotation.y = (posed.quarterTurns * Math.PI) / 2;
          child.metadata = { starterBaseTurns: posed.quarterTurns };
          if (element.type === 'garden') {
            const patch = MeshBuilder.CreateGround(
              'starter-garden',
              { width: TILE_SIZE * 0.92, height: TILE_SIZE * 0.92 },
              this.#scene,
            );
            patch.parent = child;
            patch.position.y = 0.04;
            patch.material = this.#material('starter-garden-soil', '#776343');
            this.#ghostOwnMaterials.add(patch.material);
            return Promise.resolve();
          }
          const resolved = recipeFor({ ...posed, status: 'completed', targetLevel: null });
          if (!resolved) return Promise.resolve();
          const plan = buildingPlan({
            id: element.key,
            anchor: posed.cells.find((c) => c.role === 'anchor')!,
            cells: posed.cells,
            world: this.#state!.world,
            ...resolved,
            quarterTurns: posed.quarterTurns,
            offset: posed.visualLayout?.offset ?? [0, 0],
          });
          const key = bakedPlanKey(plan);
          if (key) return loadBakedBuilding(child, key, false, true);
          this.#timberThatch ??= new TimberThatch(this.#scene);
          this.#timberThatch.build(child, plan);
          return Promise.resolve();
        });
        void Promise.all(loads)
          .then(style)
          .catch((error) => console.error('Starter preview failed', error));
      } else if (baked)
        void loadBakedBuilding(root, assetKey, false, true)
          .then(style)
          .catch((error) => console.error('Building preview failed', error));
      else style();
    }
    const positions = preview.cells.map((cell) => this.#space!.projectFrom(cell, this.#villageAnchor));
    const x = (Math.min(...positions.map((p) => p.x)) + Math.max(...positions.map((p) => p.x))) / 2;
    const z = (Math.min(...positions.map((p) => p.z)) + Math.max(...positions.map((p) => p.z))) / 2;
    const ground = Math.max(...preview.cells.map((cell) => this.#store?.ground(cell.cellX, cell.cellY)?.height ?? 0));
    const anchor = starter
      ? this.#space.projectFrom({ cellX: starter.point.x, cellY: starter.point.y }, this.#villageAnchor)
      : null;
    const starterHeight =
      starter?.referenceHeight === undefined
        ? this.#store?.ground(starter?.point.x ?? 0, starter?.point.y ?? 0)?.height
        : starter.referenceHeight * TILE_SIZE;
    this.#constructionGhost!.position.set(
      anchor?.x ?? x,
      (starter ? (starterHeight ?? ground) : ground) + 0.03,
      anchor?.z ?? z,
    );
    this.#constructionGhost!.rotation.y = ((starter ? starter.quarterTurns : quarterTurns) * Math.PI) / 2;
    if (starter)
      for (const child of this.#constructionGhost!.getChildren())
        if (child instanceof BabylonMesh && typeof child.metadata?.starterBaseTurns === 'number')
          child.rotation.y = (child.metadata.starterBaseTurns * Math.PI) / 2;
    this.#constructionGhost!.setEnabled(true);
    if (import.meta.env.MODE === 'e2e')
      this.#canvas.dataset.constructionGhost = JSON.stringify({
        point: starter?.point,
        turns: starter?.quarterTurns,
        position: this.#constructionGhost!.position.asArray(),
        models: this.#constructionGhost!.getChildMeshes().filter((m) => m.getTotalVertices() > 4).length,
      });
  }

  /** Wood tool mode: halos read « Onde » to cut and « Satellites » to clear; clearing also offers stumps. */
  public setHarvestWoodMode(mode: HarvestMode): void {
    if (mode !== this.#woodMode) this.#resourceOverlayAt = 0;
    this.#woodMode = mode;
    this.#treeHalos.setMode(mode);
    this.#resourceHalos.setMode(mode);
  }
  /** Who switches cutting and clearing on a long press; false when it does not apply (no wood tool). */
  public setWoodModeToggle(handler: ((point: { x: number; y: number }) => boolean) | null): void {
    this.#onWoodModeToggle = handler;
  }
  #switchWoodMode(): void {
    const gesture = this.#pointerDown;
    if (!gesture) return;
    if (!this.#onWoodModeToggle?.({ x: gesture.x, y: gesture.y })) this.#longPress.disarm();
  }

  public updateHarvestPending(
    cells: Cell[],
    trees: ReadonlyArray<{ featureId: string; treeIndex: number | null }> = [],
  ): void {
    this.#pendingTrees = [...trees];
    const { groves, others } = this.#pendingGroves(cells);
    this.#treeHalos.setPending(groves);
    this.#resourceHalos.setPending(
      others.map(
        (cell): ResourceHaloCell => ({
          ...cell,
          garden: this.#gardenStages.has(cellKey(cell)),
          resource: this.#gardenStages.has(cellKey(cell))
            ? 'carrot'
            : this.featuresAt(cell).find((f) => f.deposit)?.deposit?.resourceCode,
        }),
      ),
    );
  }

  #clearSelection(): void {
    this.#selectedFeatureId = null;
    this.#applyFeatureSelection();
    this.#selectedSiteId = null;
    this.#applySelection();
    this.#onCameraMoved();
  }

  #material(name: string, color: string, alpha = 1, emissive?: string): StandardMaterial {
    const material = new StandardMaterial(name, this.#scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor = new Color3(0.025, 0.025, 0.025);
    material.alpha = alpha;
    if (emissive) material.emissiveColor = Color3.FromHexString(emissive);
    return material;
  }

  #createWaterRippleTexture(): DynamicTexture {
    const texture = new DynamicTexture('water-ripple-pattern', { width: 128, height: 128 }, this.#scene, true);
    texture.hasAlpha = true;
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    const context = texture.getContext();
    context.clearRect(0, 0, 128, 128);
    // A light blue veil under the ripples marks the water from the very bank,
    // before the bed darkens with depth (Tristan, 29 October).
    context.fillStyle = WATER_SURFACE_VEIL;
    context.fillRect(0, 0, 128, 128);
    context.lineWidth = 2.5;
    context.strokeStyle = 'rgba(211, 239, 235, 0.55)';
    for (const [index, y] of [16, 48, 80, 112].entries()) {
      const shift = index % 2 === 0 ? 0 : 18;
      context.beginPath();
      context.moveTo(5 + shift, y);
      context.quadraticCurveTo(24 + shift, y - 6, 43 + shift, y);
      context.stroke();
      context.beginPath();
      context.moveTo(72 - shift, y + 3);
      context.quadraticCurveTo(91 - shift, y + 9, 110 - shift, y + 3);
      context.stroke();
    }
    texture.update();
    return texture;
  }

  #animateWater(now: number): void {
    this.#waterRippleTexture.uOffset = now * 0.000006;
    this.#waterRippleMaterial.alpha = 0.32 + this.#rainIntensity * 0.12;
    this.#waterRippleTexture.vOffset = now * 0.000003;
  }

  #tileMaterial(category: 'garden', index: number): StandardMaterial {
    const material = this.#material(`${category}-tile-${index}`, '#ffffff');
    const texture = new Texture(
      `/tiles/${category}-${index}.png`,
      this.#scene,
      false,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    material.diffuseTexture = texture;
    material.specularColor.set(0, 0, 0);
    return material;
  }

  #createTerrain(): Mesh {
    const earth = MeshBuilder.CreateBox(
      'deep-ground',
      {
        width: this.#worldWidthUnits * 3,
        depth: this.#worldHeightUnits * 3,
        height: 0.8,
      },
      this.#scene,
    );
    // A backdrop for unstreamed terrain, far under any river bed: at -1.55 it
    // hid deep RC1 beds and showed pale through the water (Tristan, 29 October).
    earth.position.y = -30;
    const background = new StandardMaterial('loading-backdrop', this.#scene);
    background.diffuseColor = Color3.FromHexString('#8ea0a0');
    background.disableLighting = true;
    background.emissiveColor = background.diffuseColor.clone();
    earth.material = background;
    earth.receiveShadows = true;
    earth.isPickable = false;
    return earth;
  }

  #shapeData(key: string, create: () => Mesh): VertexData {
    let data = this.#sceneryData.get(key);
    if (data) return data;
    let mesh = this.#sceneryGeometry.get(key);
    if (!mesh) {
      mesh = create();
      mesh.setEnabled(false);
      mesh.isPickable = false;
      this.#sceneryGeometry.set(key, mesh);
    }
    data = VertexData.ExtractFromMesh(mesh, true, true);
    this.#sceneryData.set(key, data);
    return data;
  }

  /**
   * Groves from the tree kit (blender-elements/arbres), tree by tree from the
   * server (grove-trees.ts): a standing tree; a felled one, its trunk on the
   * ground as long as its wood, beside its stump; a stump; nothing once the
   * stump is removed. One thin-instanced mesh per kit piece and grove, three
   * instances per tree: a tree that changes later rewrites its own instances
   * (#refreshGrove), the grove is not rebuilt.
   */
  #buildWoodland(features: NaturalFeature[]): Mesh[] {
    return features.flatMap((feature) => this.#buildGrove(feature));
  }
  #buildGrove(feature: NaturalFeature): Mesh[] {
    if (feature.deposit?.cleared) return [];
    const ground = this.#store!.ground(feature.cellX, feature.cellY);
    if (!ground) return [];
    const slots = groveSlots(feature);
    if (!slots.length) return [];
    const size = this.#store!.world.chunkSize,
      anchor = { cellX: Math.floor(feature.cellX / size) * size, cellY: Math.floor(feature.cellY / size) * size };
    const instances = new GroveInstances(slots, (slot) => this.#slotPlacement(feature, slot, anchor, ground.height));
    instances.apply((slot) => this.#treeLook(feature.id, slot));
    const meshes = new Map<TreePiece, Mesh>(),
      stumps = groveHasStumps(feature);
    for (const [piece, data] of instances.pieces) {
      // No stump mesh before the grove's first felled tree (its signature then rebuilds it).
      if (!stumps && isStumpPiece(piece)) continue;
      const mesh = cloneWoodland(this.#treeKitSource(piece), `woodland-${feature.id}-${piece}`, data.matrices, false);
      // The clearing tint, per tree, multiplies the kit's vertex colours.
      mesh.thinInstanceSetBuffer('color', data.colours, 4, false);
      mesh.metadata = {
        woodlandId: feature.id,
        featureId: feature.id,
        instanceFeatureIds: data.slots.map(() => feature.id),
        instanceSlots: data.slots,
        instanceTrees: data.trees,
        cellX: feature.cellX,
        cellY: feature.cellY,
      };
      mesh.isPickable = true;
      mesh.thinInstanceEnablePicking = true;
      mesh.addLODLevel(250, null);
      // A piece no tree shows yet costs no draw call.
      mesh.isVisible = data.shown > 0;
      meshes.set(piece, mesh);
    }
    const grove = { feature, instances, meshes, trees: slots.map((slot) => gestureTree(feature.id, slot)) };
    this.#groves.set(feature.id, grove);
    const key = cellKey(feature);
    this.#groveCells.set(key, (this.#groveCells.get(key) ?? new Set()).add(feature.id));
    // The renderer disposes a grove's meshes when it rebuilds or evicts it.
    meshes
      .values()
      .next()
      .value?.onDisposeObservable.addOnce(() => {
        if (this.#groves.get(feature.id) !== grove) return;
        this.#groves.delete(feature.id);
        const ids = this.#groveCells.get(key);
        ids?.delete(feature.id);
        if (!ids?.size) this.#groveCells.delete(key);
      });
    return [...meshes.values()];
  }
  #treeKitSource(piece: TreePiece): Mesh {
    const key = `tree-kit-${piece}`;
    let source = this.#sceneryGeometry.get(key);
    if (!source) {
      source = new BabylonMesh(key, this.#scene);
      treePieceData(piece).applyToMesh(source);
      this.#treeKitMaterial ??= (() => {
        const material = new StandardMaterial('tree-kit', this.#scene);
        material.diffuseColor = Color3.White();
        material.specularColor = new Color3(0.03, 0.03, 0.03);
        return material;
      })();
      source.material = this.#treeKitMaterial;
      source.setEnabled(false);
      this.#sceneryGeometry.set(key, source);
    }
    return source;
  }
  /** What a tree shows beyond its server state: hidden while a worksite fells it, red while queued for clearing. */
  #treeLook(featureId: string, slot: GroveSlot): TreeLook {
    return {
      masked: this.#treeFelled(featureId, slot.index),
      tint: slot.state !== 'removed' && queuedMode(this.#woodQueue, featureId, slot.treeIndex) === 'clear',
    };
  }
  /**
   * Draws the trees of a grove whose look changed (a new server state, the
   * queue, a worksite felling one): O(changed trees) instance writes and
   * partial uploads, never a rebuild of the grove or of its chunk.
   */
  #refreshGrove(
    grove: { feature: NaturalFeature; instances: GroveInstances; meshes: Map<TreePiece, Mesh> },
    slots: readonly GroveSlot[] = grove.instances.slots,
  ): void {
    const touched = grove.instances.apply((slot) => this.#treeLook(grove.feature.id, slot), slots);
    if (!touched.length) return;
    const byPiece = new Map<TreePiece, number[]>();
    for (const { piece, i } of touched) {
      const list = byPiece.get(piece);
      if (list) list.push(i);
      else byPiece.set(piece, [i]);
    }
    for (const [piece, indices] of byPiece) {
      const mesh = grove.meshes.get(piece);
      if (!mesh || mesh.isDisposed()) continue;
      if (indices.length > 4) {
        mesh.thinInstanceBufferUpdated('matrix');
        mesh.thinInstanceBufferUpdated('color');
      } else
        for (const i of indices) {
          mesh.thinInstancePartialBufferUpdate('matrix', 1, i);
          mesh.thinInstancePartialBufferUpdate('color', 1, i);
        }
      // A trunk laid down reaches beyond the standing tree's bounds.
      mesh.thinInstanceRefreshBoundingInfo();
      mesh.isVisible = grove.instances.pieces.get(piece)!.shown > 0;
    }
    this.#groveWrites += touched.length / 3;
  }
  /** Tree looks rewritten in rendered groves, for diagnostics and the browser checks. */
  #groveWrites = 0;
  /** A woodland unit whose geometry is unchanged: only its trees' state may have changed. */
  #updateGroveTrees(feature: NaturalFeature): void {
    const grove = this.#groves.get(feature.id);
    if (!grove) return;
    grove.feature = feature;
    this.#refreshGrove(grove, groveSlots(feature));
  }
  /** The village's queue changed: only the groves of the cases whose queue changed are redrawn. */
  #observeWoodQueue(worksites: VillageState['village']['worksites']): void {
    if (worksites === this.#woodQueueSource) return;
    this.#woodQueueSource = worksites;
    const next = woodQueue(worksites),
      changed = changedCases(this.#woodQueue, next);
    this.#woodQueue = next;
    if (!changed.length) return;
    for (const id of changed) {
      const grove = this.#groves.get(id);
      if (grove) this.#refreshGrove(grove);
    }
    // The offer leaves out what is queued: refresh it now.
    this.#resourceOverlayAt = 0;
  }
  /** Rendered trees near the view (screen fractions), their state and clearing tint: diagnostics only. */
  #treeScreens(): Array<Record<string, unknown>> {
    if (!this.#space) return [];
    const viewport = this.#camera.viewport.toGlobal(this.#engine.getRenderWidth(), this.#engine.getRenderHeight()),
      trees: Array<Record<string, unknown>> = [];
    for (const grove of this.#groves.values()) {
      if (![...grove.meshes.values()].some((mesh) => mesh.isEnabled())) continue;
      for (const slot of grove.instances.slots) {
        if (slot.state === 'removed' || trees.length >= 400) continue;
        const at = this.#space.project({ cellX: slot.tree.x, cellY: slot.tree.y }),
          foot =
            slot.tree.elevation === undefined
              ? (this.#store?.ground(slot.tree.x, slot.tree.y)?.height ?? 0)
              : slot.tree.elevation * TILE_SIZE;
        const point = Vector3.Project(
          new Vector3(at.x, foot + 0.15, at.z),
          Matrix.Identity(),
          this.#scene.getTransformMatrix(),
          viewport,
        );
        trees.push({
          featureId: grove.feature.id,
          cellX: grove.feature.cellX,
          cellY: grove.feature.cellY,
          treeIndex: slot.treeIndex,
          slot: slot.index,
          state: slot.state,
          tint: this.#treeLook(grove.feature.id, slot).tint,
          x: point.x / this.#engine.getRenderWidth(),
          y: point.y / this.#engine.getRenderHeight(),
        });
      }
    }
    return trees;
  }
  /** Trees of a grove for its sheet: their state and what the queue does with them. */
  public groveTrees(featureId: string): GroveTreeRow[] | null {
    const grove = this.#groves.get(featureId);
    const feature = grove?.feature ?? this.#store?.naturalFeatures().find((f) => f.id === featureId);
    if (!feature) return null;
    return (grove?.instances.slots ?? groveSlots(feature)).map((slot) => ({
      slot: slot.index,
      treeIndex: slot.treeIndex,
      state: slot.state,
      remaining: slot.remaining,
      queued: slot.state === 'removed' ? null : queuedMode(this.#woodQueue, featureId, slot.treeIndex),
    }));
  }

  /** Where and how a grove slot is drawn: shared by the grove and the tree a worksite fells. */
  #slotPlacement(
    feature: NaturalFeature,
    slot: GroveSlot,
    anchor: { cellX: number; cellY: number },
    groundHeight: number,
  ) {
    const { tree } = slot,
      at = this.#space!.projectFrom({ cellX: tree.x, cellY: tree.y }, anchor);
    return {
      x: at.x,
      z: at.z,
      y: tree.elevation === undefined ? groundHeight : tree.elevation * TILE_SIZE,
      // RC1 trees carry no rotation: turn each one from its slot.
      yaw: tree.rotation || ((feature.variantSeed * 31 + slot.index * 97) % 360) * (Math.PI / 180),
    };
  }
  #treeFelled(featureId: string, index: number) {
    for (const f of this.#felledTrees.values()) if (f.featureId === featureId && f.index === index) return true;
    return false;
  }
  /** Draw or mask the trees of a grove a worksite fells, after a lot starts or ends. */
  #applyFelledTrees(featureId: string) {
    const grove = this.#groves.get(featureId);
    if (grove) this.#refreshGrove(grove);
  }
  /**
   * The tree a wood lot fells: the one the lot names (`extractions[].treeIndex`,
   * slice 2d), else the trunk already lying, else the next tree standing. Masked
   * in the grove until a minute after the lot, when the server's state has
   * redrawn it. A stump removal fells nothing.
   */
  #fellTree(featureId: string, lotId: string): FelledTree | null {
    if (!this.#space || !this.#store) return null;
    const grove = this.#groves.get(featureId);
    const feature = grove?.feature ?? this.#store.naturalFeatures().find((f) => f.id === featureId);
    if (!feature) return null;
    const ground = this.#store.ground(feature.cellX, feature.cellY);
    if (!ground) return null;
    const slots = grove?.instances.slots ?? groveSlots(feature),
      named = this.#state?.village.extractions.find((e) => e.id === lotId)?.treeIndex ?? null;
    const slot =
      (named !== null ? slots.find((s) => s.treeIndex === named) : undefined) ??
      slots.find((s) => s.state === 'felled') ??
      slots.find((s) => s.state === 'standing');
    if (!slot || (slot.state !== 'standing' && slot.state !== 'felled')) return null;
    const size = this.#store.world.chunkSize,
      anchor = { cellX: Math.floor(feature.cellX / size) * size, cellY: Math.floor(feature.cellY / size) * size },
      place = this.#slotPlacement(feature, slot, anchor, ground.height);
    this.#felledTrees.set(lotId, { featureId, index: slot.index, timer: 0 });
    this.#applyFelledTrees(featureId);
    return {
      x: place.x,
      z: place.z,
      variant: slot.variant,
      scale: slot.tree.scale,
      heightScale: slot.tree.heightScale,
      yaw: place.yaw,
      lying: slot.state === 'felled' ? slot.lying : 0,
      // A lot takes reserved / 500 of a tree.
      share: WOOD_PER_TREE,
    };
  }
  /** Grove trunks of the villagers' local way, by cell (grove-trunks.ts): a removed stump leaves it. */
  get #trunks(): GroveTrunkIndex {
    const store = this.#store!;
    if (this.#trunkIndex?.source !== store)
      this.#trunkIndex = new GroveTrunkIndex(store, (feature, slot, anchor, height) =>
        this.#slotPlacement(feature, slot, anchor, height),
      );
    return this.#trunkIndex;
  }
  /**
   * Room for the felling layout (docs/SPEC-BOSQUETS-SOUCHES-REPOUSSE.md §3):
   * the real trunks of nearby groves, felled trees excepted, buildings, water,
   * barriers and equipment. Paths are allowed and the worked grove has no
   * exclusion around its centre: standing among its trees is the point.
   */
  #stageFree(point: { x: number; z: number }, radius: number, spatial: WorkerObstacles): boolean {
    if (!this.#space || !this.#store || !this.#state) return false;
    spatial.update(this.#state);
    const centre = this.#space.inverse(point.x, point.z);
    for (const [dx, dz] of [
      [0, 0],
      [-radius, -radius],
      [radius, radius],
      [-radius, radius],
      [radius, -radius],
    ]) {
      const cell = this.#space.inverse(point.x + dx!, point.z + dz!),
        x = Math.round(cell.cellX) % this.#space.width,
        y = Math.round(cell.cellY) % this.#space.height;
      const ground = this.#store.ground(x, y);
      if (!ground || ground.code !== 1) return false;
      if (infrastructureBarrierAt(this.#infrastructureBarriers, cell, this.#state.world)) return false;
      if (spatial.occupied(x, y)) return false;
    }
    spatial.updateEquipment(this.#infrastructureEquipment, this.#space);
    if (spatial.equipmentBlocked(point, radius)) return false;
    const cx = Math.round(centre.cellX),
      cy = Math.round(centre.cellY);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cell = {
          cellX: (cx + dx + this.#space.width) % this.#space.width,
          cellY: (cy + dy + this.#space.height) % this.#space.height,
        };
        for (const trunk of this.#trunks.trunksAt(cell, this.#space.version))
          if (
            Math.hypot(point.x - trunk.x, point.z - trunk.z) < trunk.radius + radius &&
            !this.#treeFelled(trunk.featureId, trunk.index)
          )
            return false;
      }
    return true;
  }
  #releaseTree(lotId: string) {
    const felled = this.#felledTrees.get(lotId);
    if (!felled || felled.timer) return;
    felled.timer = window.setTimeout(() => {
      this.#felledTrees.delete(lotId);
      this.#applyFelledTrees(felled.featureId);
    }, 60_000);
  }

  #buildFeature(feature: NaturalFeature): Mesh[] {
    const ground = this.#store!.ground(feature.cellX, feature.cellY);
    if (!ground) return [];
    const { x, z } = this.#space!.project(feature);
    if (feature.type === 'leveling-site') {
      const border = this.#createConstructionBorder(
        `leveling-site-${feature.id}-${cellKey(feature)}`,
        TILE_SIZE - 0.08,
      );
      border.position.set(x, ground.height + 0.08, z);
      border.material = this.#levelingAreaMaterial;
      border.isPickable = false;
      const stake = MeshBuilder.CreateBox(
        `leveling-stake-${feature.id}-${cellKey(feature)}`,
        { width: 0.07, depth: 0.07, height: 0.45 },
        this.#scene,
      );
      stake.position.set(x - TILE_SIZE * 0.4, ground.height + 0.225, z - TILE_SIZE * 0.4);
      stake.material = this.#trunkMaterial;
      stake.isPickable = false;
      return [border, stake];
    }
    const seed = Math.abs(feature.variantSeed),
      scenery: Mesh[] = [];
    if (feature.rc1?.rocks.length) {
      if (feature.deposit?.state === 'depleted') return [];
      for (const rock of feature.rc1.rocks) {
        const p = this.#space!.project({ cellX: rock.x, cellY: rock.y }),
          mesh = MeshBuilder.CreateBox(
            'rc1-rock',
            { width: rock.width * 2.5, depth: rock.depth * 2.5, height: rock.height * 2.5 },
            this.#scene,
          );
        mesh.position.set(p.x, (rock.elevation + rock.height * 0.5) * 2.5, p.z);
        mesh.rotation.y = rock.rotation;
        mesh.material = this.#pebbleMaterial;
        mesh.metadata = { featureId: feature.id, cellX: feature.cellX, cellY: feature.cellY };
        mesh.isPickable = true;
        scenery.push(mesh);
      }
      return scenery;
    }
    if (feature.deposit && feature.deposit.state !== 'depleted') {
      const scale =
        (0.95 + this.#hash(seed, 443) * 0.38) *
        (0.55 + (0.45 * feature.deposit.remainingAmount) / feature.deposit.initialAmount);
      this.#createRockCluster(x, z, scale, seed, scenery, ground.height);
      for (const m of scenery) {
        m.metadata = { featureId: feature.id, cellX: feature.cellX, cellY: feature.cellY };
        m.isPickable = true;
        if (feature.id === this.#selectedFeatureId) {
          m.enableEdgesRendering();
          m.edgesColor.set(0.95, 0.85, 0.3, 1);
          m.edgesWidth = 3;
        }
      }
    }
    return scenery;
  }

  #buildDecor(chunk: TerrainChunk, offsetX: number, offsetY: number): Mesh[] {
    if (chunk.rc1) return [];
    const size = this.#store!.world.chunkSize,
      stride = size + 2;
    const origin = this.#space!.project({ cellX: chunk.originCellX, cellY: chunk.originCellY });
    const parts: SceneryPart[] = [];
    const featureCells = new Set(chunk.features.filter((f) => f.deposit?.state !== 'depleted').map(cellKey));
    const occupiedCells = new Set(chunk.occupiedCells.map(cellKey));
    for (let localY = offsetY; localY < Math.min(offsetY + RENDER_UNIT_CELLS, size); localY += 1) {
      for (let localX = offsetX; localX < Math.min(offsetX + RENDER_UNIT_CELLS, size); localX += 1) {
        const index = (localY + 1) * stride + localX + 1;
        if (chunk.terrainCodes[index] !== 1) continue;
        const cellX = (chunk.originCellX + localX) % this.#space!.width;
        const cellY = (chunk.originCellY + localY) % this.#space!.height;
        const key = cellKey({ cellX, cellY });
        if (featureCells.has(key) || occupiedCells.has(key)) continue;
        const shore =
          chunk.terrainCodes[index - 1] === 2 ||
          chunk.terrainCodes[index + 1] === 2 ||
          chunk.terrainCodes[index - stride] === 2 ||
          chunk.terrainCodes[index + stride] === 2;
        if (this.#hash(cellX + 709, cellY + 541) > (shore ? 0.24 : 0.045)) continue;
        const x = origin.x + localX * TILE_SIZE;
        const z = origin.z + localY * TILE_SIZE;
        const elevation = (chunk.elevations[index] ?? 0) * 0.025;
        const pebbleCount = shore || this.#hash(cellX + 113, cellY + 281) > 0.55 ? 2 : 1;
        for (let part = 0; part < pebbleCount; part += 1) {
          const angle = this.#hash(cellX + part * 31, cellY + part * 47) * Math.PI * 2;
          const radius = 0.22 + this.#hash(cellX + part * 59, cellY + part * 71) * 0.35;
          const pebbleRadius = 0.17 + this.#hash(cellX + part * 97, cellY + part * 83) * 0.08;
          parts.push({
            geometry: this.#shapeData('ico', () =>
              MeshBuilder.CreateIcoSphere('scenery-ico', { radius: 1, subdivisions: 1 }, this.#scene),
            ),
            material: this.#pebbleMaterial,
            position: new Vector3(x + Math.cos(angle) * radius, elevation + 0.09, z + Math.sin(angle) * radius),
            scaling: new Vector3(pebbleRadius * 1.1, pebbleRadius * 0.48, pebbleRadius * 0.8),
            rotation: new Vector3(0, angle, 0),
          });
        }
      }
    }
    return bakeScenery(this.#scene, parts);
  }

  #applyFeatureSelection(): void {
    for (const mesh of this.#renderer?.meshes() ?? []) {
      const id = (mesh.metadata as { featureId?: string } | null)?.featureId;
      if (!id) continue;
      if (id === this.#selectedFeatureId) {
        mesh.enableEdgesRendering();
        mesh.edgesColor.set(0.95, 0.85, 0.3, 1);
        mesh.edgesWidth = 3;
      } else mesh.disableEdgesRendering();
    }
  }

  #pathPoints(path: TravelCell[]): Vector3[] {
    const points = this.#space!.path(path);
    return path.map((cell, index) => {
      const x = wrapCoordinate(Math.floor(cell.cellX + 0.5), this.#space!.width),
        y = wrapCoordinate(Math.floor(cell.cellY + 0.5), this.#space!.height);
      const ground = this.#store!.ground(cell.cellX, cell.cellY);
      const shown = this.#renderer!.rendered(x, y);
      return new Vector3(points[index]!.x, ground && shown ? ground.height + 0.33 : NaN, points[index]!.z);
    });
  }

  /**
   * Doorstep presentation connector; server journey and work deadlines stay
   * unchanged. The hall's double door gives each direction its own lane.
   */
  #workerPath(path: TravelCell[], lane?: DoorLane): Array<Vector3 & { lane?: DoorLane; width?: number }> {
    const points = this.#pathPoints(path);
    if (path.some((p) => !Number.isInteger(p.cellX) || !Number.isInteger(p.cellY))) return points;
    const hall = this.#state?.cells.find((cell) => cell.building?.type === 'town-hall');
    if (!hall || points.length < 2) return points;
    const factoryPlan = planForSite(this.#state!, hall, (x, y) => this.#store?.ground(x, y)?.height ?? null);
    if (factoryPlan) return this.#factoryDeparture(hall, factoryPlan, points, lane);
    const centre = this.#space!.project(hall);
    centre.x = points[0]!.x + delta(centre.x, points[0]!.x, this.#worldWidthUnits);
    centre.z = points[0]!.z + delta(centre.z, points[0]!.z, this.#worldHeightUnits);
    const firstOutside = points.findIndex((p) => Math.abs(p.x - centre.x) > 1.6 || Math.abs(p.z - centre.z) > 1.7);
    if (firstOutside < 0) return points;
    const join = points[firstOutside]!;
    const height = this.#store!.ground(hall.cellX, hall.cellY)?.height;
    const y = height !== undefined && this.#renderer!.rendered(hall.cellX, hall.cellY) ? height + 0.33 : NaN;
    // Door faces -Z: start just inside, clear the porch, then turn outside the walls.
    const entrance = [
      new Vector3(centre.x, y + 0.1, centre.z + TOWN_HALL_DOOR_Z + 0.06),
      new Vector3(centre.x, y, centre.z - 1.8),
    ];
    if (join.z > centre.z - 1.7 && Math.abs(join.x - centre.x) < 1.6) {
      const side = centre.x + (join.x < centre.x ? -1 : 1) * 1.7;
      entrance.push(new Vector3(side, y, centre.z - 1.8), new Vector3(side, join.y, join.z));
    } else entrance.push(new Vector3(join.x, y, centre.z - 1.8));
    return [...entrance, ...points.slice(firstOutside)];
  }

  #leisurePath(buildingId: string, path: TravelCell[], lane?: DoorLane): Array<Vector3 & { lane?: DoorLane }> {
    const building = this.#state?.cells.find((c) => c.building?.id === buildingId);
    if (!building || !this.#space) return [];
    if (path.some((p) => !Number.isInteger(p.cellX) || !Number.isInteger(p.cellY))) return this.#pathPoints(path);
    const factoryPlan = planForSite(this.#state!, building, (x, y) => this.#store?.ground(x, y)?.height ?? null);
    if (factoryPlan) {
      const points = this.#workerPath(path, lane);
      if (building.building!.type === 'town-hall') {
        // The indoor point of the lane walked in that direction: spokes start on the exit lane.
        const offset = doorLaneOffset(factoryPlan, lane ?? 'out'),
          inside = factoryPlan.entry.inside;
        const p = transformPoint(factoryPlan, { x: inside.x + offset.x, y: inside.y, z: inside.z + offset.z }),
          centre = this.#space.project(building);
        return [new Vector3(centre.x + p.x, p.y + 0.31, centre.z + p.z)];
      }
      return this.#factoryDeparture(building, factoryPlan, [...points].reverse()).reverse();
    }
    if (building.building!.type === 'town-hall') {
      const centre = this.#space.project(building);
      return [new Vector3(centre.x, 0, centre.z + TOWN_HALL_DOOR_Z + 0.06)];
    }
    const points = this.#workerPath(path);
    if (!points.length) return points;
    const centre = this.#space.project(building),
      last = points[points.length - 1]!;
    centre.x = last.x + delta(centre.x, last.x, this.#worldWidthUnits);
    centre.z = last.z + delta(centre.z, last.z, this.#worldHeightUnits);
    let outside = points.length - 1;
    while (
      outside > 0 &&
      Math.abs(points[outside]!.x - centre.x) < 1.05 &&
      Math.abs(points[outside]!.z - centre.z) < 1.05
    )
      outside--;
    const join = points[outside]!,
      entrance: Vector3[] = [];
    if (join.z > centre.z - 1.05 && Math.abs(join.x - centre.x) < 1.05) {
      const side = centre.x + (join.x < centre.x ? -1 : 1) * 1.08;
      entrance.push(new Vector3(side, join.y, join.z), new Vector3(side, join.y, centre.z - 1.08));
    } else entrance.push(new Vector3(join.x, join.y, centre.z - 1.08));
    entrance.push(new Vector3(centre.x, join.y, centre.z - 1.08), new Vector3(centre.x, join.y, centre.z - 0.74));
    return [...points.slice(0, outside + 1), ...entrance];
  }

  #factoryDeparture(
    site: VillageCell,
    plan: BuildingPlan,
    points: Vector3[],
    lane?: DoorLane,
  ): Array<Vector3 & { lane?: DoorLane; width?: number }> {
    if (!points.length) return points;
    const anchor = this.#space!.project(site),
      c = Math.cos(plan.rotation),
      s = Math.sin(plan.rotation);
    anchor.x = points[0]!.x + delta(anchor.x, points[0]!.x, this.#worldWidthUnits);
    anchor.z = points[0]!.z + delta(anchor.z, points[0]!.z, this.#worldHeightUnits);
    const local = (p: Vector3) => {
      const x = p.x - anchor.x - plan.origin.x,
        z = p.z - anchor.z - plan.origin.z;
      return { x: c * x - s * z, y: 0, z: s * x + c * z };
    };
    const connector = doorConnector(plan, points.map(local), lane);
    if (!connector) return points;
    const route = connector.route.map((p) => {
      const q = transformPoint(plan, p);
      return Object.assign(new Vector3(anchor.x + q.x, plan.origin.y + 0.31, anchor.z + q.z), {
        lane: p.lane,
        width: p.width,
      });
    });
    return [...route, ...points.slice(connector.resume)];
  }

  #travelDerived: {
    state: VillageState;
    signature: string;
    accesses: ReturnType<typeof buildingAccesses>;
    occupied: Set<string>;
    displayRoutes: ReturnType<typeof villageRoadDisplayRoutes>;
    fires: ReturnType<typeof automaticBraziers>;
  } | null = null;
  #deriveTravel(state: VillageState): void {
    const derivedSignature = JSON.stringify([
      state.world.id,
      state.travelRoutes,
      state.infrastructure,
      state.cells
        .filter((c) => c.footprint || c.building)
        .map((c) => [
          c.cellX,
          c.cellY,
          c.footprint,
          c.building && [
            c.building.id,
            c.building.type,
            c.building.visualLayout,
            c.building.quarterTurns,
            c.building.accesses,
          ],
        ]),
      state.region.originCellX,
      state.region.originCellY,
      state.region.terrainCodes,
      state.region.features.map((f) => [f.cellX, f.cellY, f.deposit?.blocksCell, f.deposit?.cleared, f.deposit?.state]),
    ]);
    if (this.#travelDerived?.signature === derivedSignature) {
      this.#travelDerived.state = state;
      return;
    }
    const accesses = state.cells.flatMap((c) => (c.building ? buildingAccesses(state, c.building.id) : []));
    this.#infrastructureBarriers = state.infrastructure
      ? infrastructureBlockedPixels(state.infrastructure, state.world, accesses)
      : new Set();
    const fires = automaticBraziers(state);
    this.#infrastructureEquipment = [
      ...(state.infrastructure?.equipment ?? []).map((e) => ({ x: e.x, y: e.y })),
      ...fires.map((e) => e.position),
    ];
    const occupied = new Set(state.cells.filter((c) => c.footprint || c.building).map((c) => `${c.cellX}:${c.cellY}`));
    this.#travelDerived = {
      state,
      signature: derivedSignature,
      accesses,
      occupied,
      fires,
      displayRoutes: villageRoadDisplayRoutes(state),
    };
  }
  #renderLab: RenderLab | null = null;
  /** Measurement switches, only for opted-in developer tools. */
  renderLab(): RenderLab | null {
    if (!devToolsEnabled()) return null;
    return (this.#renderLab ??= new RenderLab(this.#scene));
  }
  #updateTravelPaths(
    state: VillageState,
    visible: boolean,
    selectedRouteId: string | null,
    frame?: FrameTimings,
  ): void {
    // Snapshots are replaced, never mutated: streamed terrain versions reuse the
    // derived data by identity instead of serializing the whole village again
    // (~1 s per camera rotation on alpha Catmark, browser profile).
    if (this.#travelDerived?.state !== state) this.#deriveTravel(state);
    const { accesses, occupied, fires, displayRoutes } = this.#travelDerived!;
    const groundIdentity = this.#store
      ? JSON.stringify([
          state.world.id,
          state.world.generationVersion,
          this.#store.groundRevision,
          this.#renderer?.groundVersion,
        ])
      : undefined;
    const groundCellIdentity = (x: number, y: number) =>
      `${state.world.id}:${state.world.generationVersion}:${this.#renderer?.hasGround(x, y) ? (this.#store?.groundRevisionAt(x, y) ?? 0) + 1 : 0}`;
    frame?.mark('roadsPlan');
    if (state.infrastructure) {
      this.#renderer?.setInfrastructure(state.infrastructure);
      this.#infrastructureRenderer ??= new InfrastructureRenderer(this.#scene, true);
      this.#infrastructureRenderer.update(
        state.infrastructure,
        this.#space!,
        (x, y) => (this.#renderer?.hasGround(x, y) ? (this.#store?.ground(x, y)?.height ?? null) : null),
        false,
        this.#renderer?.groundVersion ?? 0,
        undefined,
        false,
        accesses,
        { followTerrain: state.world.generationVersion === 3, groundIdentity, groundCellIdentity },
      );
      this.#infrastructureRenderer.visible(this.#mode !== 'world');
    }
    // Road cells have their own renderer (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §4.3):
    // a gesture rasterizes and regenerates only the cells' sectors, never the
    // historical stroke plan, which stays drawn as is until its conversion (S3).
    const roadPlan = this.#roadCellsPlan.compose(EMPTY_ROAD_PLAN, state.roadCells);
    if (roadPlan !== EMPTY_ROAD_PLAN || this.#roadCellsRenderer) {
      const changed = roadPlan !== this.#renderedRoadPlan,
        started = changed ? performance.now() : 0;
      this.#renderedRoadPlan = roadPlan;
      this.#roadCellsRenderer ??= new InfrastructureRenderer(this.#scene, true);
      this.#roadCellsRenderer.update(
        roadPlan,
        this.#space!,
        (x, y) => (this.#renderer?.hasGround(x, y) ? (this.#store?.ground(x, y)?.height ?? null) : null),
        false,
        this.#renderer?.groundVersion ?? 0,
        undefined,
        false,
        accesses,
        { followTerrain: state.world.generationVersion === 3, groundIdentity, groundCellIdentity },
      );
      if (changed && import.meta.env.DEV)
        this.#canvas.dataset.roadCellsUpdateMs = (performance.now() - started).toFixed(1);
      this.#roadCellsRenderer.visible(this.#mode !== 'world');
    }
    frame?.mark('roadsManual');
    this.#renderer?.setRoads(displayRoutes);
    this.#villageBraziers ??= new VillageBraziers(this.#scene);
    // Braziers and automatic roads depend on the snapshot (campus fires follow
    // university levels) and on published ground, not on which units are visible.
    const brazierInputs = [
      state,
      this.#travelDerived,
      this.#space,
      this.#space?.version,
      this.#renderer?.groundVersion,
      this.#store?.groundRevision,
    ];
    const braziersCurrent = sameInputs(this.#brazierInputs, brazierInputs);
    this.#brazierInputs = brazierInputs;
    const campusFires = state.cells.flatMap((site) => {
      if (site.building?.type !== 'university' || site.building.status !== 'completed' || site.building.level !== 3)
        return [];
      const centre = this.#universityCentre(site);
      const turn = ((site.building.quarterTurns ?? 0) * Math.PI) / 2,
        c = Math.cos(turn),
        s = Math.sin(turn),
        z = 2.5 * TILE_SIZE - (TILE_SIZE / 2 + 0.18);
      return [-1, 1].flatMap((sign) =>
        [3.125, 4.375, 5.625].map((x, index) => ({
          renderKey: `campus:${site.building!.id}:${sign}:${index}`,
          x: centre.x + c * sign * x + s * z,
          y: centre.y + 0.02,
          z: centre.z - s * sign * x + c * z,
          seed: (index + (sign > 0 ? 3 : 0) + 0.5) / 6,
        })),
      );
    });
    if (!braziersCurrent)
      this.#villageBraziers.update(
        displayRoutes,
        this.#space!,
        (cell) =>
          this.#renderer!.hasGround(cell.cellX, cell.cellY) ? this.#store!.ground(cell.cellX, cell.cellY) : null,
        occupied,
        campusFires,
        state.infrastructure,
        state,
        fires,
      );
    frame?.mark('braziers');
    this.#villageRoads ??= new VillageRoads(this.#scene);
    if (!braziersCurrent)
      this.#villageRoads.update(
        JSON.stringify([state.world.id, this.#space?.version, this.#renderer?.groundVersion]),
        displayRoutes,
        this.#space!,
        (cell) =>
          this.#renderer!.hasGround(cell.cellX, cell.cellY) ? this.#store!.ground(cell.cellX, cell.cellY) : null,
        state.world.generationVersion === 3,
        groundIdentity,
        groundCellIdentity,
      );
    frame?.mark('roadsAutomatic');
    const routes = selectedRouteId
      ? state.travelRoutes.filter((route) => route.id === selectedRouteId)
      : state.travelRoutes;
    // Same identity rule: the route cells are serialized once per snapshot.
    if (this.#travelCells?.routes !== state.travelRoutes || this.#travelCells.selected !== selectedRouteId)
      this.#travelCells = {
        routes: state.travelRoutes,
        selected: selectedRouteId,
        json: JSON.stringify(routes.map((route) => route.cells)),
      };
    const signature = JSON.stringify([visible, selectedRouteId, this.#space?.version, this.#renderer?.version]);
    if (signature === this.#lastTravelSignature && this.#travelCells.json === this.#lastTravelCells) return;
    this.#lastTravelSignature = signature;
    this.#lastTravelCells = this.#travelCells.json;
    this.#travelLines?.dispose();
    this.#travelSurface?.dispose(false, true);
    this.#travelLines = null;
    this.#travelSurface = null;
    if (!visible || !routes.length) return;
    const positions: number[] = [];
    const indices: number[] = [];
    const contours: Vector3[][] = [];
    const seen = new Set<string>();
    const inRegion = (cell: TravelCell): boolean =>
      this.#renderer!.rendered(cell.cellX, cell.cellY) && this.#store!.ground(cell.cellX, cell.cellY) !== null;
    for (const route of routes) {
      const points = this.#pathPoints(route.cells);
      for (let step = 1; step < route.cells.length; step++) {
        const firstCell = route.cells[step - 1]!,
          secondCell = route.cells[step]!;
        if (!inRegion(firstCell) || !inRegion(secondCell)) continue;
        const firstKey = `${firstCell.cellX}:${firstCell.cellY}`;
        const secondKey = `${secondCell.cellX}:${secondCell.cellY}`;
        const reversed =
          firstCell.cellX > secondCell.cellX ||
          (firstCell.cellX === secondCell.cellX && firstCell.cellY > secondCell.cellY);
        const key = reversed ? `${secondKey}|${firstKey}` : `${firstKey}|${secondKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const image = this.#space!.project(firstCell),
          prior = points[step - 1]!;
        const shift = new Vector3(image.x - prior.x, 0, image.z - prior.z);
        const start = (reversed ? points[step]! : prior).add(shift);
        const end = (reversed ? prior : points[step]!).add(shift);
        const dx = end.x - start.x,
          dz = end.z - start.z;
        const length = Math.hypot(dx, dz);
        if (length < 0.01 || length > TILE_SIZE * 1.5) continue;
        const normalX = -dz / length,
          normalZ = dx / length;
        const left: Vector3[] = [],
          right: Vector3[] = [];
        const count = 6;
        const base = positions.length / 3;
        for (let sample = 0; sample <= count; sample++) {
          const fraction = sample / count;
          const x = start.x + dx * fraction,
            z = start.z + dz * fraction;
          const canonical = this.#space!.inverse(x, z);
          const y = start.y + (end.y - start.y) * fraction - 0.26;
          for (const side of [1, -1]) {
            const width =
              0.32 +
              (this.#hash(
                Math.round(canonical.cellX * TILE_SIZE * 10) + side * 113,
                Math.round(canonical.cellY * TILE_SIZE * 10) + side * 227,
              ) -
                0.5) *
                0.14;
            const ex = x + normalX * width * side,
              ez = z + normalZ * width * side,
              c = this.#space!.inverse(ex, ez);
            const edge = new Vector3(
              ex,
              state.world.generationVersion === 3 ? (this.#store!.ground(c.cellX, c.cellY)?.height ?? y) + 0.07 : y,
              ez,
            );
            positions.push(edge.x, edge.y, edge.z);
            (side === 1 ? left : right).push(edge.add(new Vector3(0, 0.012, 0)));
          }
          if (sample > 0) {
            const previous = base + (sample - 1) * 2,
              current = base + sample * 2;
            indices.push(previous, current, previous + 1, previous + 1, current, current + 1);
          }
        }
        contours.push(left, right);
      }
    }
    if (!indices.length) return;
    const surface = new BabylonMesh('debug-travel-surface', this.#scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = [];
    VertexData.ComputeNormals(positions, indices, data.normals);
    data.applyToMesh(surface);
    const material = this.#material('debug-travel-earth', '#8b764f', 0.55, '#8b764f');
    material.backFaceCulling = false;
    material.disableLighting = true;
    surface.material = material;
    surface.isPickable = false;
    this.#travelSurface = surface;
    const outline = MeshBuilder.CreateLineSystem(
      'debug-travel-paths',
      { lines: contours, useVertexAlpha: true },
      this.#scene,
    );
    outline.color = Color3.FromHexString('#65583a');
    outline.alpha = 0.62;
    outline.isPickable = false;
    this.#travelLines = outline;
  }

  #updateBuildableGrid(state: VillageState): void {
    this.#buildableGrid?.dispose();
    this.#buildableGrid = null;
    this.#buildableArea?.dispose(false, true);
    this.#buildableArea = null;
    if (!this.#constructionMode) return;
    const areaPositions: number[] = [];
    const areaIndices: number[] = [];
    const segments = new Map<string, [Vector3, Vector3]>();
    const add = (from: Vector3, to: Vector3): void => {
      const a = `${from.x}:${from.z}`;
      const b = `${to.x}:${to.z}`;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const previous = segments.get(key);
      if (previous && !state.region.vertexHeights) from.y = to.y = Math.max(from.y, previous[0].y);
      segments.set(key, [from, to]);
    };
    const half = TILE_SIZE / 2;
    for (const cell of state.cells) {
      if (!cell.canBuild) continue;
      const regionX = (cell.cellX - state.region.originCellX + state.world.widthCells) % state.world.widthCells;
      const regionY = (cell.cellY - state.region.originCellY + state.world.heightCells) % state.world.heightCells;
      const elevation =
        regionX < state.region.width && regionY < state.region.height
          ? (state.region.elevations[regionY * state.region.width + regionX] ?? 0)
          : 0;
      // The textured terrain is elevated per cell; an absolute plane can be
      // buried below it. Clear the shore lip as well as the grass surface.
      const y = elevation * 0.025 + 0.06;
      const northWest = new Vector3(cell.x - half, y, cell.z - half);
      const northEast = new Vector3(cell.x + half, y, cell.z - half);
      const southEast = new Vector3(cell.x + half, y, cell.z + half);
      const southWest = new Vector3(cell.x - half, y, cell.z + half);
      if (state.region.vertexHeights) {
        for (const [corner, dx, dy] of [
          [northWest, 0, 0],
          [northEast, 1, 0],
          [southEast, 1, 1],
          [southWest, 0, 1],
        ] as const)
          corner.y =
            state.region.vertexHeights[(regionY + dy) * (state.region.width + 1) + regionX + dx]! * TILE_SIZE + 0.06;
      }
      {
        const first = areaPositions.length / 3;
        for (const corner of [northWest, northEast, southEast, southWest]) {
          areaPositions.push(corner.x, corner.y - 0.01, corner.z);
        }
        areaIndices.push(first, first + 2, first + 1, first, first + 3, first + 2);
      }
      add(northWest, northEast);
      add(northEast, southEast);
      add(southEast, southWest);
      add(southWest, northWest);
    }
    const lines = [...segments.values()];
    if (areaPositions.length) {
      const area = new BabylonMesh('buildable-area', this.#scene);
      const data = new VertexData();
      data.positions = areaPositions;
      data.indices = areaIndices;
      data.normals = [];
      VertexData.ComputeNormals(areaPositions, areaIndices, data.normals);
      data.applyToMesh(area);
      const material = this.#material('buildable-area', '#b8d8f2', 0.16, '#b8d8f2');
      material.disableLighting = true;
      area.material = material;
      area.isPickable = false;
      area.alphaIndex = 0;
      this.#buildableArea = area;
    }
    const grid =
      lines.length > 0
        ? MeshBuilder.CreateLineSystem('buildable-grid', { lines, useVertexAlpha: true }, this.#scene)
        : null;
    this.#buildableGrid = grid;
    if (!grid) return;
    grid.color = Color3.FromHexString('#ffffff');
    grid.alpha = 0.22;
    grid.alphaIndex = 1;
    // Keep terrain depth: lines behind an occupied building or feature must
    // remain hidden, rather than projecting across its visible silhouette.
    grid.renderingGroupId = 0;
    grid.isPickable = false;
  }

  #sceneryClone(key: string, name: string, create: () => Mesh): Mesh {
    let geometry = this.#sceneryGeometry.get(key);
    if (!geometry) {
      geometry = create();
      geometry.setEnabled(false);
      geometry.isPickable = false;
      this.#sceneryGeometry.set(key, geometry);
    }
    const mesh = geometry.clone(name, null, true)!;
    mesh.setEnabled(true);
    mesh.isPickable = false;
    return mesh;
  }

  #createRockCluster(x: number, z: number, scale: number, index: number, sceneryMeshes: Mesh[], baseY = 0): void {
    for (let part = 0; part < (index % 3 === 0 ? 3 : 2); part += 1) {
      const radius = scale * (0.42 - part * 0.07);
      const rock = this.#sceneryClone('ico', 'rock-' + index + '-' + part, () =>
        MeshBuilder.CreateIcoSphere('scenery-ico', { radius: 1, subdivisions: 1 }, this.#scene),
      );
      rock.position.set(x + part * scale * 0.42, baseY + scale * (0.3 - part * 0.03), z + (part % 2) * scale * 0.28);
      rock.scaling.set(radius, radius * 0.72, radius * 0.86);
      rock.rotation.set(part * 0.24, this.#hash(index, part + 251) * Math.PI, part * -0.16);
      rock.material = this.#stoneMaterial;
      rock.isPickable = false;
      sceneryMeshes.push(rock);
    }
  }

  #hash(x: number, z: number): number {
    const value = Math.sin(x * 127.1 + z * 311.7) * 43_758.5453;
    return value - Math.floor(value);
  }

  #createConstructionBorder(name: string, size: number): Mesh {
    const outer = size / 2,
      inner = outer - 0.08;
    const mesh = new BabylonMesh(name, this.#scene),
      data = new VertexData();
    data.positions = [
      -outer,
      0,
      -outer,
      outer,
      0,
      -outer,
      outer,
      0,
      outer,
      -outer,
      0,
      outer,
      -inner,
      0,
      -inner,
      inner,
      0,
      -inner,
      inner,
      0,
      inner,
      -inner,
      0,
      inner,
    ];
    data.indices = [];
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      data.indices.push(i, i + 4, next, next, i + 4, next + 4);
    }
    data.normals = [];
    VertexData.ComputeNormals(data.positions, data.indices, data.normals);
    data.applyToMesh(mesh);
    mesh.renderingGroupId = 1;
    mesh.isPickable = false;
    return mesh;
  }

  #createAvailableSite(site: VillageCell): Mesh {
    const highlighted = this.#highlightedSiteIds.has(site.id);
    const marker = MeshBuilder.CreateBox(
      `site-${site.id}`,
      { height: highlighted ? 0.045 : 0.018, width: highlighted ? 2.3 : 2.15, depth: highlighted ? 2.3 : 2.15 },
      this.#scene,
    );
    marker.position.set(site.x, 0.075, site.z);
    marker.material = this.#siteMaterial;
    // Picking/preview plates belong only to construction. The LOD fade must
    // neither reveal them outside that mode nor replace their base opacity.
    marker.isVisible = this.#constructionMode && site.canBuild;
    marker.metadata = { baseVisibility: highlighted ? 1 : 0.015 };
    if (highlighted) {
      const border = this.#createConstructionBorder(`site-border-${site.id}`, 2.3);
      border.parent = marker;
      border.isVisible = marker.isVisible;
      border.position.y = 0.03;
      border.material = this.#candidateMaterial;
    } else {
      marker.visibility = 0.015;
    }
    return marker;
  }

  #siteGround(site: VillageCell): number {
    const cells = site.building ? this.#state!.cells.filter((c) => c.footprint?.buildingId === site.building!.id) : [];
    return Math.max(...(cells.length ? cells : [site]).map((c) => this.#store?.ground(c.cellX, c.cellY)?.height ?? 0));
  }
  #groundKey(): string {
    return `${this.#renderer?.groundVersion}:${this.#store?.groundRevision}:${this.#space?.version}`;
  }
  #refreshBuildingGround(): void {
    if (!this.#state) return;
    const bases = new Map<string, number>();
    for (const site of this.#state.cells) {
      const id = site.footprint?.buildingId ?? site.building?.id ?? site.id;
      const h = this.#store?.ground(site.cellX, site.cellY)?.height ?? 0;
      bases.set(id, Math.max(bases.get(id) ?? -Infinity, h));
    }
    for (const [id, cached] of this.#buildingCache) {
      const base = bases.get(id);
      if (base !== undefined && cached.mesh.metadata?.groundOffset !== undefined) {
        const y = base + cached.mesh.metadata.groundOffset;
        if (cached.mesh.position.y !== y) {
          cached.mesh.position.y = y;
          refreshStaticHierarchy(cached.mesh);
        }
      }
    }
  }

  #createBuilding(site: VillageCell): Mesh {
    if (site.building?.type === 'stonemason') {
      const body = new BabylonMesh(`stonemason-${site.building.id}`, this.#scene);
      body.position.copyFrom(this.#universityCentre(site));
      body.rotation.y = ((site.building.quarterTurns ?? 0) * Math.PI) / 2;
      this.#timberThatch ??= new TimberThatch(this.#scene);
      if (buildingAssets['stonemason-1-finished']) this.#loadBuildingAsset(body, 'stonemason-1-finished');
      else
        buildCachedProceduralBuildingLod(
          body,
          'stonemason-finished',
          (root) => buildStonemason(root, this.#timberThatch!, 'finished', false),
          this.#timberThatch,
        );
      buildStonemasonFire(body, this.#timberThatch);
      this.#createContactShadow(body, 4.5, 4.5, body.position.y);
      return this.#registerStructure(body);
    }
    if (site.building?.type === 'garden') return this.#createGardenPlot(site, false);
    if (site.building?.type === 'sawmill') return this.#createSawmill(site);
    if (site.building?.type === 'town-hall') return this.#createTownHall(site);
    return this.#createDwelling(site);
  }

  /** The factory bakes the market's shell; only its clock hands, braziers and storefront glass are built here. */
  #createTownHallMarket(body: Mesh, phase: 'finished' | 'works', oppositeEntrance: boolean): void {
    this.#timberThatch ??= new TimberThatch(this.#scene);
    const key = `town-hall-2-${phase}`;
    if (!buildingAssets[key]) {
      buildProceduralBuildingLod(
        body,
        (root, lod) => buildTownHallMarket(root, this.#timberThatch!, phase, lod === 0 ? body : null, oppositeEntrance),
        this.#timberThatch,
      );
      return;
    }
    // The same half-turn the factory gives its own root for an entrance on +X.
    if (oppositeEntrance) body.rotation.y += Math.PI;
    this.#loadBuildingAsset(body, key);
    const live = new BabylonMesh(`${body.name}-live`, this.#scene);
    live.parent = body;
    buildTownHallMarket(live, this.#timberThatch, phase, body, false, 'live');
  }

  #createTownHall(site: VillageCell): Mesh {
    const body = new BabylonMesh(`town-hall-${site.id}`, this.#scene);
    body.position.set(site.x, 0.78, site.z);
    this.#timberThatch ??= new TimberThatch(this.#scene);
    if ((site.building?.targetLevel ?? site.building?.level ?? 1) >= 2) {
      body.position.y = 0;
      this.#createTownHallMarket(body, site.building?.status === 'under-construction' ? 'works' : 'finished', false);
      this.#createContactShadow(body, 2.32, 4.56);
      return this.#registerStructure(body);
    }
    buildProceduralBuildingLod(body, (root) => this.#timberThatch!.build(root), this.#timberThatch);
    this.#createContactShadow(body, 2.75, 2.45);
    return this.#registerStructure(body);
  }

  #universityCentre(site: VillageCell): Vector3 {
    const cells = this.#state!.cells.filter((c) => c.footprint?.buildingId === site.building!.id);
    const dx = cells.map((c) => delta(c.cellX, site.cellX, this.#state!.world.widthCells));
    const dz = cells.map((c) => delta(c.cellY, site.cellY, this.#state!.world.heightCells));
    const heights = cells.map((c) => this.#store?.ground(c.cellX, c.cellY)?.height ?? 0);
    const point = this.#space!.projectFrom(site, this.#villageAnchor);
    return new Vector3(
      point.x + ((Math.min(...dx) + Math.max(...dx)) * TILE_SIZE) / 2,
      Math.max(0, ...heights),
      point.z + ((Math.min(...dz) + Math.max(...dz)) * TILE_SIZE) / 2,
    );
  }

  #createUniversity(site: VillageCell): Mesh {
    const body = new BabylonMesh(`university-${site.building!.id}`, this.#scene);
    body.position.copyFrom(this.#universityCentre(site));
    body.rotation.y = ((site.building?.quarterTurns ?? 0) * Math.PI) / 2;
    const level = site.building!.targetLevel ?? site.building!.level;
    const phase = site.building!.status === 'under-construction' ? 'works' : 'finished';
    const monuments = {
      mathematics: (this.#state!.science?.levels.mathematics ?? 0) >= 3,
      astronomy: (this.#state!.science?.levels.astronomy ?? 0) >= 1,
    };
    this.#loadBuildingAsset(body, `university-${level}-${phase}`, () => {
      if (phase === 'finished' && (monuments.mathematics || monuments.astronomy)) {
        this.#timberThatch ??= new TimberThatch(this.#scene);
        buildUniversityMonuments(body, this.#timberThatch, monuments);
      }
    });
    return this.#registerStructure(body);
  }

  #loadBuildingAsset(body: Mesh, key: string, ready?: () => void, attempt = 0): void {
    body.metadata = { ...body.metadata, assetState: 'loading' };
    void loadBakedBuilding(body, key, true)
      .then(() => {
        if (body.isDisposed()) return;
        ready?.();
        body.metadata = { ...body.metadata, assetState: 'ready' };
        for (const mesh of body.getChildMeshes()) {
          mesh.metadata = { ...mesh.metadata, siteId: body.metadata?.siteId };
          mesh.isPickable = body.isPickable && mesh.metadata?.buildingAttachment !== 'glass';
          mesh.receiveShadows = true;
        }
        refreshStaticHierarchy(body);
      })
      .catch((error) => {
        if (body.isDisposed()) return;
        if (attempt < 2) {
          const timer = window.setTimeout(
            () => {
              if (!body.isDisposed()) this.#loadBuildingAsset(body, key, ready, attempt + 1);
            },
            500 * (attempt + 1),
          );
          body.onDisposeObservable.addOnce(() => window.clearTimeout(timer));
        } else {
          body.metadata = { ...body.metadata, assetState: 'error' };
          console.error('Building asset failed', key, error);
        }
      });
  }

  #createFactoryBuilding(site: VillageCell, plan: BuildingPlan): Mesh {
    this.#factoryGenerationCount++;
    const body = new BabylonMesh(`factory-${site.building!.id}`, this.#scene);
    body.position.set(site.x + plan.origin.x, plan.origin.y, site.z + plan.origin.z);
    body.rotation.y = plan.rotation;
    if (site.building?.type === 'town-hall' && (site.building.targetLevel ?? site.building.level) >= 2) {
      this.#createTownHallMarket(body, plan.phase, plan.recipe.entrance.face === '+x');
      this.#createContactShadow(body, plan.width + 0.08, plan.depth + 0.08, plan.base);
      return this.#registerStructure(body);
    }
    const key = bakedPlanKey(plan);
    if (key) this.#loadBuildingAsset(body, key);
    else {
      this.#timberThatch ??= new TimberThatch(this.#scene);
      // Identical houses share one generated template per level of detail.
      buildCachedProceduralBuildingLod(
        body,
        'factory:' + planShapeKey(plan),
        (root) => this.#timberThatch!.build(root, plan),
        this.#timberThatch,
      );
    }
    this.#createContactShadow(body, plan.width + 0.08, plan.depth + 0.08);
    return this.#registerStructure(body);
  }

  #createSawmill(site: VillageCell): Mesh {
    const level = site.building?.level ?? 1;
    const foundation = new BabylonMesh(`sawmill-${site.id}`, this.#scene);
    foundation.position.set(site.x, 0.09, site.z);
    buildCachedProceduralBuildingLod(foundation, `sawmill-${level}`, (root, lod) => {
      const model = buildSawmill(
        this.#scene,
        {
          stone: this.#stoneMaterial,
          lightTimber: this.#lightTimberMaterial,
          packedEarth: this.#packedEarthMaterial,
          sawdust: this.#sawdustMaterial,
          darkTimber: this.#darkTimberMaterial,
          timber: this.#timberMaterial,
          roof: this.#roofMaterial,
          trunk: this.#trunkMaterial,
        },
        `${site.id}-lod${lod}`,
        level,
        0,
        0,
        lod,
      );
      model.parent = root;
      model.position.y = 0;
    });
    this.#createContactShadow(foundation, level >= 2 ? 3.5 : 2.65, 2.45);
    return this.#registerStructure(foundation);
  }

  #createDwelling(site: VillageCell): Mesh {
    const level = site.building?.level ?? 1;
    const body = MeshBuilder.CreateBox(`dwelling-${site.id}`, { width: 1.7, depth: 1.55, height: 1.12 }, this.#scene);
    body.position.set(site.x, 0.66, site.z);
    body.material = level >= 2 ? this.#timberMaterial : this.#lightTimberMaterial;
    const roof = MeshBuilder.CreateCylinder(
      `dwelling-roof-${site.id}`,
      { height: 0.72, diameterTop: 0, diameterBottom: 2.25, tessellation: 4 },
      this.#scene,
    );
    roof.parent = body;
    roof.position.y = 0.85;
    roof.rotation.y = Math.PI / 4;
    roof.material = this.#roofMaterial;
    const door = MeshBuilder.CreateBox(
      `dwelling-door-${site.id}`,
      { width: 0.42, height: 0.68, depth: 0.06 },
      this.#scene,
    );
    door.parent = body;
    door.position.set(0, -0.21, -0.8);
    door.material = this.#darkTimberMaterial;
    this.#createContactShadow(body, 1.98, 1.82);
    return this.#registerStructure(body);
  }

  #createGardenPlot(site: VillageCell, reserved: boolean): Mesh {
    this.#gardenPlots ??= new GardenPlots(this.#scene, {
      soil: this.#soilMaterial,
      tiles: this.#gardenTileMaterials,
      marker: this.#windowMaterial,
      stem: this.#leafDarkMaterial,
    });
    const ground = this.#store?.ground(site.cellX, site.cellY)?.height ?? 0;
    const plot = this.#gardenPlots.create(
      site.id,
      site.x,
      site.z,
      ground,
      reserved ? 0 : (this.#gardenStages.get(site.id) ?? 1),
      !reserved && this.#fullGardenSites.has(site.id),
      !reserved && this.#gardenKit !== null,
    );
    return this.#registerStructure(plot);
  }

  /** Completed plots drawn by the garden kit, at their plot mesh's current place. */
  #gardenPlotViews(state: VillageState): GardenPlotView[] {
    const { widthCells: width, heightCells: height } = state.world,
      key = (x: number, y: number) => `${((x % width) + width) % width}:${((y % height) + height) % height}`,
      sites = new Map(state.cells.map((c) => [c.id, c])),
      now = Date.now() - this.#serverOffsetMs,
      views: GardenPlotView[] = [];
    this.#gardenHarvesting = false;
    for (const cell of state.cells) {
      const building = cell.building;
      if (building?.type !== 'garden' || building.status !== 'completed' || !building.garden) continue;
      const members = new Set(building.garden.plots.map((p) => key(p.cellX, p.cellY)));
      for (const plot of building.garden.plots) {
        const id = cellKey(plot),
          site = sites.get(id);
        if (!site || site.footprint?.state === 'reserved') continue;
        const mesh = this.#buildingCache.get(site.building?.id ?? site.id)?.mesh;
        if (!mesh || mesh.isDisposed()) continue;
        const harvest = gardenHarvestState(plot, now);
        if (harvest) this.#gardenHarvesting = true;
        views.push({
          id,
          x: mesh.position.x,
          y: mesh.position.y,
          z: mesh.position.z,
          stage: harvest?.visibleStage ?? this.#gardenStages.get(id) ?? 1,
          ...(harvest ? { harvest: { stage: harvest.stage, remaining: harvest.remaining } } : {}),
          open: {
            west: !members.has(key(plot.cellX - 1, plot.cellY)),
            east: !members.has(key(plot.cellX + 1, plot.cellY)),
            south: !members.has(key(plot.cellX, plot.cellY - 1)),
            north: !members.has(key(plot.cellX, plot.cellY + 1)),
          },
        });
      }
    }
    return views;
  }

  #createGardenExtension(site: VillageCell): Mesh {
    return this.#createGardenPlot(site, site.footprint?.state === 'reserved');
  }

  #createConstructionSite(site: VillageCell): Mesh {
    const building = site.building;
    const targetLevel = building?.targetLevel ?? building?.level ?? 1;
    const isGarden = building?.type === 'garden';
    const height = building?.type === 'sawmill' ? 0.95 + targetLevel * 0.78 : isGarden ? 0.34 : 1.25;
    const width = isGarden ? 2.32 : 1.82;
    const construction = MeshBuilder.CreateBox(
      `construction-${building?.id}`,
      { width, depth: width, height },
      this.#scene,
    );
    construction.position.set(site.x, height / 2 + 0.11, site.z);
    construction.material = this.#constructionMaterial;
    if (isGarden) {
      const surface = MeshBuilder.CreateGround(
        `garden-construction-surface-${site.id}`,
        { width: TILE_SIZE * 0.97, height: TILE_SIZE * 0.97 },
        this.#scene,
      );
      surface.parent = construction;
      surface.position.y = 0.16 - construction.position.y;
      surface.material = this.#gardenTileMaterials[0]!;
    }
    for (const x of [-width / 2, width / 2]) {
      for (const z of [-width / 2, width / 2]) {
        const post = MeshBuilder.CreateBox(
          `scaffold-${site.id}-${x}-${z}`,
          { width: 0.09, depth: 0.09, height: Math.max(0.42, height) },
          this.#scene,
        );
        post.parent = construction;
        post.position.set(x * 0.9, 0, z * 0.9);
        post.material = this.#scaffoldMaterial;
      }
    }
    for (const y of [-height * 0.25, height * 0.25]) {
      const rail = MeshBuilder.CreateBox(
        `scaffold-rail-${site.id}-${y}`,
        { width: width * 0.96, depth: 0.07, height: 0.08 },
        this.#scene,
      );
      rail.parent = construction;
      rail.position.set(0, y, -width * 0.47);
      rail.material = this.#scaffoldMaterial;
    }
    return this.#registerStructure(construction);
  }

  #registerStructure(root: Mesh): Mesh {
    root.receiveShadows = true;
    // Instances take shadows from their source; setting it on them only warns.
    for (const child of root.getChildMeshes())
      if (child.getClassName() !== 'InstancedMesh') child.receiveShadows = true;
    return root;
  }

  #createContactShadow(parent: Mesh, width: number, depth: number, ground = 0): void {
    if (!this.#contactShadowSource) {
      this.#contactShadowSource = MeshBuilder.CreateDisc(
        'contact-shadow-source',
        { radius: 0.5, tessellation: 16 },
        this.#scene,
      );
      this.#contactShadowSource.material = this.#contactShadowMaterial;
      this.#contactShadowSource.isVisible = false;
      this.#contactShadowSource.isPickable = false;
    }
    const shadow = this.#contactShadowSource.createInstance(`contact-shadow-${parent.name}`);
    shadow.parent = parent;
    shadow.rotation.x = Math.PI / 2;
    shadow.position.set(0.1, ground - parent.position.y + 0.035, 0.12);
    shadow.scaling.set(width, depth, 1);
    shadow.isPickable = false;
  }

  #applySelection(): void {
    const selected = this.#selectedSiteId ? this.#selectableMeshes.get(this.#selectedSiteId) : undefined;
    this.#selectionMarker.isVisible = Boolean(selected);
    if (selected)
      this.#selectionMarker.position.set(
        selected.position.x,
        selected.position.y - (selected.metadata?.groundOffset ?? selected.position.y) + 0.135,
        selected.position.z,
      );
  }

  #wrapCamera(): void {
    if (!this.#space || !this.#store) return;
    const target = this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
    const priorVillage = this.#space.project(this.#villageAnchor);
    const shift = this.#space.rebase(target, this.#store.world.chunkSize);
    if (shift) this.#terraformRenderer?.update(this.#terraformVisual, this.#space);
    if (!shift) return;
    const nextVillage = this.#space.project(this.#villageAnchor);
    const villageShift = { x: priorVillage.x - nextVillage.x, z: priorVillage.z - nextVillage.z };
    this.#camera.target.x -= shift.x;
    this.#camera.target.z -= shift.z;
    this.#camera.position.x -= shift.x;
    this.#camera.position.z -= shift.z;
    this.#workers.shift(shift.x, shift.z);
    this.#demolitionTint?.shift(shift.x, shift.z);
    this.#roadCellPreview?.shift(shift.x, shift.z);
    this.#inhabitantCamera.shift(shift.x, shift.z);
    this.#resourceOverlayAt = 0;
    for (const mesh of [
      ...this.#villageMeshes,
      ...this.#previewMeshes,
      this.#selectionMarker,
      this.#constructionGhost,
      this.#buildableGrid,
      this.#buildableArea,
    ].filter((m): m is Mesh => m !== null)) {
      mesh.position.x -= villageShift.x;
      mesh.position.z -= villageShift.z;
      mesh.computeWorldMatrix(true);
      refreshStaticHierarchy(mesh);
    }
    for (const cell of this.#e2eCells) {
      cell.x -= villageShift.x;
      cell.z -= villageShift.z;
    }
    for (const feature of this.#e2eFeatures) {
      feature.x -= shift.x;
      feature.z -= shift.z;
    }
    this.#renderer?.shift(shift.x, shift.z);
    this.#regionalOverview.shift(shift.x, shift.z);
    if (this.#state && this.#initialLoad.ready)
      this.#updateTravelPaths(this.#state, this.#showTravel, this.#selectedRoute);
  }

  readonly #testCamera = (event: Event): void => {
    if (!this.#space) return;
    const target = (event as CustomEvent<TravelCell & { radius?: number; alpha?: number; beta?: number }>).detail,
      point = this.#space.project(target);
    this.#camera.inertialPanningX = this.#camera.inertialPanningY = 0;
    this.#camera.inertialAlphaOffset = this.#camera.inertialBetaOffset = this.#camera.inertialRadiusOffset = 0;
    this.#camera.target.copyFromFloats(point.x, 0.45, point.z);
    if (target.radius !== undefined)
      this.#camera.radius = Math.max(8, Math.min(this.#camera.upperRadiusLimit ?? 680, target.radius));
    if (target.alpha !== undefined) this.#camera.alpha = target.alpha;
    if (target.beta !== undefined) this.#camera.beta = Math.max(0.05, Math.min(1.35, target.beta));
  };
  readonly #testMetricsReset = (): void => {
    this.#frameMs.length = 0;
    this.#streamMs.length = 0;
    if (this.#renderer) {
      this.#renderer.integrationMs.length = 0;
      this.#renderer.activeIntegrationMs.length = 0;
      this.#renderer.slowestUnit = { kind: '', ms: 0 };
    }
  };

  public acceptDeposit(deposit: StoneDeposit): void {
    this.#store?.deposit(deposit);
  }
  public setCosmologyDebug(enabled: boolean): void {
    this.#cosmologyDebug = enabled && this.#globalModelAvailable();
    if (!enabled) {
      this.#pendingSolarProfile = false;
      this.#torusOverview?.restoreNavigation();
      this.#cosmologyPhase = null;
      this.#cosmologyPeriod = COSMOLOGY.periodMs;
    }
  }
  /** Server minus client clock, as measured on receipt of the state. */
  public setServerOffset(offsetMs: number): void {
    this.#cosmologyServerOffsetMs = offsetMs;
    this.#serverOffsetMs = -offsetMs;
    this.#serverOffsetMeasured = true;
  }
  public setVillageSolarPreview(fraction: number | null): void {
    if (
      fraction !== null &&
      (this.#worldMode !== 'exploration' ||
        this.#mode !== 'village' ||
        this.#transition.active ||
        this.#arrival ||
        this.#flyover)
    )
      return;
    this.#villageSolarPreview = fraction === null ? null : Math.max(0, Math.min(1, fraction)) * TAU;
    this.#cosmologyNextAt = 0;
  }
  public getVillageSolarView() {
    if (!this.#space) return undefined;
    const serverMs = Date.now() + this.#cosmologyServerOffsetMs;
    const phase = this.#villageSolarPreview ?? cyclePhase(serverMs);
    const u = (this.#villageAnchor.cellX / this.#space.width) * TAU,
      v = (this.#villageAnchor.cellY / this.#space.height) * TAU + Math.PI;
    if (!this.#clock || this.#clock.u !== u || this.#clock.v !== v) this.#clock = new SolarClock(u, v);
    return {
      fraction: (phase / TAU) % 1,
      label: this.#clock.label(serverMs, phase),
      preview: this.#villageSolarPreview !== null,
    };
  }
  public setCosmologyPhase(fraction: number | null): void {
    this.#cosmologyPhase = fraction === null ? null : Math.max(0, Math.min(1, fraction)) * TAU;
    this.#cosmologyNextAt = 0;
  }
  public setCosmologyPeriod(seconds: number): void {
    this.#cosmologyPeriod = Math.max(30, Math.min(28800, seconds)) * 1000;
    this.#cosmologyNextAt = 0;
  }
  public previewSolarProfile(): void {
    this.showWorld();
    if (this.#mode === 'world' && !this.#transition.active && this.#torusOverview)
      this.#torusOverview.showSolarProfile();
    else this.#pendingSolarProfile = true;
  }
  public getCosmologyDiagnostics() {
    return this.#cosmologyMetrics;
  }
  #updateCosmology(serverMs: number, now: number): void {
    if (!this.#state || !this.#space) return;
    const preview =
      this.#mode === 'village' &&
      this.#worldMode === 'exploration' &&
      !this.#arrival &&
      !this.#flyover &&
      !this.#transition.active
        ? this.#villageSolarPreview
        : null;
    const phase = preview ?? this.#cosmologyPhase ?? cyclePhase(serverMs, combinedPeriod(this.#cosmologyPeriod));
    if (this.#mode === 'world')
      this.#torusOverview?.updateCosmology(
        phase,
        (serverMs - COSMOLOGY.epochMs) / this.#cosmologyPeriod,
        now,
        this.#cosmologyDebug,
      );
    if (now < this.#cosmologyNextAt) return;
    this.#cosmologyNextAt = now + 200;
    this.#villageNight =
      illumination(
        (this.#villageAnchor.cellX / this.#space.width) * TAU,
        (this.#villageAnchor.cellY / this.#space.height) * TAU + Math.PI,
        phase,
      ).direct <= 0;
    const started = performance.now();
    if (this.#mode !== 'world') this.#regionalOverview.updateLighting(phase, now);
    const target =
      this.#mode === 'world'
        ? (this.#worldTarget ?? this.#villageAnchor)
        : this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
    const u = (target.cellX / this.#space.width) * TAU,
      v = (target.cellY / this.#space.height) * TAU + Math.PI;
    const light = illumination(u, v, phase);
    this.#solarLight.direction.copyFromFloats(
      -light.localDirection[0],
      -light.localDirection[1],
      -light.localDirection[2],
    );
    const weather = weatherAt(
      target.cellX / this.#space.width,
      target.cellY / this.#space.height,
      serverMs,
      this.#weather?.seed ?? 0,
    );
    this.#rainIntensity = weather.rain;
    if (import.meta.env.DEV) this.#canvas.dataset.weather = JSON.stringify(weather);
    // A hidden sun counts as set; the solar preview answers its slider at once.
    const incidence = light.occluded ? -0.3 : light.incidence;
    this.#skyIncidence =
      this.#skyIncidence === null || preview !== null
        ? incidence
        : easeIncidence(this.#skyIncidence, incidence, now - this.#skyAt);
    this.#skyAt = now;
    const sky = skyLight(this.#skyIncidence, weather.cloud);
    if (import.meta.env.DEV)
      this.#canvas.dataset.sky = JSON.stringify({
        incidence: +light.incidence.toFixed(3),
        occluded: light.occluded,
        followed: +this.#skyIncidence.toFixed(3),
      });
    this.#baseSolar = sky.sun;
    this.#solarLight.intensity = this.#baseSolar * this.#presentationLight;
    this.#solarLight.diffuse.copyFromFloats(...sky.sunColor);
    this.#baseAmbient = sky.ambient;
    this.#ambientLight.diffuse.copyFromFloats(...sky.ambientColor);
    this.#ambientLight.groundColor.copyFromFloats(...sky.groundColor);
    this.#scene.clearColor = new Color4(...sky.sky, 1);
    this.#scene.fogColor.copyFromFloats(...sky.sky);
    const phases = cyclePhases(phase);
    this.#cosmologyMetrics = {
      phase,
      torusPhase: phases.torus,
      sunPhase: phases.sun,
      rotationPeriodMs: this.#cosmologyPeriod,
      u,
      v,
      direct: light.direct,
      occluded: light.occluded,
      paused: this.#cosmologyPhase !== null,
      updateMs: performance.now() - started,
      ...(this.#torusOverview?.metrics() ?? { worldRenderMs: 0, worldMeshes: 0, shadowBytes: 0 }),
    };
    if (import.meta.env.DEV) this.#canvas.dataset.cosmology = JSON.stringify(this.#cosmologyMetrics);
  }
  public skipArrival(finish = false): void {
    if (finish && this.#arrival) {
      this.#applyLanding(VILLAGE_LANDING);
      this.#aimTownHall(1);
    }
    if (this.#flyover?.landing && this.#arrival) this.#endFlyover();
    this.#arrivalPending = false;
    this.#arrival = null;
    this.#presentationLight = 1;
    this.onArrival(null);
  }
  #applyLanding(pose: LandingPose): void {
    this.#camera.radius = pose.radius;
    this.#camera.beta = pose.beta;
    this.#camera.fov = pose.fov;
    this.#camera.upperBetaLimit = Math.max(1.05, pose.beta);
    this.#camera.inertialRadiusOffset = this.#camera.inertialAlphaOffset = this.#camera.inertialBetaOffset = 0;
    this.#lastCameraRadius = pose.radius;
  }
  public zoomDuringArrival(deltaY: number): void {
    this.skipArrival();
    this.#camera.radius = Math.max(8, Math.min(680, this.#camera.radius * Math.exp(Math.sign(deltaY) * 0.2)));
  }
  #updateArrival(now: number): void {
    if (this.#arrivalPending && !this.#transition.active && this.#state && this.#space) {
      this.#arrivalPending = false;
      const target = this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
      if (
        Math.hypot(
          delta(target.cellX, this.#villageAnchor.cellX, this.#space.width),
          delta(target.cellY, this.#villageAnchor.cellY, this.#space.height),
        ) <= 24
      ) {
        const u = (this.#villageAnchor.cellX / this.#space.width) * TAU,
          v = (this.#villageAnchor.cellY / this.#space.height) * TAU + Math.PI;
        if (!this.#clock || this.#clock.u !== u || this.#clock.v !== v) this.#clock = new SolarClock(u, v);
        this.#arrival = {
          started: now,
          name: this.#state.village.name,
          fromTarget: target,
          from: { radius: this.#camera.radius, beta: this.#camera.beta, fov: this.#camera.fov },
          time: this.#clock.label(
            Date.now() + this.#cosmologyServerOffsetMs,
            this.#cosmologyPhase ??
              cyclePhase(Date.now() + this.#cosmologyServerOffsetMs, combinedPeriod(this.#cosmologyPeriod)),
          ),
        };
      }
    }
    if (!this.#arrival) return;
    const elapsed = now - this.#arrival.started,
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = arrivalFrame(elapsed, reduced);
    this.#applyLanding(landingPose(this.#arrival.from, elapsed, reduced));
    this.#aimTownHall(reduced ? 1 : Math.min(1, elapsed / 5200));
    this.#presentationLight = frame.light;
    if (frame.done) {
      this.skipArrival();
      return;
    }
    if (now >= this.#arrivalNextAt) {
      this.#arrivalNextAt = now + 32;
      this.onArrival({
        name: this.#arrival.name,
        time: this.#arrival.time,
        veil: frame.veil,
        black: frame.black,
        title: frame.title,
      });
    }
  }
  public retryTerrain(): void {
    this.#overviewRetryAt = 0;
    this.#store?.revalidate();
  }
  #aimTownHall(progress: number): void {
    if (!this.#space || !this.#state || !this.#arrival) return;
    const hall = townHallFocus(this.#state),
      to = this.#space.project(hall);
    const from = this.#space.projectFrom(this.#arrival.fromTarget, hall),
      t = progress * progress * (3 - 2 * progress);
    const height = this.#store?.ground(hall.cellX, hall.cellY)?.height ?? 0;
    this.#camera.target.set(
      from.x + (to.x - from.x) * t,
      0.45 + (height + 0.65 - 0.45) * t,
      from.z + (to.z - from.z) * t,
    );
  }
  public startFlyover(): void {
    this.#inhabitantCamera.stop();
    this.selectRepresentative(null);
    if (this.#flyover || !this.#state || this.#transition.active) return;
    this.skipArrival();
    if (!this.#globalModelAvailable()) {
      this.showRegion();
      this.#flyover = { requested: performance.now(), started: performance.now(), landing: false, local: true };
      this.#camera.detachControl();
      return;
    }
    this.#flyover = { requested: performance.now(), started: null, landing: false };
    this.#camera.detachControl();
    this.#torusOverview?.camera.detachControl();
    if (this.#mode !== 'world') this.showWorld();
  }
  #endFlyover(): void {
    this.#flyover = null;
    this.#torusOverview?.finishFlyover();
    this.#requestedWorld = false;
    delete this.#canvas.dataset.flyover;
    if (!this.#transition.active)
      (this.#mode === 'world' ? this.#torusOverview?.camera : this.#camera)?.attachControl(this.#canvas, true);
  }
  #updateFlyover(now: number): void {
    const shot = this.#flyover;
    if (!shot || !this.#state) return;
    if (shot.local && !shot.landing) {
      const regional =
        (this.#state.science?.knowledgeCoefficient ?? 0) >= 0.15 && (this.#state.science?.levels.geography ?? 0) >= 1;
      const duration = regional ? 5000 : 1200,
        progress = Math.min(1, (now - shot.requested) / duration);
      if (regional && this.#space) {
        const focus = this.#space.project(townHallFocus(this.#state)),
          glide = (1 - progress) ** 2;
        this.#camera.target.set(focus.x + glide * 18, 0.45, focus.z - glide * 12);
        this.#camera.radius = 170 + glide * 80;
      }
      if (progress >= 1) {
        shot.landing = true;
        this.showVillage();
      }
      return;
    }
    if (import.meta.env.DEV)
      this.#canvas.dataset.flyover = JSON.stringify({
        stage: shot.landing
          ? 'landing'
          : shot.started === null
            ? 'waiting'
            : now - shot.started < 12000
              ? 'orbit'
              : 'descent',
        elapsed: shot.started === null ? 0 : now - shot.started,
      });
    if (this.#transition.failed || now - shot.requested > 45000) {
      this.#endFlyover();
      return;
    }
    if (shot.landing) {
      if (!this.#transition.active && !this.#arrival && !this.#arrivalPending) this.#endFlyover();
      return;
    }
    if (this.#mode !== 'world' || !this.#torusOverview || this.#transition.active) return;
    shot.started ??= now;
    if (this.#torusOverview.flyover(now - shot.started, townHallFocus(this.#state), this.#returnAlpha)) {
      shot.landing = true;
      this.#torusOverview.finishFlyover();
      this.showVillage();
    }
  }

  #worldTarget: TravelCell | null = null;
  #setMode(mode: TerrainViewMode): void {
    if (this.#mode === mode) return;
    this.#cameraFocus = null;
    this.#pointerDown = null;
    if (mode === 'village' && this.#mode !== 'village') this.#arrivalPending = true;
    else if (mode !== 'village') this.skipArrival();
    this.#mode = mode;
    if (mode === 'world') {
      this.#store?.setPaused(true);
      this.#renderer?.setVisible(false);
      this.#requestedWorld = this.#worldFromWheel = false;
    }
    this.#buildableGrid?.setEnabled(mode === 'village');
    this.#buildableArea?.setEnabled(mode === 'village');
    for (const mesh of this.#previewMeshes) mesh.setEnabled(mode === 'village');
    this.#infrastructureRenderer?.visible(mode !== 'world');
    this.#roadCellsRenderer?.visible(mode !== 'world');
    this.#infrastructurePreview?.visible(mode === 'village');
    this.#roadCellPreview?.visible(mode === 'village');
    if (mode !== 'village') this.#infrastructureGhost?.setEnabled(false);
    this.#regionalVillages.visible(mode !== 'world');
    this.#onCameraMoved();
    this.#onViewChanged(mode);
  }
  #updateViewMode(): void {
    if (!this.#space || this.#flyover || this.#transition.active || this.#arrival || this.#arrivalPending) return;
    const radius = this.#camera.radius;
    const limit = this.#camera.upperRadiusLimit ?? 680;
    const regionStart = Math.min(110, Math.max(20, limit * 0.42));
    const next: TerrainViewMode =
      radius >= limit * 0.85
        ? 'world'
        : radius >= (this.#mode === 'region' ? regionStart * 0.86 : regionStart)
          ? 'region'
          : 'village';
    if (next === 'world') {
      this.#setMode('region');
      this.#worldFromWheel = true;
      this.showWorld();
      return;
    }
    if (this.#worldFromWheel) this.#requestedWorld = this.#worldFromWheel = false;
    this.#setMode(next);
    const fogEnd = Math.hypot(radius, 800) + 40;
    this.#scene.fogStart = Math.max(radius + 40, fogEnd - 140);
    this.#scene.fogEnd = fogEnd;
  }
  #changeProjection(swap: () => void): void {
    if (this.#transition.active) return;
    this.skipArrival();
    this.#pointerDown = null;
    this.#transition.start(performance.now(), swap);
  }
  public showWorld(): void {
    this.#inhabitantCamera.stop();
    this.selectRepresentative(null);
    if (this.#flyover?.landing) return;
    if (this.#transition.active) {
      this.#pendingView = 'world';
      return;
    }
    if (!this.#space || this.#mode === 'world' || performance.now() < this.#projectionRetryAt) return;
    this.#requestedWorld = true;
    if (!this.#torusOverview) return;
    this.#returnRadius = this.#camera.radius;
    this.#returnAlpha = this.#camera.alpha;
    this.#returnBeta = this.#camera.beta;
    this.#worldTarget = this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
    this.#changeProjection(() => {
      this.#returnRadius = this.#camera.radius;
      this.#returnAlpha = this.#camera.alpha;
      this.#returnBeta = this.#camera.beta;
      this.#worldTarget = this.#space!.inverse(this.#camera.target.x, this.#camera.target.z);
      this.#torusOverview!.enter(
        this.#worldTarget!,
        this.#returnAlpha,
        this.#returnRadius,
        this.#returnBeta,
        this.#camera.fov,
      );
      this.#torusOverview!.mark(this.#villageAnchor, this.#worldTarget!);
      if (this.#flyover && this.#state) this.#torusOverview!.flyover(0, townHallFocus(this.#state), this.#returnAlpha);
      if (this.#pendingSolarProfile) {
        this.#torusOverview!.showSolarProfile();
        this.#pendingSolarProfile = false;
      }
      if (this.#pendingCatView) {
        this.#torusOverview!.showCatEyes();
        this.#pendingCatView = false;
      }
      this.#setMode('world');
    });
  }
  #returnToPlane(village: boolean): void {
    this.#torusOverview?.restoreNavigation();
    if (!village && this.#torusOverview) this.#returnAlpha = this.#torusOverview.planarHeading();
    const target = village ? this.#villageAnchor : (this.#torusOverview?.observed() ?? this.#worldTarget);
    this.#worldTarget = target;
    if (target && this.#space) {
      const p = this.#space.project(target);
      this.#camera.target.copyFromFloats(p.x, 0.45, p.z);
    }
    this.#camera.alpha = this.#returnAlpha;
    this.#camera.beta = this.#returnBeta;
    this.#camera.radius = village
      ? 90
      : Math.max(120, Math.min(this.#returnRadius, (this.#camera.upperRadiusLimit ?? 680) * 0.8));
    this.#setMode(village ? 'village' : 'region');
  }
  public showRegion(): void {
    this.#inhabitantCamera.stop();
    this.selectRepresentative(null);
    if (this.#flyover) return;
    if (this.#transition.active) {
      this.#pendingView = 'region';
      return;
    }
    this.#requestedWorld = false;
    this.#worldFromWheel = false;
    if (this.#mode === 'world') this.#changeProjection(() => this.#returnToPlane(false));
    else {
      this.#camera.radius = Math.min(260, (this.#camera.upperRadiusLimit ?? 680) * 0.65);
      this.#setMode('region');
    }
  }
  public showVillage(): void {
    this.#cameraFocus = null;
    this.#inhabitantCamera.stop();
    this.selectRepresentative(null);
    if (this.#flyover && !this.#flyover.landing) return;
    if (this.#transition.active) {
      this.#pendingView = 'village';
      return;
    }
    this.#requestedWorld = false;
    this.#worldFromWheel = false;
    if (this.#mode === 'world') {
      this.#changeProjection(() => this.#returnToPlane(true));
      return;
    }
    if (this.#space) {
      const p = this.#space.project(this.#villageAnchor);
      this.#camera.target.copyFromFloats(p.x, 0.45, p.z);
    }
    this.#camera.radius = this.#mode === 'village' ? VILLAGE_LANDING.radius : Math.max(90, this.#camera.radius);
    this.#setMode('village');
  }
  /** A market transaction credited the village: the light column above the town hall (also the DEV preview). */
  public marketBeacon(deliveries = 1): void {
    const state = this.#state,
      hall = state?.cells.find((c) => c.building?.type === 'town-hall');
    if (!state || !hall) return;
    const foot = townHallFocus(state);
    this.#marketBeaconAnchor = { cellX: foot.cellX, cellY: foot.cellY, height: this.#siteGround(hall) };
    this.#marketBeacon.trigger(performance.now(), deliveries);
  }
  public rotateWorld(horizontal: number, vertical: number): void {
    if (this.#flyover) return;
    if (this.#mode === 'world' && this.#torusOverview) {
      this.#torusOverview.camera.alpha += horizontal * 0.13;
      this.#torusOverview.camera.beta = Math.max(
        0.08,
        Math.min(Math.PI - 0.08, this.#torusOverview.camera.beta + vertical * 0.13),
      );
    }
  }
  public viewCenter(): Cell | null {
    return this.#space?.inverse(this.#camera.target.x, this.#camera.target.z) ?? null;
  }
  public naturalFeatures() {
    return this.#store?.naturalFeatures() ?? this.#state?.region.features ?? [];
  }
  public focusCell(cell: Cell): void {
    const from = this.viewCenter();
    if (!from || this.#mode !== 'village' || this.#arrival || this.#flyover || this.#transition.active) return;
    this.cancelGesture();
    this.#inhabitantCamera.stop();
    this.selectRepresentative(null);
    this.#camera.inertialPanningX = 0;
    this.#camera.inertialPanningY = 0;
    this.#camera.inertialRadiusOffset = 0;
    this.#camera.inertialAlphaOffset = 0;
    this.#camera.inertialBetaOffset = 0;
    this.#cameraFocus = {
      from,
      to: cell,
      at: performance.now(),
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650,
      radius: this.#camera.radius,
      height: this.#camera.target.y,
    };
  }
  #updateCameraFocus(now: number): void {
    const focus = this.#cameraFocus;
    if (!focus || !this.#space) return;
    const progress = focus.duration ? (now - focus.at) / focus.duration : 1;
    const target = cameraFocusAt(focus.from, focus.to, this.#space.width, this.#space.height, progress),
      p = this.#space.project(target);
    const height = Math.max(0.45, (this.#store?.ground(focus.to.cellX, focus.to.cellY)?.height ?? 0) + 0.35);
    this.#camera.target.set(p.x, focus.height + (height - focus.height) * target.eased, p.z);
    this.#camera.radius = focus.radius + (42 - focus.radius) * target.eased;
    if (progress >= 1) this.#cameraFocus = null;
  }
  public selectWorldCenter(): void {
    if (this.#flyover) return;
    if (this.#mode !== 'world' || !this.#torusOverview) return;
    const chosen = this.#torusOverview.select(this.#engine.getRenderWidth() / 2, this.#engine.getRenderHeight() / 2);
    if (chosen) {
      this.#worldTarget = chosen;
      this.#torusOverview.focus(chosen);
      this.#torusOverview.mark(this.#villageAnchor, chosen);
    }
  }
  #loadOverview(now: number): void {
    if (!this.#state || !this.#space || !this.#overviewAbort) return;
    const world = this.#state.world,
      signal = this.#overviewAbort.signal;
    const store = this.#store;
    if (!store) return;
    const center = this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
    const explicitOverview = this.#requestedWorld || this.#mode === 'region';
    const idleVillage =
      this.#mode === 'village' &&
      now - this.#lastViewChangeAt >= 3_000 &&
      store.pending === 0 &&
      this.#renderer?.queued === 0;
    if (
      !this.#overview &&
      !this.#overviewLoading &&
      now >= this.#overviewRetryAt &&
      store.pending < 2 &&
      (explicitOverview || (idleVillage && this.#renderer?.rendered(center.cellX, center.cellY)))
    ) {
      this.#overviewLoading = true;
      void this.transport
        .getTerrainOverview(world.slug, signal)
        .then((data) => {
          if (signal.aborted || data.world.id !== world.id || data.world.generationVersion !== world.generationVersion)
            return;
          const view =
            this.#torusOverview ??
            new TorusOverview(
              this.#engine,
              data,
              this.#villageAnchor,
              this.#space!.inverse(this.#camera.target.x, this.#camera.target.z),
              () => this.#weather,
            );
          view.setGeography(data);
          view.setGlobalModel(this.#globalModelAvailable());
          this.#overview = data;
          this.#regionalOverview.set(data);
          this.#torusOverview = view;
          this.#regionalVillages.invalidateGround();
          if (this.#requestedWorld) this.showWorld();
        })
        .catch(() => {
          this.#overviewRetryAt = performance.now() + 5_000;
        })
        .finally(() => {
          if (!signal.aborted) this.#overviewLoading = false;
        });
    }
    const villageCenter = `${Math.floor(center.cellX / 128)},${Math.floor(center.cellY / 128)}`;
    if (
      this.#overview &&
      !this.#villagesLoading &&
      !this.#vegetationLoading &&
      (now >= this.#villagesDue || villageCenter !== this.#villagesCenter) &&
      store.pending < 2 &&
      (explicitOverview || idleVillage)
    ) {
      this.#villagesLoading = true;
      this.#villagesCenter = villageCenter;
      void this.transport
        .getTerrainVillages(world.slug, center.cellX, center.cellY, signal)
        .then((data) => {
          if (signal.aborted || data.world.id !== world.id || data.world.generationVersion !== world.generationVersion)
            return;
          this.#regionalVillages.set(data);
          this.#villagesDue = performance.now() + 30_000;
        })
        .catch(() => {
          this.#villagesDue = performance.now() + 5_000;
        })
        .finally(() => {
          if (!signal.aborted) this.#villagesLoading = false;
        });
    }
    if (
      this.#overview &&
      !this.#villagesLoading &&
      !this.#vegetationLoading &&
      now >= this.#vegetationDue &&
      store.pending < 2 &&
      (explicitOverview || idleVillage || this.#mode === 'world')
    ) {
      this.#vegetationLoading = true;
      void this.transport
        .getTerrainVegetationOverview(world.slug, signal)
        .then((data) => {
          if (signal.aborted || data.world.id !== world.id || data.world.generationVersion !== world.generationVersion)
            return;
          this.#regionalOverview.set(this.#overview!, data);
          this.#torusOverview?.setVegetation(data);
          this.#vegetationDue = performance.now() + Math.max(1_000, data.maxAgeMs - data.ageMs);
        })
        .catch(() => {
          this.#vegetationDue = performance.now() + 5_000;
        })
        .finally(() => {
          if (!signal.aborted) this.#vegetationLoading = false;
        });
    }
  }

  #streamTerrain(now: number, frame?: FrameTimings): void {
    if (!this.#space || !this.#store || !this.#renderer || !this.#state) return;
    const started = performance.now();
    const detailPaused =
      (this.#mode !== 'village' || this.#arrival !== null) && (this.#camera.radius >= 160 || this.#requestedWorld);
    if (this.#store.paused && !detailPaused) {
      this.#viewSignature = '';
      this.#demandAt = 0;
    }
    this.#store.setPaused(detailPaused);
    this.#renderer.setVisible(!detailPaused || !this.#overview);
    if (!detailPaused && now >= this.#demandAt) {
      const signature = [
        this.#space.version,
        this.#camera.alpha,
        this.#camera.beta,
        this.#camera.radius,
        this.#camera.target.x,
        this.#camera.target.z,
        this.#engine.getRenderWidth(),
        this.#engine.getRenderHeight(),
      ].join(':');
      const moved = signature !== this.#viewSignature;
      if (moved) {
        this.#viewSignature = signature;
        this.#lastViewChangeAt = now;
        const target = this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
        const planes = Frustum.GetPlanes(
          this.#camera.getViewMatrix(true).multiply(this.#camera.getProjectionMatrix(true)),
        );
        const size = this.#store.world.chunkSize;
        const intersects = (x: number, y: number, span: number) => {
          const anchor = { cellX: Math.floor(x / size) * size, cellY: Math.floor(y / size) * size };
          const p = this.#space!.projectFrom({ cellX: x, cellY: y }, anchor),
            margin = RENDER_UNIT_CELLS * TILE_SIZE;
          return new BoundingBox(
            new Vector3(p.x - TILE_SIZE / 2 - margin, -1, p.z - TILE_SIZE / 2 - margin),
            new Vector3(p.x + (span - 0.5) * TILE_SIZE + margin, 8, p.z + (span - 0.5) * TILE_SIZE + margin),
          ).isInFrustum(planes);
        };
        const demand = terrainDemand(target, this.#space.width, this.#space.height, size, (x, y) =>
          intersects(x * size, y * size, size),
        );
        this.#terrainDemand = demand;
        this.#terrainIntersects = intersects;
        this.#store.demandChunks(demand, !this.#initialLoad.ready);
      }
      if (moved || this.#terrainDemand.some((d) => d.visible && this.#store!.changed.has(d.key)))
        this.#renderer.demand(this.#terrainDemand, this.#terrainIntersects);
      this.#demandAt = now + TERRAIN_STREAMING.coalesceMs;
    }
    if (document.visibilityState === 'visible')
      this.#store.tick(
        this.#overviewLoading ||
          this.#vegetationLoading ||
          this.#villagesLoading ||
          (this.#requestedWorld && !this.#overview)
          ? 1
          : TERRAIN_STREAMING.concurrentBatches,
        !this.#initialLoad.ready,
      );
    frame?.mark('demand');
    if (!detailPaused) this.#renderer.tick(this.#initialLoad.ready ? TERRAIN_STREAMING.admissionMs : 8);
    frame?.mark('integration');
    const loading: TerrainStatus =
      this.#requestedWorld && !this.#torusOverview
        ? this.#overviewRetryAt > now
          ? 'retry'
          : 'loading'
        : detailPaused
          ? !this.#overview
            ? this.#overviewRetryAt > now
              ? 'retry'
              : 'loading'
            : null
          : this.#store.degraded
            ? 'retry'
            : this.#renderer.missingVisible
              ? 'loading'
              : null;
    if (loading !== this.#terrainLoading) {
      this.#terrainLoading = loading;
      this.#onTerrainLoading(loading);
    }
    if (
      this.#projectionVersion !== this.#renderer.version ||
      this.#projectionGroundRevision !== this.#store.groundRevision
    ) {
      if (!this.#initialLoad.ready) {
        this.#initialRoutesReady = false;
        return;
      }
      this.#projectionVersion = this.#renderer.version;
      this.#projectionGroundRevision = this.#store.groundRevision;
      // Buildings and workers follow the published ground and the coordinate
      // origin, not which terrain units are visible: reprojecting them on every
      // visibility change cost ~340 ms per rotation step on alpha Catmark.
      const groundKey = this.#groundKey();
      if (groundKey !== this.#projectionGroundKey) {
        this.#projectionGroundKey = groundKey;
        this.#refreshBuildingGround();
        this.#workers.reproject();
      }
      // Streaming and origin changes can arrive after the pointer stopped moving.
      if (this.#ghostRequest) this.updateConstructionGhost(...this.#ghostRequest);
      if (this.#areaRequest) {
        this.#lastPreviewSignature = '';
        this.updateAreaSelection(...this.#areaRequest);
      }
      frame?.mark('projection');
      this.#updateTravelPaths(this.#state, this.#showTravel, this.#selectedRoute, frame);
      frame?.mark('roadsDebug');
    }
    frame?.mark('projection');
    this.#streamMs.push(performance.now() - started);
    if (this.#streamMs.length > 3600) this.#streamMs.shift();
    if (now < this.#metricsAt) return;
    this.#metricsAt = now + 1000;
    if (import.meta.env.MODE === 'e2e')
      this.#canvas.dataset.terrainPresentation = JSON.stringify({
        buildings: this.#state.cells
          .filter((c) => c.building)
          .map((c) => {
            const root = this.#buildingCache.get(c.building!.id)?.mesh;
            return {
              id: c.building!.id,
              type: c.building!.type,
              base: this.#siteGround(c),
              y: root?.position.y,
              offset: root?.metadata?.groundOffset,
              mesh: root?.uniqueId,
            };
          }),
        roads: this.#scene.meshes
          .filter((m) => m.name.startsWith('village-road-'))
          .map((m) => ({ name: m.name, vertices: m.getTotalVertices() })),
        grass: this.#renderer
          .meshes()
          .filter((m) => m.name === 'rc1-ground-unit')
          .some((m) => m.material?.name === 'streamed-ground' && Boolean(m.getVerticesData('uv'))),
        anonymousMasses: Boolean(this.#scene.getMeshByName('regional-forest-rock-masses')),
      });

    if (navigator.webdriver) {
      const viewport = this.#camera.viewport.toGlobal(this.#engine.getRenderWidth(), this.#engine.getRenderHeight());
      this.#canvas.dataset.woodlandScreens = JSON.stringify(
        this.#renderer.meshes().flatMap((mesh) => {
          const meta = mesh.metadata as { woodlandId?: string; cellX: number; cellY: number } | null;
          if (!meta?.woodlandId || !this.#renderer!.rendered(meta.cellX, meta.cellY)) return [];
          const ground = this.#store!.ground(meta.cellX, meta.cellY);
          if (!ground) return [];
          const world = this.#space!.project(meta);
          const point = Vector3.Project(
            new Vector3(world.x, ground.height + 1.5, world.z),
            Matrix.Identity(),
            this.#scene.getTransformMatrix(),
            viewport,
          );
          return [
            {
              id: meta.woodlandId,
              x: point.x / this.#engine.getRenderWidth(),
              y: point.y / this.#engine.getRenderHeight(),
            },
          ];
        }),
      );
    }
    this.#canvas.dataset.terrainStreaming = JSON.stringify({
      origin: this.#space.origin,
      version: this.#space.version,
      resident: this.#renderer.residents.size,
      graphicPeak: this.#renderer.peakGraphicChunks,
      cached: this.#store.entries.size,
      queued: this.#renderer.queued,
      network: this.#store.pending,
      focusGround: this.#renderer.rendered(
        this.#space.inverse(this.#camera.target.x, this.#camera.target.z).cellX,
        this.#space.inverse(this.#camera.target.x, this.#camera.target.z).cellY,
      ),
      loaded: [...this.#renderer.residents.keys()],
      integrationP95: percentile(this.#renderer.integrationMs),
      integrationMax: Math.max(0, ...this.#renderer.integrationMs),
      integrationActiveP95: percentile(this.#renderer.activeIntegrationMs),
      slowestUnit: this.#renderer.slowestUnit,
      streamP95: percentile(this.#streamMs),
      streamMax: Math.max(0, ...this.#streamMs),
      meshes: this.#scene.meshes.length,
      geometries: this.#scene.geometries.length,
      materials: this.#scene.materials.length,
      drawCalls: this.#sceneStats?.drawCallsCounter.current ?? null,
      activeMeshesMs: this.#sceneStats?.activeMeshesEvaluationTimeCounter.current ?? null,
      nativeRenderMs: this.#sceneStats?.renderTimeCounter.current ?? null,
      mode: this.#mode,
      overview: Boolean(this.#overview),
      fogStart: this.#scene.fogStart,
      fogEnd: this.#scene.fogEnd,
      detailPaused,
      worldRequested: this.#requestedWorld,
      reducedQuality: this.#reducedQuality,
      frameP95: percentile(this.#frameMs),
    });
  }

  #updateCameraProfile(): void {
    const minimum = this.#camera.lowerRadiusLimit ?? 8;
    const maximum = this.#camera.upperRadiusLimit ?? 680;
    const closeZoom = Math.max(0, Math.min(1, (42 - this.#camera.radius) / (42 - minimum)));
    this.#camera.upperBetaLimit = 0.95 + 0.4 * closeZoom;
    const profileAt = (radius: number): { beta: number; fov: number } => {
      const ratio = Math.max(0, Math.min(1, (radius - minimum) / (maximum - minimum)));
      const eased = ratio * ratio * (3 - 2 * ratio);
      return {
        beta: 0.88 + (0.18 - 0.88) * eased,
        fov: 0.5 + (0.9 - 0.5) * eased,
      };
    };
    const current = profileAt(this.#camera.radius);

    // Near the village, compressed perspective keeps buildings readable. Far
    // away, zoom assists the angle towards a map view. Only the profile delta
    // is applied, preserving any angle deliberately chosen by the player.
    if (this.#lastCameraRadius !== null && this.#lastCameraRadius !== this.#camera.radius) {
      const previous = profileAt(this.#lastCameraRadius);
      const lowerBeta = this.#camera.lowerBetaLimit ?? 0.05;
      const upperBeta = this.#camera.upperBetaLimit ?? 0.95;
      this.#camera.beta = Math.max(lowerBeta, Math.min(upperBeta, this.#camera.beta + current.beta - previous.beta));
    }
    this.#camera.fov = current.fov;
    this.#lastCameraRadius = this.#camera.radius;
  }

  public dispose(): void {
    this.#terraformRenderer?.dispose();
    cancelAnimationFrame(this.#demolitionRoadFrame);
    this.#demolitionTint?.dispose();
    cancelAnimationFrame(this.#infrastructureHoverFrame);
    this.#infrastructureHoverFrame = 0;
    this.#infrastructureHoverEvent = null;
    this.#infrastructureRenderer?.dispose();
    this.#roadCellsRenderer?.dispose();
    this.#infrastructurePreview?.dispose();
    this.#roadCellPreview?.dispose();
    this.#infrastructureGhost?.dispose(false, false);
    for (const job of this.#buildingJobs) job.steps.return(job.parent);
    this.#buildingJobs.length = 0;
    window.removeEventListener('keydown', this.#flyoverKey, true);
    this.#villageBraziers?.dispose();
    this.#villageRoads?.dispose();
    this.#rain.dispose();
    this.#weather?.dispose();
    this.#overviewAbort?.abort();
    this.#torusOverview?.dispose();
    this.#regionalOverview.dispose();
    this.#regionalVillages.dispose();
    this.#clouds.dispose();
    this.#renderDiagnostics?.dispose();
    this.#canvas.removeEventListener('terrain-camera', this.#testCamera);
    this.#canvas.removeEventListener('terrain-metrics-reset', this.#testMetricsReset);
    window.removeEventListener('online', this.#resumeTerrain);
    window.removeEventListener('blur', this.#handlePointerCancel);
    document.removeEventListener('visibilitychange', this.#resumeTerrain);
    window.removeEventListener('keydown', this.#navigationKeyDown, true);
    window.removeEventListener('keyup', this.#navigationKeyUp, true);
    this.#renderer?.dispose();
    this.#store?.dispose();
    this.#canvas.removeEventListener('pointerdown', this.#handlePointerDown, { capture: true });
    this.#canvas.removeEventListener('pointermove', this.#handlePointerMove, { capture: true });
    this.#canvas.removeEventListener('pointerup', this.#handlePointerUp, { capture: true });
    this.#canvas.removeEventListener('pointercancel', this.#handlePointerCancel, { capture: true });
    this.#canvas.removeEventListener('lostpointercapture', this.#handlePointerCancel);
    this.#canvas.removeEventListener('wheel', this.#handleWheel, { capture: true });
    this.#resizeObserver.disconnect();
    this.#inhabitantCamera.dispose();
    this.#workers.dispose();
    this.#resourceHalos.dispose();
    this.#treeHalos.dispose();
    this.#marketBeacon.dispose();
    this.#scene.dispose();
    this.#engine.dispose();
    this.#canvas.width = 0;
    this.#canvas.height = 0;
  }
}
import type { TerrainResponse } from '@arbestra/contracts';
import { devToolsEnabled } from '../dev/dev-tools';
import { RenderLab } from './render-lab';
import { selectEnabledCandidates } from './enabled-candidates';
