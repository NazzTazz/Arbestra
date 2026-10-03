import { VillageWorkers } from './village-workers';
import { TimberThatch } from './timber-thatch';
import {barracksPreviewPlacement,buildBarracks} from './barracks-factory';
import { buildUniversity } from './university-factory';
import { sciencePreview } from '../api/client';
import { roadDisplayRoutes, roadInnerCorners, roadEdges, ROAD_HALF_WIDTH } from './road-profile';
import { WeatherMap, WeatherMaterial } from './weather-view';
import { LocalRain } from './weather-rain';
import { weatherAt } from './weather';
import { SolarClock } from './solar-clock';
import { arrivalFrame, landingPose, townHallFocus, VILLAGE_LANDING, type LandingPose, type VillageArrival } from './village-arrival';
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
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
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

import type { NaturalFeature, StoneDeposit, TerrainChunk, TerrainOverview, TravelCell, VillageCell, VillageState } from '@arbestra/contracts';

import type { ScreenAnchor } from '../ui/WorldContextMenu';
import { getTerrain, getTerrainUpdates, getTerrainOverview, getTerrainVegetationOverview, getTerrainVillages } from '../api/client';
import { WorldSpace, terrainDemand, delta } from './world-space';
import { TerrainStore } from './terrain-store';
import { TerrainRenderer } from './terrain-renderer';
import { CloudTransition } from './cloud-transition';
import { LodTransition } from './lod-transition';
import { RegionalVillages } from './regional-villages';
import { RegionalOverview, TorusOverview } from './terrain-overview-view';
import { RENDER_UNIT_CELLS } from './terrain-unit';
import { TERRAIN_STREAMING } from './terrain-settings';
import { bakeScenery, cloneWoodland, type SceneryPart } from './scenery-batch';
import { VillageRoads } from './village-roads';
import { VillageBraziers } from './village-braziers';
import { cellKey, cellsAlongSegment, type AreaPreview, type Cell } from './construction-selection';
import { gardenTileStage } from './tile-appearance';

const TOWN_HALL_DOOR_Z = -1.1;
import { entranceConnector, planForSite, resolveMurets, transformPoint, type BuildingPlan } from './building-plan';
const TILE_SIZE = 2.5;

export type TerrainStatus = 'loading' | 'retry' | null;
export type TerrainViewMode = 'village' | 'region' | 'world';

function percentile(values: number[]): number {
  if (!values.length) return 0;
  return [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * 0.95)]!;
}

export class BabylonVillageScene {
  readonly #engine: Engine;
  readonly #scene: Scene;
  readonly #sceneStats: SceneInstrumentation | null;
  readonly #camera: ArcRotateCamera;
  readonly #canvas: HTMLCanvasElement;
  readonly #villageMeshes: Mesh[] = [];
  readonly #sceneryGeometry = new Map<string, Mesh>();
  readonly #sceneryData = new Map<string, VertexData>();
  readonly #waterRippleTexture: DynamicTexture;
  readonly #waterRippleMaterial: StandardMaterial;
  readonly #workers: VillageWorkers;
  #workerDebugAt=0;
  #selectedFeatureId: string | null = null;
  readonly #onFeatureSelected: (featureId: string, anchor: ScreenAnchor) => void;
  readonly #selectableMeshes = new Map<string, Mesh>();
  readonly #onSiteSelected: (siteId: string, anchor: ScreenAnchor) => void;
  readonly #onCameraMoved: () => void;
  readonly #onTerrainLoading: (loading: TerrainStatus) => void;
  #terrainLoading: TerrainStatus = null;
  readonly #onAreaGesture: (first: Cell, last: Cell, tap: boolean) => void;
  readonly #onGardenHarvest: (cell: Cell | null, newGesture: boolean) => void;
  readonly #previewMeshes: Mesh[] = [];
  readonly #pendingHarvestMeshes: Mesh[] = [];
  readonly #pendingHarvestMaterial: StandardMaterial;
  readonly #invalidAreaMaterial: StandardMaterial;
  readonly #resizeObserver: ResizeObserver;
  readonly #siteMaterial: StandardMaterial;
  readonly #candidateMaterial: StandardMaterial;
  readonly #timberMaterial: StandardMaterial;
  readonly #lightTimberMaterial: StandardMaterial;
  readonly #darkTimberMaterial: StandardMaterial;
  readonly #roofMaterial: StandardMaterial;
  #timberThatch: TimberThatch | null = null;
  #buildingCache = new Map<string,{signature:string;mesh:Mesh}>();
  #factoryGenerationCount=0;
  readonly #stoneMaterial: StandardMaterial;
  readonly #pebbleMaterial: StandardMaterial;
  readonly #windowMaterial: StandardMaterial;
  readonly #soilMaterial: StandardMaterial;
  readonly #gardenTileMaterials: StandardMaterial[];
  #weather: WeatherMap | null = null;
  readonly #rain: LocalRain;
  #rainIntensity = 0;
  readonly #leafMaterial: StandardMaterial;
  readonly #leafLightMaterial: StandardMaterial;
  readonly #leafDarkMaterial: StandardMaterial;
  readonly #trunkMaterial: StandardMaterial;
  readonly #woodlandMaterial: MultiMaterial;
  readonly #constructionMaterial: StandardMaterial;
  readonly #scaffoldMaterial: StandardMaterial;
  readonly #selectionMaterial: StandardMaterial;
  readonly #contactShadowMaterial: StandardMaterial;
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
  #globalModelAvailable(): boolean { return sciencePreview() || this.#state?.science?.globalModelAvailable === true; }
  readonly #flyoverKey = (event: KeyboardEvent): void => {
    if(event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if(event.code==='KeyV' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault(); event.stopPropagation(); this.startFlyover();
    } else if(event.code==='KeyC' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (!this.#globalModelAvailable()) return;
      event.preventDefault(); event.stopPropagation();
      this.#endFlyover(); this.skipArrival(true);
      this.#pendingCatView = true; this.showWorld();
      if(this.#mode==='world' && !this.#transition.active && this.#torusOverview) {
        this.#torusOverview.showCatEyes(); this.#pendingCatView = false;
      }
    } else if(event.key==='Escape' && this.#flyover) {
      event.preventDefault(); event.stopPropagation(); this.#endFlyover(); this.skipArrival(true);
    }
  };
  #arrivalPending = false;
  #presentationLight = 1;
  #baseSolar = 0;
  #baseAmbient = .34;
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
  #cosmologyPeriod: number = COSMOLOGY.periodMs;
  #pendingSolarProfile = false;
  #pendingCatView = false;
  #cosmologyNextAt = 0;
  #cosmologyServerOffsetMs = 0;
  #cosmologyMetrics = { phase: 0, torusPhase: 0, sunPhase: 0, rotationPeriodMs: COSMOLOGY.periodMs as number,
    u: 0, v: 0, direct: 1, occluded: false, paused: false, updateMs: 0,
    worldRenderMs: 0, worldMeshes: 0, shadowBytes: 0 };
  #lastViewChangeAt = 0;
  #mode: TerrainViewMode = 'village';
  readonly #onViewChanged: (mode: TerrainViewMode) => void;
  readonly #reducedQuality = navigator.webdriver && (import.meta.env.PROD || !new URLSearchParams(location.search).has('terrainPerf'));
  #buildableGrid: Mesh | null = null;
  #buildableArea: Mesh | null = null;
  #travelLines: Mesh | null = null;
  #travelSurface: Mesh | null = null;
  #villageRoads: VillageRoads | null = null;
  #villageBraziers: VillageBraziers | null = null;
  #villageNight = false;
  #lastTravelSignature = '';
  #selectedSiteId: string | null = null;
  #highlightedSiteIds = new Set<string>();
  #constructionMode = false;
  #selectingArea = false;
  #harvestableSites = new Set<string>();
  #fullGardenSites = new Set<string>();
  #gardenStages = new Map<string, number>();
  #harvestVisited = new Set<string>();
  #villageAnchor: Cell = { cellX: 0, cellY: 0 };
  #space: WorldSpace | null = null;
  #store: TerrainStore | null = null;
  #renderer: TerrainRenderer | null = null;
  #state: VillageState | null = null;
  #showTravel = false;
  #selectedRoute: string | null = null;
  #projectionVersion = -1;
  #demandAt = 0;
  #metricsAt = 0;
  #frameMs: number[] = [];
  #streamMs: number[] = [];
  #viewSignature = '';
  #terrainDemand: ReturnType<typeof terrainDemand> = [];
  #terrainIntersects: ((x: number, y: number, size: number) => boolean) | undefined;
  readonly #resumeTerrain = (): void => { this.#eyesSince = null; if (!document.hidden) this.#store?.revalidate(); };

  #pointerDown: { x: number; y: number; pointerId: number; mouseArea: boolean; harvest: boolean; first: Cell | null; lastPoint: Cell | null } | null = null;
  #lastDragCell = '';
  #lastPreviewSignature = '';
  #lastVisualSignature = '';
  #serverOffsetMs = 0;
  #lastFrameAt = 0;
  #lastCameraRadius: number | null = null;
  #initialCameraFramed = false;
  #e2eCells: Array<{ id: string; x: number; z: number }> = [];
  #e2eFeatures: Array<{ id: string; x: number; z: number }> = [];
  #worldWidthUnits = 2048 * TILE_SIZE;
  #worldHeightUnits = 1024 * TILE_SIZE;

  readonly #handlePointerDown = (event: PointerEvent): void => {
    if (this.#transition.active || this.#arrival || this.#flyover) return;
    if (!event.isPrimary) { this.#pointerDown = null; return; }
    if (event.button !== 0) return;
    if (this.#mode === 'world') {
      this.#pointerDown = { x: event.clientX, y: event.clientY, pointerId: event.pointerId,
        mouseArea: false, harvest: false, first: null, lastPoint: null };
      return;
    }
    if (this.#mode === 'region') return;
    const mouseArea = this.#selectingArea && event.pointerType !== 'touch';
    const first = this.#cellAtPointer(event);
    const harvest = !this.#constructionMode && first !== null && this.#harvestableSites.has(cellKey(first));
    this.#pointerDown = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, mouseArea, harvest, first, lastPoint: this.#gridPointAtPointer(event) };
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
        if (harvest) { this.#harvestVisited = new Set([cellKey(first)]); this.#onGardenHarvest(first, true); }
        else this.#onAreaGesture(first, first, false);
      }
    }
  };

  readonly #handlePointerMove = (event: PointerEvent): void => {
    if (this.#pointerDown?.harvest && this.#pointerDown.pointerId === event.pointerId) {
      event.stopImmediatePropagation(); event.preventDefault();
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
    if (!this.#pointerDown || Math.hypot(event.clientX - this.#pointerDown.x, event.clientY - this.#pointerDown.y) < 8) return;
    this.#pointerDown = null;
    this.#clearSelection();
  };

  readonly #handlePointerUp = (event: PointerEvent): void => {
    if (this.#transition.active) return;
    if (!this.#pointerDown || this.#pointerDown.pointerId !== event.pointerId) return;
    if (this.#mode === 'world') {
      const gesture = this.#pointerDown; this.#pointerDown = null;
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 8 && this.#torusOverview) {
        const bounds = this.#canvas.getBoundingClientRect();
        const chosen = this.#torusOverview.select(event.clientX - bounds.left, event.clientY - bounds.top);
        if (import.meta.env.DEV) this.#canvas.dataset.worldPick = chosen ? `${chosen.cellX},${chosen.cellY}` : 'none';
        if (chosen) { this.#worldTarget = chosen; this.#torusOverview.focus(chosen); this.#torusOverview.mark(this.#villageAnchor, chosen); }
      }
      return;
    }
    if (this.#mode === 'region') { this.#pointerDown = null; return; }
    const gesture = this.#pointerDown;
    if (gesture.harvest) {
      this.#continueHarvest(event);
      this.#onGardenHarvest(null, false);
      this.#pointerDown = null; event.stopImmediatePropagation(); event.preventDefault();
      if (this.#canvas.hasPointerCapture(event.pointerId)) this.#canvas.releasePointerCapture(event.pointerId);
      return;
    }
    if (gesture.mouseArea) {
      this.#pointerDown = null;
      event.stopImmediatePropagation();
      if (this.#canvas.hasPointerCapture(event.pointerId)) this.#canvas.releasePointerCapture(event.pointerId);
      const last = this.#cellAtPointer(event);
      if (gesture.first && last) this.#onAreaGesture(gesture.first, last, false);
      return;
    }
    const moved = Math.hypot(
      event.clientX - this.#pointerDown.x,
      event.clientY - this.#pointerDown.y,
    );
    this.#pointerDown = null;
    if (moved >= 8) return;

    if (this.#selectingArea) {
      const cell = this.#cellAtPointer(event);
      if (cell) this.#onAreaGesture(cell, cell, true);
      return;
    }

    const bounds = this.#canvas.getBoundingClientRect();
    const picked = this.#scene.pick(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      (mesh) => mesh.isPickable && (typeof mesh.metadata?.siteId === 'string' || typeof mesh.metadata?.featureId === 'string'),
    );
    const pickedMetadata = picked.pickedMesh?.metadata;
    const featureId = (picked.thinInstanceIndex >= 0
      ? pickedMetadata?.instanceFeatureIds?.[picked.thinInstanceIndex]
      : pickedMetadata?.featureId) as string | undefined;
    if (featureId) {
      this.#selectedSiteId = null;
      this.#applySelection();
      this.#selectedFeatureId = featureId;
      this.#applyFeatureSelection();
      this.#onFeatureSelected(featureId, { x: event.clientX, y: event.clientY });
      return;
    }
    const siteId = picked.pickedMesh?.metadata?.siteId as string | undefined;
    if (siteId) this.selectSite(siteId, { x: event.clientX, y: event.clientY });
    else this.#clearSelection();
  };
  readonly #handlePointerCancel = (): void => {
    if(this.#pointerDown?.harvest) this.#onGardenHarvest(null, true);
    this.#pointerDown = null;
  };
  readonly #handleWheel = (event: WheelEvent): void => {
    if(this.#flyover) return;
    if (this.#mode === 'world' && event.deltaY < 0 && this.#torusOverview
      && this.#torusOverview.camera.radius <= (this.#torusOverview.camera.lowerRadiusLimit ?? 5.8) * 1.1) this.showRegion();
    else if (this.#mode !== 'world') this.#clearSelection();
  };

  #continueHarvest(event: PointerEvent): void {
    const last = this.#gridPointAtPointer(event), previous = this.#pointerDown?.lastPoint;
    if (!last || !previous || cellKey(last) === cellKey(previous)) return;
    for (const cell of cellsAlongSegment(previous, last, { widthCells: this.#worldWidthUnits / TILE_SIZE, heightCells: this.#worldHeightUnits / TILE_SIZE })) {
      if (!this.#harvestVisited.has(cellKey(cell))) { this.#harvestVisited.add(cellKey(cell)); this.#onGardenHarvest(cell, false); }
    }
    this.#pointerDown!.lastPoint = last;
  }

  public constructor(
    canvas: HTMLCanvasElement,
    onSiteSelected: (siteId: string, anchor: ScreenAnchor) => void,
    onCameraMoved: () => void,
    onAreaGesture: (first: Cell, last: Cell, tap: boolean) => void,
    onFeatureSelected: (featureId: string, anchor: ScreenAnchor) => void = () => {},
    onGardenHarvest: (cell: Cell | null, newGesture: boolean) => void = () => {},
    onTerrainLoading: (loading: TerrainStatus) => void = () => {},
    onViewChanged: (mode: TerrainViewMode) => void = () => {},
    private readonly onArrival: (arrival: VillageArrival | null) => void = () => {},
    private readonly onEyesFound: () => void = () => {},
  ) {
    this.#canvas = canvas;
    this.#canvas.dataset.workerModel = 'low-poly';
    this.#onFeatureSelected = onFeatureSelected;
    this.#onSiteSelected = onSiteSelected;
    this.#onCameraMoved = onCameraMoved;
    this.#onAreaGesture = onAreaGesture;
    this.#onGardenHarvest = onGardenHarvest;
    this.#onTerrainLoading = onTerrainLoading;
    this.#onViewChanged = onViewChanged;
    this.#engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
    this.#engine.maxFPS = this.#reducedQuality ? 5 : 45;
    this.#engine.setHardwareScalingLevel(Math.max(this.#reducedQuality ? 4 : 1.2, window.devicePixelRatio / 1.5));
    this.#scene = new Scene(this.#engine);
    this.#sceneStats = import.meta.env.DEV || import.meta.env.MODE === 'e2e' ? new SceneInstrumentation(this.#scene) : null;
    if (this.#sceneStats) {
      this.#sceneStats.captureActiveMeshesEvaluationTime = true;
      this.#sceneStats.captureRenderTime = true;
    }
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

    this.#siteMaterial = this.#material('available-site', '#647442', 0.42);
    this.#candidateMaterial = this.#material('extension-candidate', '#9ac866', 0.82, '#1c3510');
    this.#invalidAreaMaterial = this.#material('invalid-area', '#c1614f', 0.72, '#38140f');
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
      new WeatherMaterial(material, 'leaves', () => this.#weather, () => this.#space);
    for (const material of [this.#soilMaterial, ...this.#gardenTileMaterials])
      new WeatherMaterial(material, 'ground', () => this.#weather, () => this.#space);
    new WeatherMaterial(this.#waterRippleMaterial, 'water', () => this.#weather, () => this.#space);
    this.#rain = new LocalRain(this.#scene, (x, z) => {
      const cell = this.#space?.inverse(x, z);
      return cell ? this.#store?.ground(cell.cellX, cell.cellY)?.height ?? null : null;
    });
    this.#trunkMaterial = this.#material('trunk', '#523620');
    let workerObstacles:{state:VillageState;version:number;corners:ReturnType<typeof roadInnerCorners>;
      routes:Array<{destination:TravelCell;points:ReturnType<WorldSpace['path']>}>}|null=null;
    let workerWidths:{state:VillageState;widths:Map<string,number>}|null=null;
    this.#workers = new VillageWorkers(this.#scene, {
      skin: ['#e2ba94','#b98157','#684532'].map((color,i) => this.#material(`worker-skin-${i}`,color)),
      clothes: ['#42604a','#526e86','#b69a4c','#a95f47','#d9cfb4'].map((color,i) => this.#material(`worker-clothes-${i}`,color)),
      hair: ['#2d231e','#745039','#c4a364'].map((color,i) => this.#material(`worker-hair-${i}`,color)),
      pants: this.#material('worker-pants','#4b4033'), timber: this.#trunkMaterial, stone: this.#stoneMaterial,
    }, {
      path: path => this.#workerPath(path), project: cell => this.#space!.project(cell),
      localPath: path=>this.#pathPoints(path),
      leisurePath:(buildingId,path)=>this.#leisurePath(buildingId,path),
      key: point => { const cell=this.#space!.inverse(point.x,point.z); return `${cell.cellX.toFixed(3)}:${cell.cellY.toFixed(3)}`; },
      width: point => {
        if(!this.#state||!this.#space)return .8;
        if(workerWidths?.state!==this.#state){const widths=new Map<string,number>();
          for(const edge of roadEdges(this.#state.travelRoutes))for(const cell of [edge.from,edge.to]){
            const key=cellKey(cell);widths.set(key,Math.max(widths.get(key)??0,edge.kind==='paved'?ROAD_HALF_WIDTH*2:.8));
          }workerWidths={state:this.#state,widths};}
        const cell=this.#space.inverse(point.x,point.z);return workerWidths.widths.get(`${Math.round(cell.cellX)%this.#space.width}:${Math.round(cell.cellY)%this.#space.height}`)??.8;
      },
      ground: point => {
        if (!this.#space || !this.#store || !this.#renderer) return null;
        const cell=this.#space.inverse(point.x,point.z),x=Math.round(cell.cellX)%this.#space.width,y=Math.round(cell.cellY)%this.#space.height;
        return this.#renderer.rendered(x,y) ? this.#store.ground(x,y)?.height ?? null : null;
      },
      free: (point,radius,featureId) => {
        if (!this.#space || !this.#store || !this.#state) return false;
        for (const [dx,dz] of [[0,0],[-radius,-radius],[radius,radius],[-radius,radius],[radius,-radius]]) {
          const cell=this.#space.inverse(point.x+dx!,point.z+dz!),x=Math.round(cell.cellX)%this.#space.width,y=Math.round(cell.cellY)%this.#space.height;
          const ground=this.#store.ground(x,y);
          if (!ground || ground.code!==1) return false;
          if (this.#state.cells.some(c=>c.cellX===x&&c.cellY===y&&Boolean(c.footprint||c.building))) return false;
          if (this.#state.region.features.some(f=>f.cellX===x&&f.cellY===y&&f.id!==featureId&&f.deposit?.blocksCell!==false&&f.deposit?.cleared!==true)) return false;
        }
        const own=this.#state.region.features.find(f=>f.id===featureId);
        if(own){const centre=this.#space.project(own);if(Math.hypot(point.x-centre.x,point.z-centre.z)<.42+radius*.3)return false;}
        if(workerObstacles?.state!==this.#state||workerObstacles.version!==this.#space.version){
          const routes=roadDisplayRoutes(this.#state.travelRoutes,new Set(this.#state.cells.filter(c=>c.footprint||c.building).map(cellKey)));
          workerObstacles={state:this.#state,version:this.#space.version,corners:roadInnerCorners(routes,this.#space.width,this.#space.height),
            routes:routes.map(r=>({destination:r.destination,points:this.#space!.path(r.cells)}))};
        }
        for(const {cell,sx,sz}of workerObstacles.corners){
          const p=this.#space.project(cell);if(Math.hypot(point.x-p.x-sx*.8,point.z-p.z-sz*.8)<radius+.23)return false;
        }
        for(const route of workerObstacles.routes){
          if(own&&route.destination.cellX===own.cellX&&route.destination.cellY===own.cellY)continue;
          const path=route.points;
          for(let i=1;i<path.length;i++){const a=path[i-1]!,b=path[i]!,dx=b.x-a.x,dz=b.z-a.z;
            const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.z-a.z)*dz)/(dx*dx+dz*dz||1)));
            if(Math.hypot(point.x-a.x-dx*t,point.z-a.z-dz*t)<radius+.53)return false;}
        }
        return true;
      },
      detailed: point => Math.hypot(point.x-this.#camera.target.x,point.z-this.#camera.target.z)<35&&this.#camera.radius<95,
    });
    this.#woodlandMaterial = new MultiMaterial('woodland-shared', this.#scene);
    this.#woodlandMaterial.subMaterials = [this.#trunkMaterial, this.#leafMaterial, this.#leafLightMaterial, this.#leafDarkMaterial];
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
    this.#regionalOverview = new RegionalOverview(this.#scene, () => this.#weather, () => this.#space);
    this.#regionalVillages = new RegionalVillages(this.#scene);
    this.#clouds = new CloudTransition(this.#engine);
    for (const material of this.#scene.materials) material.freeze();
    this.#pendingHarvestMaterial = this.#material('harvest-pending', '#f2cf68', 1, '#f2cf68');
    this.#pendingHarvestMaterial.disableLighting = true;

    this.#selectionMarker = MeshBuilder.CreateBox('selection-marker', { width: 2.64, depth: 2.64, height: 0.035 }, this.#scene);
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
    canvas.addEventListener('wheel', this.#handleWheel, { capture: true, passive: true });

    if (import.meta.env.MODE === 'e2e') {
      canvas.addEventListener('terrain-camera', this.#testCamera);
      canvas.addEventListener('terrain-metrics-reset', this.#testMetricsReset);
    }
    window.addEventListener('online', this.#resumeTerrain);
    window.addEventListener('keydown',this.#flyoverKey,true);
    document.addEventListener('visibilitychange', this.#resumeTerrain);
    this.#resizeObserver = new ResizeObserver(() => { this.#engine.resize(); this.#torusOverview?.fit(this.#engine); });
    this.#resizeObserver.observe(canvas);
    this.#engine.runRenderLoop(() => {
      const now = performance.now();
      const wasTransitioning = this.#transition.active;
      const wasLocked = this.#transition.locked;
      this.#transition.update(now, this.#clouds.covered, this.#clouds.ready);
      if (!wasLocked && this.#transition.locked) {
        this.#camera.detachControl(); this.#torusOverview?.camera.detachControl();
      }
      if (wasTransitioning && !this.#transition.active) {
        if(!this.#flyover) (this.#mode === 'world' ? this.#torusOverview?.camera : this.#camera)?.attachControl(this.#canvas, true);
        if (this.#transition.failed) { this.#projectionRetryAt = now + 5000; this.#requestedWorld = false; this.#pendingView = null; this.#pendingCatView = false; }
        const pending = this.#pendingView; this.#pendingView = null;
        if (pending === 'world') this.showWorld(); else if (pending === 'region') this.showRegion(); else if (pending === 'village') this.showVillage();
      }
      if(this.#pendingCatView && this.#mode==='world' && !this.#transition.active && this.#torusOverview) {
        this.#torusOverview.showCatEyes(); this.#pendingCatView = false;
      }
      this.#updateFlyover(now);
      if (!this.#flyover && !this.#transition.active && this.#mode === 'world' && this.#torusOverview && this.#torusOverview.camera.radius
        <= (this.#torusOverview.camera.lowerRadiusLimit ?? 5.8) * 1.03) this.showRegion();
      this.#updateArrival(now);
      if (this.#mode !== 'world') {
        this.#wrapCamera();
        if (!this.#arrival) this.#updateCameraProfile();
        this.#updateViewMode();
        if (import.meta.env.DEV && this.#space) {
          const target = this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
          this.#canvas.dataset.viewTarget = `${Math.floor(target.cellX)},${Math.floor(target.cellY)}`;
        }
      }
      if (this.#mode !== 'world') {
        this.#streamTerrain(now);
        if (this.#space) this.#regionalOverview.update(this.#space, this.#space.inverse(this.#camera.target.x, this.#camera.target.z));
      }
      this.#loadOverview(now);
      if (this.#space && this.#state) {
        const blend = Math.max(0, Math.min(1, (this.#camera.radius - 110) / 50));
        this.#villageRoads?.show(this.#mode === 'world' ? 0 : 1 - blend);
        this.#regionalOverview.detailBlend(blend);
        const ownBlend = this.#regionalVillages.meshes.has(this.#state.village.id) ? blend : 0;
        for (const root of this.#villageMeshes) for (const mesh of [root, ...root.getChildMeshes()]) {
          mesh.visibility = (mesh.metadata?.baseVisibility ?? 1) * (1 - ownBlend);
        }
        this.#regionalVillages.update(this.#space, this.#state.village.id, blend);
        for (const mesh of this.#renderer?.meshes() ?? []) {
          mesh.visibility = this.#overview ? 1 - blend : 1;
        }
        this.#canvas.dataset.regionalVillages = String(this.#regionalVillages.meshes.size);
      }
      const workerServerNow = Date.now() - this.#serverOffsetMs;
      if (import.meta.env.DEV&&now-this.#workerDebugAt>500) {this.#canvas.dataset.workerTraffic = JSON.stringify(this.#workers.metrics);this.#workerDebugAt=now;}
      this.#weather?.update(Date.now() + this.#cosmologyServerOffsetMs);
      this.#updateCosmology(Date.now() + this.#cosmologyServerOffsetMs, now);
      this.#villageBraziers?.animate(now, this.#villageNight,
        this.#mode === 'world' ? 0 : 1 - Math.max(0, Math.min(1, (this.#camera.radius - 110) / 50)));
      this.#rain.update(this.#camera.target, this.#rainIntensity, this.#mode === 'village' && this.#camera.radius < 160);
      this.#solarLight.intensity = this.#baseSolar * this.#presentationLight;
      this.#ambientLight.intensity = .08 + (this.#baseAmbient - .08) * this.#presentationLight;
      this.#regionalOverview.setPresentationLight(this.#presentationLight);
      if (this.#mode !== 'world') {
        this.#workers.animate(workerServerNow, this.#mode === 'village' && this.#camera.radius < 165);
        const figureBlend = 1 - Math.max(0, Math.min(1, (this.#camera.radius - 110) / 50));
        this.#workers.setVisibility(figureBlend);
        this.#animateWater(now);
        this.#scene.render();
      } else { this.#workers.animate(workerServerNow, false); this.#torusOverview?.scene.render(); }
      this.#clouds.render(this.#transition.alpha, now);
      const observing = this.#mode === 'world' && !this.#flyover && !this.#cosmologyDebug && !this.#transition.active && !document.hidden
        && !this.#state?.village.accomplishments.some(item => item.code === 'cat-eyes') && this.#torusOverview?.eyesVisible();
      if (!observing) this.#eyesSince = null;
      else {
        this.#eyesSince ??= now;
        if (now - this.#eyesSince >= 1800 && now >= this.#eyesRetryAt) { this.#eyesRetryAt = now + 15000; this.onEyesFound(); }
      }
      this.#canvas.dataset.cloudCover = String(this.#transition.alpha);
      if (import.meta.env.DEV && this.#mode === 'world') this.#canvas.dataset.worldCamera = JSON.stringify(this.#torusOverview?.navigationMetrics());
      if (import.meta.env.MODE === 'e2e') {
        const viewport = this.#camera.viewport.toGlobal(this.#engine.getRenderWidth(), this.#engine.getRenderHeight());
        this.#canvas.dataset.cellScreens = JSON.stringify(this.#e2eCells.map((cell) => {
          const point = Vector3.Project(new Vector3(cell.x, 0.075, cell.z), Matrix.Identity(), this.#scene.getTransformMatrix(), viewport);
          return { id: cell.id, x: point.x / this.#engine.getRenderWidth(), y: point.y / this.#engine.getRenderHeight() };
        }));
        const renderedFeatures = new Map<string, { id: string; x: number; z: number }>();
        for (const mesh of this.#renderer?.meshes() ?? []) {
          const data = mesh.metadata as { featureId?: string; cellX: number; cellY: number } | null;
          if (data?.featureId && mesh.isEnabled()) renderedFeatures.set(data.featureId, { id: data.featureId, ...this.#space!.project(data) });
        }
        this.#e2eFeatures = [...renderedFeatures.values()];
        this.#canvas.dataset.featureScreens = JSON.stringify(this.#e2eFeatures.map((feature) => {
          const point = Vector3.Project(new Vector3(feature.x, 0.4, feature.z), Matrix.Identity(), this.#scene.getTransformMatrix(), viewport);
          return { id: feature.id, x: point.x / this.#engine.getRenderWidth(), y: point.y / this.#engine.getRenderHeight() };
        }));
        this.#canvas.dataset.camera = JSON.stringify([this.#camera.alpha, this.#camera.beta, this.#camera.radius, this.#camera.target.x, this.#camera.target.z]);
        this.#canvas.dataset.cameraLimits = JSON.stringify([this.#camera.lowerBetaLimit, this.#camera.upperBetaLimit]);
        this.#canvas.dataset.renderedPendingHarvests = String(this.#pendingHarvestMeshes.length);
        this.#canvas.dataset.debugTravelPaths = String(this.#travelLines?.getTotalVertices() ?? 0);
        this.#canvas.dataset.workerPositions = JSON.stringify([
          ...this.#workers.figures,
        ].map(f => ({ id: f.root.name, enabled: f.root.isEnabled(), ...this.#space!.inverse(f.root.position.x, f.root.position.z) })));
        this.#canvas.dataset.workerServerNow = String(workerServerNow);
        this.#canvas.dataset.workerFigures = String(this.#workers.figures.length);
        this.#canvas.dataset.workerVertices = String(this.#workers.figures.reduce((sum, figure) => sum + figure.root.getChildMeshes().reduce((parts, mesh) => parts + mesh.getTotalVertices(), 0), 0));
        this.#canvas.dataset.buildableGrid = JSON.stringify({ construction: this.#constructionMode,
          minY: this.#buildableGrid?.getBoundingInfo().boundingBox.minimumWorld.y ?? null,
          vertices: this.#buildableGrid?.getTotalVertices() ?? 0,
          ready: this.#buildableGrid?.isReady(true) ?? false,
          blending: this.#buildableGrid?.material?.needAlphaBlending() ?? false,
          areaVertices: this.#buildableArea?.getTotalVertices() ?? 0,
          areaMinY: this.#buildableArea?.getBoundingInfo().boundingBox.minimumWorld.y ?? null });
      }
      this.#frameMs.push(this.#lastFrameAt ? now - this.#lastFrameAt : 0); if (this.#frameMs.length > 3600) this.#frameMs.shift();
      this.#lastFrameAt = now;
    });
  }

  public update(state: VillageState, highlightedSiteIds: string[] = [], constructionMode = false, showTravelPaths = false, selectedRouteId: string | null = null): void {
    if(import.meta.env.DEV&&new URLSearchParams(location.search).get('barracksPreview')==='1'){
      // Preview the new house kit without changing the server's persisted layouts.
      state={...state,cells:state.cells.map(cell=>cell.building?.type==='dwelling'&&!cell.building.visualLayout
        ? {...cell,building:{...cell.building,visualLayout:{recipe:'stone-house',version:1,quarterTurns:0,entranceFace:'-z',offset:[0,0]}}}
        : cell)};
    }
    this.#villageAnchor = { cellX: state.village.anchorCellX, cellY: state.village.anchorCellY };
    if (!this.#space || this.#store?.world.id !== state.world.id || this.#store.world.generationVersion !== state.world.generationVersion) {
      this.#renderer?.dispose(); this.#store?.dispose();
      this.#endFlyover();
      this.#overviewAbort?.abort(); this.#overviewAbort = new AbortController();
      this.#transition.cancel(); this.#pendingView = null; this.#camera.attachControl(this.#canvas, true); this.#regionalOverview.clear();
      this.#regionalVillages.clear(); this.#villagesLoading = false; this.#villagesDue = 0; this.#villagesCenter = '';
      this.#overview = null; this.#torusOverview?.dispose(); this.#torusOverview = null;
      this.#overviewLoading = this.#vegetationLoading = false; this.#vegetationDue = 0; this.#requestedWorld = this.#worldFromWheel = false;
      this.#setMode('village');
      this.#space = new WorldSpace(state.world.widthCells, state.world.heightCells, this.#villageAnchor);
      this.#store = new TerrainStore(state, (chunks, signal, updatesOnly) => updatesOnly
        ? getTerrainUpdates(state.world.slug, chunks, signal) : getTerrain(state.world.slug, chunks, signal));
      this.#weather?.dispose(); this.#weather = new WeatherMap(this.#scene, state.world.id);
      this.#weather.update(Date.now() + this.#cosmologyServerOffsetMs);
      const material = this.#material('streamed-ground', '#ffffff');
      new WeatherMaterial(material, 'ground', () => this.#weather, () => this.#space);
      material.specularColor.set(0, 0, 0);
      material.diffuseTexture = new Texture('/tiles/atlas.png', this.#scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
      material.freeze();
      this.#renderer = new TerrainRenderer(this.#scene, this.#store, this.#space, material, this.#waterRippleMaterial,
        (f) => this.#buildFeature(f), (c, x, y) => this.#buildDecor(c, x, y), (features) => this.#buildWoodland(features),
        () => this.#space!.inverse(this.#camera.target.x, this.#camera.target.z));
    }
    const revision = state.science?.geographyRevision ?? 0;
    if (this.#geographyRevision && revision !== this.#geographyRevision) {
      this.#store!.geographyChanged(); this.#overviewAbort?.abort(); this.#overviewAbort = new AbortController();
      this.#overview = null; this.#overviewLoading = false; this.#overviewRetryAt = 0;
      this.#vegetationLoading = false; this.#vegetationDue = 0; this.#villagesLoading = false; this.#villagesDue = 0;
    }
    this.#geographyRevision = revision;
    this.#state = state; this.#store!.observe(state); this.#showTravel = showTravelPaths; this.#selectedRoute = selectedRouteId;
    this.#torusOverview?.setGlobalModel(this.#globalModelAvailable());
    state = { ...state, cells: state.cells.map(c => ({ ...c, ...this.#space!.projectFrom(c, this.#villageAnchor) })) };

    if (import.meta.env.MODE === 'e2e') {
      this.#e2eCells = state.cells.map(({ id, x, z }) => ({ id, x, z }));

    }
    if (!this.#initialCameraFramed) {
      const occupied = state.cells.filter((cell) => cell.footprint || cell.building);
      if (occupied.length) {
        const xs = occupied.map((cell) => cell.x), zs = occupied.map((cell) => cell.z);
        this.#camera.target.copyFromFloats(
          (Math.min(...xs) + Math.max(...xs)) / 2, 0.45,
          (Math.min(...zs) + Math.max(...zs)) / 2,
        );
      }
      this.#initialCameraFramed = true;
    }
    this.#worldWidthUnits = state.world.widthCells * TILE_SIZE;
    this.#worldHeightUnits = state.world.heightCells * TILE_SIZE;
    this.#camera.upperRadiusLimit = Math.min(680, Math.max(80, Math.min(state.world.widthCells, state.world.heightCells) * TILE_SIZE * 0.7));
    this.#deepGround.scaling.set(state.world.widthCells / 2048, 1, state.world.heightCells / 1024);
    this.#serverOffsetMs = Date.now() - Date.parse(state.serverTime);
    const plots = state.cells.flatMap((cell) => cell.building?.garden?.plots ?? []);
    this.#gardenStages = new Map(plots.map((plot) => [cellKey(plot), gardenTileStage(plot)]));
    this.#harvestableSites = new Set(state.cells.flatMap((cell) => cell.building?.garden && !cell.building.garden.harvest
      ? cell.building.garden.plots.filter((plot) => plot.storedCarrots >= 1 && !plot.harvest).map(cellKey) : []));
    this.#fullGardenSites = new Set(plots.filter((plot) => plot.full && !plot.harvest).map(cellKey));
    this.#workers.sync(state, Date.now() - this.#serverOffsetMs);
    this.#updateTravelPaths(state, showTravelPaths, selectedRouteId);
    this.#canvas.dataset.buildingCount = String(state.cells.filter((site) => site.building).length);
    this.#canvas.dataset.completedBuildingCount = String(state.cells.filter((site) => site.building?.status === 'completed').length);
    this.#canvas.dataset.underConstructionCount = String(state.cells.filter((site) => site.building?.status === 'under-construction').length);
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
        site.cellX, site.cellY,
        this.#gardenStages.get(site.id),
        this.#fullGardenSites.has(site.id),
      ]),
    });
    if (visualSignature === this.#lastVisualSignature) return;
    this.#lastVisualSignature = visualSignature;
    this.#villageMeshes.splice(0);
    this.#selectableMeshes.clear();
    this.#highlightedSiteIds = new Set(highlightedSiteIds);
    this.#constructionMode = constructionMode;
    this.#updateBuildableGrid(state);
    const planned=state.cells.flatMap(site=>{const plan=planForSite(state,site);return plan?[{plan,anchor:site}]:[];});
    const boundaries=resolveMurets(planned,state.world);
    for(const {plan} of planned)if(plan.murets.length)plan.murets=boundaries.get(plan.id)??[];
    const plans=new Map(planned.map(({plan})=>[plan.id,plan]));
    const retained = new Set<string>();
    for (const site of state.cells) {
      if(site.footprint && !site.building && site.footprint.buildingType!=='garden') continue;
      const key=site.building?.id??site.id;
      const footprint=site.building?state.cells.filter(c=>c.footprint?.buildingId===site.building!.id).map(c=>[c.cellX,c.cellY]):[];
      const signature=JSON.stringify([state.world.id,site.x,site.z,site.building?.type,site.building?.status,site.building?.level,site.building?.targetLevel,site.building?.visualLayout,footprint,plans.get(key)?.murets,site.footprint?.state,this.#gardenStages.get(site.id),this.#fullGardenSites.has(site.id),site.building?.type==='university'?[state.science?.levels.mathematics,state.science?.levels.astronomy]:null,!site.building&&!site.footprint?[site.canBuild,this.#highlightedSiteIds.has(site.id)]:null]);
      retained.add(key);
      let cached=this.#buildingCache.get(key);
      if(cached?.signature!==signature){cached?.mesh.dispose(false,false);
      const mesh = site.building?.type === 'university' ? this.#createUniversity(site) : site.building?.visualLayout ? this.#createFactoryBuilding(site,plans.get(key)!)
        : site.building?.status === 'under-construction'
        ? this.#createConstructionSite(site)
        : site.footprint?.buildingType === 'garden'
          ? this.#createGardenExtension(site)
          : site.building
            ? this.#createBuilding(site)
            : this.#createAvailableSite(site);
      cached={signature,mesh};this.#buildingCache.set(key,cached);}
      const mesh=cached.mesh;
      if(!site.building&&!site.footprint){mesh.isVisible=this.#constructionMode&&site.canBuild;mesh.material=this.#highlightedSiteIds.has(site.id)?this.#candidateMaterial:this.#siteMaterial;}
      for (const selectable of [mesh, ...mesh.getChildMeshes()]) {
        selectable.metadata = { ...selectable.metadata, siteId: site.id };
        selectable.isPickable = Boolean(site.footprint || this.#constructionMode && site.canBuild)
          && !selectable.name.startsWith('garden-full-');
      }
      this.#villageMeshes.push(mesh);
      this.#selectableMeshes.set(site.id, mesh);
      if(site.building)for(const cell of state.cells.filter(c=>c.footprint?.buildingId===site.building!.id))this.#selectableMeshes.set(cell.id,mesh);
    }
    if(import.meta.env.DEV&&new URLSearchParams(location.search).get('barracksPreview')==='1'&&this.#space){
      const placement=barracksPreviewPlacement(state),key='dev-barracks-preview';
      this.#canvas.dataset.barracksPreview=placement?`${placement.cellX},${placement.cellY}`:'no-free-patch';
      if(placement){
        retained.add(key);const signature=JSON.stringify([state.world.id,placement]);let cached=this.#buildingCache.get(key);
        if(cached?.signature!==signature){cached?.mesh.dispose(false,false);
          const mesh=new BabylonMesh('dev-barracks-preview',this.#scene);
          this.#timberThatch??=new TimberThatch(this.#scene);buildBarracks(mesh,this.#timberThatch);
          for(const child of mesh.getChildMeshes())child.isPickable=false;
          cached={signature,mesh};this.#buildingCache.set(key,cached);
        }
        const centre=this.#space.project({cellX:placement.cellX+.5,cellY:placement.cellY+2});cached.mesh.position.set(centre.x,placement.base,centre.z);
        this.#villageMeshes.push(cached.mesh);
      }
    }
    for(const [key,cached] of this.#buildingCache)if(!retained.has(key)){cached.mesh.dispose(false,false);this.#buildingCache.delete(key);}
    this.#canvas.dataset.factoryBuildingCount=String(plans.size);
    this.#canvas.dataset.factoryGenerationCount=String(this.#factoryGenerationCount);
    this.#applySelection();
  }

  public selectSite(siteId: string, anchor: ScreenAnchor): void {
    if (!this.#selectableMeshes.has(siteId)) return;
    this.#selectedFeatureId = null;
    this.#applyFeatureSelection();
    this.#selectedSiteId = siteId;
    this.#applySelection();
    this.#onSiteSelected(siteId, anchor);
  }

  #cellAtPointer(event: PointerEvent): Cell | null {
    const point = this.#gridPointAtPointer(event);
    if (!point) return null;
    return { cellX: Math.round(point.cellX) % (this.#worldWidthUnits / TILE_SIZE), cellY: Math.round(point.cellY) % (this.#worldHeightUnits / TILE_SIZE) };
  }

  #gridPointAtPointer(event: PointerEvent): Cell | null {
    const bounds = this.#canvas.getBoundingClientRect();
    const ray = this.#scene.createPickingRay(event.clientX - bounds.left, event.clientY - bounds.top, Matrix.Identity(), this.#camera);
    if (Math.abs(ray.direction.y) < 0.00001) return null;
    const distance = (0.075 - ray.origin.y) / ray.direction.y;
    if (distance < 0) return null;
    return this.#space?.inverse(ray.origin.x + ray.direction.x * distance, ray.origin.z + ray.direction.z * distance) ?? null;
  }

  public updateAreaSelection(enabled: boolean, preview: AreaPreview | null, invalid: boolean): void {
    this.#selectingArea = enabled;
    const signature = JSON.stringify([preview, invalid]);
    if (signature === this.#lastPreviewSignature) return;
    this.#lastPreviewSignature = signature;
    for (const mesh of this.#previewMeshes.splice(0)) mesh.dispose(false, false);
    const existing = new Set((preview?.existingCells ?? []).map(cellKey));
    const obstacles = new Set((preview?.obstacleCells ?? []).map(cellKey));
    for (const cell of preview?.cells ?? []) {
      const mesh = MeshBuilder.CreateBox(`area-preview-${cellKey(cell)}`, { width: TILE_SIZE - 0.06, depth: TILE_SIZE - 0.06, height: 0.025 }, this.#scene);
      const p = this.#space!.projectFrom(cell, this.#villageAnchor);
      mesh.position.set(
        p.x,
        0.15,
        p.z,
      );
      mesh.material = obstacles.has(cellKey(cell)) ? this.#invalidAreaMaterial
        : existing.has(cellKey(cell)) ? this.#selectionMaterial
          : invalid && !preview?.newCells ? this.#invalidAreaMaterial : this.#candidateMaterial;
      mesh.isPickable = false;
      this.#previewMeshes.push(mesh);
    }
  }

  public updateHarvestPending(cells: Cell[]): void {
    for (const mesh of this.#pendingHarvestMeshes.splice(0)) mesh.dispose(false, false);
    for (const cell of cells) {
      const marker = MeshBuilder.CreateTorus(`harvest-pending-${cellKey(cell)}`, { diameter: 2.05, thickness: 0.16, tessellation: 24 }, this.#scene);
      const p = this.#space!.projectFrom(cell, this.#villageAnchor);
      marker.position.set(
        p.x,
        0.25,
        p.z,
      );
      marker.material = this.#pendingHarvestMaterial;
      // Render the interaction overlay above the textured ground, including
      // the reduced-resolution renderer used on slower devices.
      marker.renderingGroupId = 1;
      marker.isPickable = false;
      this.#pendingHarvestMeshes.push(marker);
    }
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
    this.#waterRippleMaterial.alpha = .32 + this.#rainIntensity * .12;
    this.#waterRippleTexture.vOffset = now * 0.000003;
  }

  #tileMaterial(category: 'garden', index: number): StandardMaterial {
    const material = this.#material(`${category}-tile-${index}`, '#ffffff');
    const texture = new Texture(`/tiles/${category}-${index}.png`, this.#scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
    material.diffuseTexture = texture;
    material.specularColor.set(0, 0, 0);
    return material;
  }

  #createTerrain(): Mesh {
    const earth = MeshBuilder.CreateBox('deep-ground', {
      width: this.#worldWidthUnits * 3,
      depth: this.#worldHeightUnits * 3,
      height: 0.8,
    }, this.#scene);
    earth.position.y = -1.55;
    const background = new StandardMaterial('loading-backdrop', this.#scene);
    background.diffuseColor = Color3.FromHexString('#8ea0a0'); background.disableLighting = true;
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
    if (!mesh) { mesh = create(); mesh.setEnabled(false); mesh.isPickable = false; this.#sceneryGeometry.set(key, mesh); }
    data = VertexData.ExtractFromMesh(mesh, true, true); this.#sceneryData.set(key, data); return data;
  }

  #buildWoodland(features: NaturalFeature[]): Mesh[] {
    if (!features.length) return [];
    let source = this.#sceneryGeometry.get('woodland-thin-source');
    if (!source) {
      const shape = (key: string, height: number, material: StandardMaterial): SceneryPart => ({
        geometry: this.#shapeData(key, () => key === 'trunk'
          ? MeshBuilder.CreateCylinder('scenery-trunk', { height: 1.1, diameterTop: 0.22, diameterBottom: 0.38, tessellation: 6 }, this.#scene)
          : key === 'lower'
            ? MeshBuilder.CreateCylinder('scenery-lower', { height: 1.55, diameterTop: 0.16, diameterBottom: 1.55, tessellation: 7 }, this.#scene)
            : MeshBuilder.CreateCylinder('scenery-upper', { height: 1.25, diameterTop: 0.04, diameterBottom: 1.15, tessellation: 7 }, this.#scene)),
        material, position: new Vector3(0, height, 0), scaling: Vector3.One(), rotation: Vector3.Zero(),
      });
      source = bakeScenery(this.#scene, [shape('trunk', 0.5, this.#trunkMaterial),
        shape('lower', 1.48, this.#leafMaterial), shape('upper', 2.22, this.#leafLightMaterial)], this.#woodlandMaterial)[0]!;
      source.name = 'woodland-thin-source'; source.setEnabled(false);
      this.#sceneryGeometry.set('woodland-thin-source', source);
    }
    const transforms: number[] = [];
    const instanceFeatureIds: string[] = [];
    for (const feature of features) {
      if (feature.deposit?.cleared) continue;
      const ground = this.#store!.ground(feature.cellX, feature.cellY); if (!ground) continue;
      const size = this.#store!.world.chunkSize;
      const p = this.#space!.projectFrom(feature, { cellX: Math.floor(feature.cellX / size) * size, cellY: Math.floor(feature.cellY / size) * size });
      const seed = Math.abs(feature.variantSeed), count = 2 + seed % 3;
      for (let tree = 0; tree < count; tree++) {
        const angle = (tree + this.#hash(seed, 401)) / count * Math.PI * 2;
        const radius = 0.42 + this.#hash(seed, tree + 419) * 0.48;
        const x = p.x + Math.cos(angle) * radius, z = p.z + Math.sin(angle) * radius;
        const stockScale = feature.deposit ? 0.2 + 0.8 * feature.deposit.remainingAmount / feature.deposit.initialAmount : 1;
        const scale = (0.76 + this.#hash(seed, tree + 431) * 0.26) * stockScale;
        const rotation = this.#hash(feature.cellX * 10 + tree, feature.cellY * 10 + tree) * Math.PI;
        const transform = Matrix.Compose(new Vector3(scale, scale, scale), Quaternion.RotationAxis(Vector3.Up(), rotation),
          new Vector3(x, ground.height, z));
        transforms.push(...transform.toArray());
        instanceFeatureIds.push(feature.id);
      }
    }
    if (!transforms.length) return [];
    const mesh = cloneWoodland(source, `woodland-${features[0]!.id}`, new Float32Array(transforms));
    mesh.metadata = { woodlandId: features[0]!.id, featureId: features[0]!.id, instanceFeatureIds,
      cellX: features[0]!.cellX, cellY: features[0]!.cellY };
    mesh.isPickable = true;
    mesh.thinInstanceEnablePicking = true;
    mesh.addLODLevel(250, null);
    return [mesh];
  }

  #buildFeature(feature: NaturalFeature): Mesh[] {
    const ground = this.#store!.ground(feature.cellX, feature.cellY);
    if (!ground) return [];
    const { x, z } = this.#space!.project(feature);
    const seed = Math.abs(feature.variantSeed), scenery: Mesh[] = [];
    if (feature.deposit && feature.deposit.state !== 'depleted') {
      const scale = (0.95 + this.#hash(seed, 443) * 0.38)
        * (0.55 + 0.45 * feature.deposit.remainingAmount / feature.deposit.initialAmount);
      this.#createRockCluster(x, z, scale, seed, scenery, ground.height);
      for (const m of scenery) {
        m.metadata = { featureId: feature.id, cellX: feature.cellX, cellY: feature.cellY }; m.isPickable = true;
        if (feature.id === this.#selectedFeatureId) { m.enableEdgesRendering(); m.edgesColor.set(0.95, 0.85, 0.3, 1); m.edgesWidth = 3; }
      }
    }
    return scenery;
  }

  #buildDecor(chunk: TerrainChunk, offsetX: number, offsetY: number): Mesh[] {
    const size = this.#store!.world.chunkSize, stride = size + 2;
    const origin = this.#space!.project({ cellX: chunk.originCellX, cellY: chunk.originCellY });
    const parts: SceneryPart[] = [];
    const featureCells = new Set(chunk.features.filter(f => f.deposit?.state !== 'depleted').map(cellKey));
    const occupiedCells = new Set(chunk.occupiedCells.map(cellKey));
    for (let localY = offsetY; localY < Math.min(offsetY + RENDER_UNIT_CELLS, size); localY += 1) {
      for (let localX = offsetX; localX < Math.min(offsetX + RENDER_UNIT_CELLS, size); localX += 1) {
        const index = (localY + 1) * stride + localX + 1;
        if (chunk.terrainCodes[index] !== 1) continue;
        const cellX = (chunk.originCellX + localX) % this.#space!.width;
        const cellY = (chunk.originCellY + localY) % this.#space!.height;
        const key = cellKey({ cellX, cellY });
        if (featureCells.has(key) || occupiedCells.has(key)) continue;
        const shore = chunk.terrainCodes[index - 1] === 2 || chunk.terrainCodes[index + 1] === 2
          || chunk.terrainCodes[index - stride] === 2 || chunk.terrainCodes[index + stride] === 2;
        if (this.#hash(cellX + 709, cellY + 541) > (shore ? 0.24 : 0.045)) continue;
        const x = origin.x + localX * TILE_SIZE;
        const z = origin.z + localY * TILE_SIZE;
        const elevation = (chunk.elevations[index] ?? 0) * 0.025;
        const pebbleCount = shore || this.#hash(cellX + 113, cellY + 281) > 0.55 ? 2 : 1;
        for (let part = 0; part < pebbleCount; part += 1) {
          const angle = this.#hash(cellX + part * 31, cellY + part * 47) * Math.PI * 2;
          const radius = 0.22 + this.#hash(cellX + part * 59, cellY + part * 71) * 0.35;
          const pebbleRadius = 0.17 + this.#hash(cellX + part * 97, cellY + part * 83) * 0.08;
          parts.push({ geometry: this.#shapeData('ico', () => MeshBuilder.CreateIcoSphere('scenery-ico', { radius: 1, subdivisions: 1 }, this.#scene)),
            material: this.#pebbleMaterial, position: new Vector3(x + Math.cos(angle) * radius, elevation + 0.09, z + Math.sin(angle) * radius),
            scaling: new Vector3(pebbleRadius * 1.1, pebbleRadius * 0.48, pebbleRadius * 0.8), rotation: new Vector3(0, angle, 0) });
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
        mesh.enableEdgesRendering(); mesh.edgesColor.set(0.95, 0.85, 0.3, 1); mesh.edgesWidth = 3;
      } else mesh.disableEdgesRendering();
    }
  }

  #pathPoints(path: TravelCell[]): Vector3[] {
    const points = this.#space!.path(path);
    return path.map((cell, index) => {
      const ground = this.#store!.ground(cell.cellX, cell.cellY);
      const shown = this.#renderer!.rendered(cell.cellX, cell.cellY);
      return new Vector3(points[index]!.x, ground && shown ? ground.height + 0.33 : NaN, points[index]!.z);
    });
  }

  /** Doorstep presentation connector; server journey and work deadlines stay unchanged. */
  #workerPath(path: TravelCell[]): Vector3[] {
    const points = this.#pathPoints(path);
    const hall = this.#state?.cells.find(cell => cell.building?.type === 'town-hall');
    if (!hall || points.length < 2) return points;
    const factoryPlan=planForSite(this.#state!,hall);
    if(factoryPlan)return this.#factoryDeparture(hall,factoryPlan,points);
    const centre = this.#space!.project(hall);
    centre.x = points[0]!.x + delta(centre.x, points[0]!.x, this.#worldWidthUnits);
    centre.z = points[0]!.z + delta(centre.z, points[0]!.z, this.#worldHeightUnits);
    const firstOutside = points.findIndex(p => Math.abs(p.x-centre.x)>1.6 || Math.abs(p.z-centre.z)>1.7);
    if (firstOutside < 0) return points;
    const join = points[firstOutside]!;
    const height = this.#store!.ground(hall.cellX,hall.cellY)?.height;
    const y = height !== undefined && this.#renderer!.rendered(hall.cellX,hall.cellY) ? height+.33 : NaN;
    // Door faces -Z: start just inside, clear the porch, then turn outside the walls.
    const entrance = [new Vector3(centre.x,y+.10,centre.z+TOWN_HALL_DOOR_Z+.06), new Vector3(centre.x,y,centre.z-1.8)];
    if (join.z > centre.z-1.7 && Math.abs(join.x-centre.x)<1.6) {
      const side = centre.x + (join.x < centre.x ? -1 : 1)*1.7;
      entrance.push(new Vector3(side,y,centre.z-1.8),new Vector3(side,join.y,join.z));
    } else entrance.push(new Vector3(join.x,y,centre.z-1.8));
    return [...entrance,...points.slice(firstOutside)];
  }

  #leisurePath(buildingId:string,path:TravelCell[]):Vector3[]{
    const building=this.#state?.cells.find(c=>c.building?.id===buildingId);
    if(!building||!this.#space)return [];
    const factoryPlan=planForSite(this.#state!,building);
    if(factoryPlan){
      const points=this.#workerPath(path);
      if(building.building!.type==='town-hall'){const p=transformPoint(factoryPlan,factoryPlan.entry.inside),centre=this.#space.project(building);return [new Vector3(centre.x+p.x,p.y+.31,centre.z+p.z)];}
      return this.#factoryDeparture(building,factoryPlan,[...points].reverse()).reverse();
    }
    if(building.building!.type==='town-hall'){
      const centre=this.#space.project(building);return [new Vector3(centre.x,0,centre.z+TOWN_HALL_DOOR_Z+.06)];
    }
    const points=this.#workerPath(path);if(!points.length)return points;
    const centre=this.#space.project(building),last=points[points.length-1]!;
    centre.x=last.x+delta(centre.x,last.x,this.#worldWidthUnits);centre.z=last.z+delta(centre.z,last.z,this.#worldHeightUnits);
    let outside=points.length-1;
    while(outside>0&&Math.abs(points[outside]!.x-centre.x)<1.05&&Math.abs(points[outside]!.z-centre.z)<1.05)outside--;
    const join=points[outside]!,entrance:Vector3[]=[];
    if(join.z>centre.z-1.05&&Math.abs(join.x-centre.x)<1.05){
      const side=centre.x+(join.x<centre.x?-1:1)*1.08;
      entrance.push(new Vector3(side,join.y,join.z),new Vector3(side,join.y,centre.z-1.08));
    }else entrance.push(new Vector3(join.x,join.y,centre.z-1.08));
    entrance.push(new Vector3(centre.x,join.y,centre.z-1.08),new Vector3(centre.x,join.y,centre.z-.74));
    return [...points.slice(0,outside+1),...entrance];
  }

  #factoryDeparture(site:VillageCell,plan:BuildingPlan,points:Vector3[]):Vector3[]{
    if(!points.length)return points;
    const anchor=this.#space!.project(site),c=Math.cos(plan.rotation),s=Math.sin(plan.rotation);
    anchor.x=points[0]!.x+delta(anchor.x,points[0]!.x,this.#worldWidthUnits);
    anchor.z=points[0]!.z+delta(anchor.z,points[0]!.z,this.#worldHeightUnits);
    const local=(p:Vector3)=>{const x=p.x-anchor.x-plan.origin.x,z=p.z-anchor.z-plan.origin.z;return {x:c*x-s*z,y:0,z:s*x+c*z};};
    const outside=points.findIndex(p=>{const q=local(p);return Math.abs(q.x)>plan.width/2+.23||Math.abs(q.z)>plan.depth/2+.23;});
    if(outside<0)return points;
    const route=entranceConnector(plan,local(points[outside]!)).map(p=>{const q=transformPoint(plan,p);return new Vector3(anchor.x+q.x,plan.origin.y+.31,anchor.z+q.z);});
    return [...route,...points.slice(outside+1)];
  }

  #updateTravelPaths(state: VillageState, visible: boolean, selectedRouteId: string | null): void {
    const occupied = new Set(state.cells.filter(c => c.footprint || c.building).map(c => `${c.cellX}:${c.cellY}`));
    const displayRoutes = roadDisplayRoutes(state.travelRoutes, occupied);
    this.#renderer?.setRoads(displayRoutes);
    this.#villageBraziers ??= new VillageBraziers(this.#scene);
    const campusFires = state.cells.flatMap(site => {
      if (site.building?.type !== 'university' || site.building.status !== 'completed' || site.building.level !== 3) return [];
      const centre = this.#universityCentre(site);
      return [-1, 1].flatMap(sign => [3.125, 4.375, 5.625].map((x, index) => ({
        x: centre.x + sign * x, y: centre.y + .02, z: centre.z + 2.5 * TILE_SIZE - (TILE_SIZE / 2 + .18),
        seed: (index + (sign > 0 ? 3 : 0) + .5) / 6,
      })));
    });
    this.#villageBraziers.update(displayRoutes, this.#space!, cell => this.#renderer!.rendered(cell.cellX,cell.cellY)
      ? this.#store!.ground(cell.cellX,cell.cellY) : null, occupied, campusFires);
    this.#villageRoads ??= new VillageRoads(this.#scene);
    this.#villageRoads.update(JSON.stringify([state.world.id, this.#space?.version, this.#renderer?.version, displayRoutes]),
      displayRoutes, this.#space!, cell => this.#renderer!.rendered(cell.cellX, cell.cellY)
        ? this.#store!.ground(cell.cellX, cell.cellY) : null);
    const routes = selectedRouteId
      ? state.travelRoutes.filter((route) => route.id === selectedRouteId)
      : state.travelRoutes;
    const signature = JSON.stringify([visible, selectedRouteId, this.#space?.version, this.#renderer?.version, routes.map((route) => route.cells)]);
    if (signature === this.#lastTravelSignature) return;
    this.#lastTravelSignature = signature;
    this.#travelLines?.dispose();
    this.#travelSurface?.dispose(false, true);
    this.#travelLines = null;
    this.#travelSurface = null;
    if (!visible || !routes.length) return;
    const positions: number[] = [];
    const indices: number[] = [];
    const contours: Vector3[][] = [];
    const seen = new Set<string>();
    const inRegion = (cell: TravelCell): boolean => this.#renderer!.rendered(cell.cellX, cell.cellY) && this.#store!.ground(cell.cellX, cell.cellY) !== null;
    for (const route of routes) {
      const points = this.#pathPoints(route.cells);
      for (let step = 1; step < route.cells.length; step++) {
        const firstCell = route.cells[step - 1]!, secondCell = route.cells[step]!;
        if (!inRegion(firstCell) || !inRegion(secondCell)) continue;
        const firstKey = `${firstCell.cellX}:${firstCell.cellY}`;
        const secondKey = `${secondCell.cellX}:${secondCell.cellY}`;
        const reversed = firstCell.cellX > secondCell.cellX
          || (firstCell.cellX === secondCell.cellX && firstCell.cellY > secondCell.cellY);
        const key = reversed ? `${secondKey}|${firstKey}` : `${firstKey}|${secondKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const image = this.#space!.project(firstCell), prior = points[step - 1]!;
        const shift = new Vector3(image.x - prior.x, 0, image.z - prior.z);
        const start = (reversed ? points[step]! : prior).add(shift);
        const end = (reversed ? prior : points[step]!).add(shift);
        const dx = end.x - start.x, dz = end.z - start.z;
        const length = Math.hypot(dx, dz);
        if (length < 0.01 || length > TILE_SIZE * 1.5) continue;
        const normalX = -dz / length, normalZ = dx / length;
        const left: Vector3[] = [], right: Vector3[] = [];
        const count = 6;
        const base = positions.length / 3;
        for (let sample = 0; sample <= count; sample++) {
          const fraction = sample / count;
          const x = start.x + dx * fraction, z = start.z + dz * fraction;
          const canonical = this.#space!.inverse(x, z);
          const y = start.y + (end.y - start.y) * fraction - 0.26;
          for (const side of [1, -1]) {
            const width = 0.32 + (this.#hash(Math.round(canonical.cellX * TILE_SIZE * 10) + side * 113, Math.round(canonical.cellY * TILE_SIZE * 10) + side * 227) - 0.5) * 0.14;
            const edge = new Vector3(x + normalX * width * side, y, z + normalZ * width * side);
            positions.push(edge.x, edge.y, edge.z);
            (side === 1 ? left : right).push(edge.add(new Vector3(0, 0.012, 0)));
          }
          if (sample > 0) {
            const previous = base + (sample - 1) * 2, current = base + sample * 2;
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
    const outline = MeshBuilder.CreateLineSystem('debug-travel-paths', { lines: contours, useVertexAlpha: true }, this.#scene);
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
      if (previous) from.y = to.y = Math.max(from.y, previous[0].y);
      segments.set(key, [from, to]);
    };
    const half = TILE_SIZE / 2;
    for (const cell of state.cells) {
      if (!cell.canBuild) continue;
      const regionX = (cell.cellX - state.region.originCellX + state.world.widthCells) % state.world.widthCells;
      const regionY = (cell.cellY - state.region.originCellY + state.world.heightCells) % state.world.heightCells;
      const elevation = regionX < state.region.width && regionY < state.region.height
        ? state.region.elevations[regionY * state.region.width + regionX] ?? 0 : 0;
      // The textured terrain is elevated per cell; an absolute plane can be
      // buried below it. Clear the shore lip as well as the grass surface.
      const y = elevation * 0.025 + 0.06;
      const northWest = new Vector3(cell.x - half, y, cell.z - half);
      const northEast = new Vector3(cell.x + half, y, cell.z - half);
      const southEast = new Vector3(cell.x + half, y, cell.z + half);
      const southWest = new Vector3(cell.x - half, y, cell.z + half);
      {
        const first = areaPositions.length / 3;
        for (const corner of [northWest, northEast, southEast, southWest]) {
          areaPositions.push(corner.x, y - 0.01, corner.z);
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
    const grid = lines.length > 0
      ? MeshBuilder.CreateLineSystem(
          'buildable-grid',
          { lines, useVertexAlpha: true },
          this.#scene,
        )
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
    if (!geometry) { geometry = create(); geometry.setEnabled(false); geometry.isPickable = false; this.#sceneryGeometry.set(key, geometry); }
    const mesh = geometry.clone(name, null, true)!;
    mesh.setEnabled(true); mesh.isPickable = false; return mesh;
  }

  #createRockCluster(x: number, z: number, scale: number, index: number, sceneryMeshes: Mesh[], baseY = 0): void {
    for (let part = 0; part < (index % 3 === 0 ? 3 : 2); part += 1) {
      const radius = scale * (0.42 - part * 0.07);
      const rock = this.#sceneryClone('ico', 'rock-' + index + '-' + part, () =>
        MeshBuilder.CreateIcoSphere('scenery-ico', { radius: 1, subdivisions: 1 }, this.#scene));
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

  #createAvailableSite(site: VillageCell): Mesh {
    const highlighted = this.#highlightedSiteIds.has(site.id);
    const marker = MeshBuilder.CreateBox(
      `site-${site.id}`,
      { height: highlighted ? 0.045 : 0.018, width: highlighted ? 2.3 : 2.15, depth: highlighted ? 2.3 : 2.15 },
      this.#scene,
    );
    marker.position.set(site.x, 0.075, site.z);
    marker.material = highlighted ? this.#candidateMaterial : this.#siteMaterial;
    // Picking/preview plates belong only to construction. The LOD fade must
    // neither reveal them outside that mode nor replace their base opacity.
    marker.isVisible = this.#constructionMode && site.canBuild;
    marker.metadata = { baseVisibility: highlighted ? 1 : 0.015 };
    if (highlighted) {
      marker.enableEdgesRendering();
      marker.edgesColor.set(0.78, 0.95, 0.52, 0.9);
      marker.edgesWidth = 2;
    } else {
      marker.visibility = 0.015;
    }
    return marker;
  }

  #createBuilding(site: VillageCell): Mesh {
    if (site.building?.type === 'garden') return this.#createGardenPlot(site, false);
    if (site.building?.type === 'sawmill') return this.#createSawmill(site);
    if (site.building?.type === 'town-hall') return this.#createTownHall(site);
    return this.#createDwelling(site);
  }

  #createTownHall(site: VillageCell): Mesh {
    const body = new BabylonMesh(`town-hall-${site.id}`, this.#scene);
    body.position.set(site.x, 0.78, site.z);
    this.#timberThatch ??= new TimberThatch(this.#scene);
    this.#timberThatch.build(body);
    this.#createContactShadow(body, 2.75, 2.45);
    return this.#registerStructure(body);
  }

  #universityCentre(site: VillageCell): Vector3 {
    const cells = this.#state!.cells.filter(c => c.footprint?.buildingId === site.building!.id);
    const dx = cells.map(c => delta(c.cellX, site.cellX, this.#state!.world.widthCells));
    const dz = cells.map(c => delta(c.cellY, site.cellY, this.#state!.world.heightCells));
    const heights = cells.map(c => this.#store?.ground(c.cellX, c.cellY)?.height ?? 0);
    const point = this.#space!.projectFrom(site, this.#villageAnchor);
    return new Vector3(point.x + (Math.min(...dx) + Math.max(...dx)) * TILE_SIZE / 2,
      Math.max(0, ...heights), point.z + (Math.min(...dz) + Math.max(...dz)) * TILE_SIZE / 2);
  }

  #createUniversity(site: VillageCell): Mesh {
    const body = new BabylonMesh(`university-${site.building!.id}`, this.#scene);
    body.position.copyFrom(this.#universityCentre(site));
    this.#timberThatch ??= new TimberThatch(this.#scene);
    buildUniversity(body, this.#timberThatch, site.building!.targetLevel ?? site.building!.level,
      site.building!.status === 'under-construction' ? 'works' : 'finished', site.building!.targetLevel ? site.building!.level : 0,
      { mathematics: (this.#state!.science?.levels.mathematics ?? 0) >= 3, astronomy: (this.#state!.science?.levels.astronomy ?? 0) >= 1 });
    return this.#registerStructure(body);
  }

  #createFactoryBuilding(site:VillageCell,plan:BuildingPlan):Mesh {
    this.#factoryGenerationCount++;
    const body=new BabylonMesh(`factory-${site.building!.id}`,this.#scene);
    body.position.set(site.x+plan.origin.x,plan.origin.y,site.z+plan.origin.z);
    body.rotation.y=plan.rotation;
    this.#timberThatch??=new TimberThatch(this.#scene);this.#timberThatch.build(body,plan);
    this.#createContactShadow(body,plan.width+.08,plan.depth+.08);
    return this.#registerStructure(body);
  }

  #createSawmill(site: VillageCell): Mesh {
    const level = site.building?.level ?? 1;
    const foundation = MeshBuilder.CreateBox(`sawmill-${site.id}`, { width: 2.28, depth: 2.02, height: 0.16 }, this.#scene);
    foundation.position.set(site.x, 0.09, site.z);
    foundation.material = this.#stoneMaterial;

    const box = (name: string, width: number, height: number, depth: number, x: number, y: number, z: number, material: StandardMaterial): Mesh => {
      const mesh = MeshBuilder.CreateBox(`${name}-${site.id}`, { width, height, depth }, this.#scene);
      mesh.parent = foundation;
      mesh.position.set(x, y, z);
      mesh.material = material;
      mesh.isPickable = false;
      return mesh;
    };
    const log = (name: string, x: number, y: number, z: number, length: number, radius = 0.11, alongZ = true): Mesh => {
      const mesh = MeshBuilder.CreateCylinder(`${name}-${site.id}`, { height: length, diameter: radius * 2, tessellation: 8 }, this.#scene);
      mesh.parent = foundation;
      mesh.position.set(x, y, z);
      mesh.rotation.x = alongZ ? Math.PI / 2 : 0;
      mesh.rotation.z = alongZ ? 0 : Math.PI / 2;
      mesh.material = this.#lightTimberMaterial;
      mesh.isPickable = false;
      return mesh;
    };

    // A working yard breaks the building's footprint into the surrounding grass.
    for (const [x, z, diameter, scaleX, material, rotation] of [
      [-0.12, 0.06, 2.82, 1.08, this.#packedEarthMaterial, 0.18],
      [0.92, -0.6, 0.88, 1.3, this.#sawdustMaterial, -0.34],
      [-1.02, 0.72, 0.92, 1.42, this.#packedEarthMaterial, 0.52],
    ] as const) {
      const patch = MeshBuilder.CreateCylinder(`sawmill-yard-${site.id}-${x}-${z}`, { height: 0.022, diameter, tessellation: 9 }, this.#scene);
      patch.parent = foundation;
      patch.position.set(x, -0.068, z);
      patch.scaling.x = scaleX;
      patch.rotation.y = rotation;
      patch.material = material;
      patch.isPickable = false;
    }

    // Dark rear mass and partial plank walls suggest an interior without closing the workshop.
    box('sawmill-dark-interior', 1.62, 1.02, 0.12, 0, 0.62, 0.72, this.#darkTimberMaterial);
    box('sawmill-left-wall', 0.13, 1.0, 1.38, -0.81, 0.6, 0.04, this.#timberMaterial);
    box('sawmill-right-wall', 0.13, 0.68, 1.38, 0.81, 0.44, 0.04, this.#timberMaterial);

    // Visible post-and-beam frame carries the silhouette.
    for (const x of [-0.9, 0.9]) {
      for (const z of [-0.76, 0.76]) box('sawmill-post', 0.14, 1.46, 0.14, x, 0.78, z, this.#darkTimberMaterial);
    }
    box('sawmill-front-beam', 2.0, 0.15, 0.15, 0, 1.46, -0.76, this.#darkTimberMaterial);
    box('sawmill-back-beam', 2.0, 0.15, 0.15, 0, 1.46, 0.76, this.#darkTimberMaterial);
    box('sawmill-ridge-beam', 0.14, 0.14, 2.28, 0, 1.88, 0, this.#darkTimberMaterial);

    const leftRoof = box('sawmill-roof-left', 1.3, 0.13, 2.34, -0.54, 1.65, 0, this.#roofMaterial);
    leftRoof.rotation.z = 0.5;
    const rightRoof = box('sawmill-roof-right', 1.3, 0.13, 2.34, 0.54, 1.65, 0, this.#roofMaterial);
    rightRoof.rotation.z = -0.5;

    // The open front contains an actual work platform and a readable saw station.
    box('sawmill-platform', 1.48, 0.12, 0.54, -0.06, 0.1, -0.94, this.#timberMaterial);
    box('sawmill-saw-bench', 1.18, 0.12, 0.4, 0.14, 0.59, -0.47, this.#lightTimberMaterial);
    for (const x of [-0.39, 0.67]) box('sawmill-bench-leg', 0.1, 0.48, 0.1, x, 0.34, -0.47, this.#darkTimberMaterial);
    const blade = MeshBuilder.CreateCylinder(`sawmill-blade-${site.id}`, { height: 0.055, diameter: 0.5, tessellation: 12 }, this.#scene);
    blade.parent = foundation;
    blade.position.set(0.12, 0.77, -0.47);
    blade.rotation.z = Math.PI / 2;
    blade.material = this.#stoneMaterial;
    blade.isPickable = false;

    // Raw timber and a stump introduce deliberate asymmetry at ground level.
    for (let index = 0; index < 4; index += 1) log('sawmill-log-pile', -1.04 + (index % 2) * 0.22, 0.18 + Math.floor(index / 2) * 0.2, 0.34, 1.22 - (index % 2) * 0.12);
    const stump = MeshBuilder.CreateCylinder(`sawmill-stump-${site.id}`, { height: 0.28, diameterTop: 0.42, diameterBottom: 0.5, tessellation: 9 }, this.#scene);
    stump.parent = foundation;
    stump.position.set(1.18, 0.08, 0.83);
    stump.material = this.#trunkMaterial;
    stump.isPickable = false;

    // Higher levels grow through useful annexes, never through stacked storeys.
    if (level >= 2) {
      const leanToRoof = box('sawmill-lean-to-roof', 1.12, 0.11, 1.92, 1.26, 1.09, 0.08, this.#roofMaterial);
      leanToRoof.rotation.z = -0.2;
      for (const z of [-0.72, 0.78]) box('sawmill-lean-to-post', 0.11, 0.98, 0.11, 1.68, 0.52, z, this.#darkTimberMaterial);
      box('sawmill-drying-rack', 0.14, 0.72, 1.42, 1.42, 0.47, 0.04, this.#darkTimberMaterial);
      for (const y of [0.3, 0.55, 0.8]) log('sawmill-racked-timber', 1.38, y, 0.04, 1.28, 0.07, true);
    }

    if (level >= 3) {
      box('sawmill-roof-monitor-dark', 0.68, 0.34, 0.7, 0, 2.01, 0.26, this.#darkTimberMaterial);
      const monitorLeft = box('sawmill-roof-monitor-left', 0.5, 0.09, 0.86, -0.2, 2.27, 0.26, this.#roofMaterial);
      monitorLeft.rotation.z = 0.44;
      const monitorRight = box('sawmill-roof-monitor-right', 0.5, 0.09, 0.86, 0.2, 2.27, 0.26, this.#roofMaterial);
      monitorRight.rotation.z = -0.44;
      box('sawmill-hoist', 0.12, 0.12, 1.18, 0.6, 1.38, -1.24, this.#darkTimberMaterial).rotation.y = -0.18;
    }

    for (const [x, z, scale] of [[-1.4, -0.82, 0.18], [1.36, -0.96, 0.14], [-1.28, 1.02, 0.12]] as const) {
      const stone = MeshBuilder.CreateIcoSphere(`sawmill-yard-stone-${site.id}-${x}`, { radius: scale, subdivisions: 1 }, this.#scene);
      stone.parent = foundation;
      stone.position.set(x, scale * 0.45 - 0.06, z);
      stone.scaling.y = 0.58;
      stone.rotation.y = x;
      stone.material = this.#stoneMaterial;
      stone.isPickable = false;
    }

    this.#createContactShadow(foundation, level >= 2 ? 3.5 : 2.65, 2.45);
    return this.#registerStructure(foundation);
  }

  #createDwelling(site: VillageCell): Mesh {
    const level = site.building?.level ?? 1;
    const body = MeshBuilder.CreateBox(`dwelling-${site.id}`, { width: 1.7, depth: 1.55, height: 1.12 }, this.#scene);
    body.position.set(site.x, 0.66, site.z);
    body.material = level >= 2 ? this.#timberMaterial : this.#lightTimberMaterial;
    const roof = MeshBuilder.CreateCylinder(`dwelling-roof-${site.id}`, { height: 0.72, diameterTop: 0, diameterBottom: 2.25, tessellation: 4 }, this.#scene);
    roof.parent = body;
    roof.position.y = 0.85;
    roof.rotation.y = Math.PI / 4;
    roof.material = this.#roofMaterial;
    const door = MeshBuilder.CreateBox(`dwelling-door-${site.id}`, { width: 0.42, height: 0.68, depth: 0.06 }, this.#scene);
    door.parent = body;
    door.position.set(0, -0.21, -0.8);
    door.material = this.#darkTimberMaterial;
    this.#createContactShadow(body, 1.98, 1.82);
    return this.#registerStructure(body);
  }

  #createGardenPlot(site: VillageCell, reserved: boolean): Mesh {
    const plot = new BabylonMesh(`garden-${site.id}`, this.#scene);
    const base = VertexData.CreateBox({ width: TILE_SIZE, depth: TILE_SIZE, height: 0.1 });
    // The crop surface is the sole top face: no almost-coplanar soil cap beneath it.
    base.indices = Array.from(base.indices!).filter((_, index, indices) =>
      base.normals![indices[Math.floor(index / 3) * 3]! * 3 + 1]! < 0.5);
    base.applyToMesh(plot);
    const ground = this.#store?.ground(site.cellX, site.cellY)?.height ?? 0;
    plot.position.set(site.x, ground + 0.11, site.z);
    plot.material = this.#soilMaterial;
    const surface = MeshBuilder.CreateGround(`garden-surface-${site.id}`,
      { width: TILE_SIZE, height: TILE_SIZE }, this.#scene);
    surface.parent = plot;
    surface.position.y = 0.05;
    surface.material = this.#gardenTileMaterials[reserved ? 0 : this.#gardenStages.get(site.id) ?? 1]!;
    if (!reserved && this.#fullGardenSites.has(site.id)) {
      const marker = MeshBuilder.CreateCylinder(`garden-full-${site.id}`, { height: 0.12, diameter: 0.62, tessellation: 16 }, this.#scene);
      marker.parent = plot; marker.position.set(0, 1.05, 0); marker.material = this.#windowMaterial; marker.isPickable = false;
      const stem = MeshBuilder.CreateCylinder(`garden-full-stem-${site.id}`, { height: 0.34, diameter: 0.08, tessellation: 8 }, this.#scene);
      stem.parent = plot; stem.position.set(0, 0.83, 0); stem.material = this.#leafDarkMaterial; stem.isPickable = false;
    }
    return this.#registerStructure(plot);
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
    const construction = MeshBuilder.CreateBox(`construction-${building?.id}`, { width, depth: width, height }, this.#scene);
    construction.position.set(site.x, height / 2 + 0.11, site.z);
    construction.material = this.#constructionMaterial;
    if (isGarden) {
      const surface = MeshBuilder.CreateGround(`garden-construction-surface-${site.id}`,
        { width: TILE_SIZE * 0.97, height: TILE_SIZE * 0.97 }, this.#scene);
      surface.parent = construction;
      surface.position.y = 0.16 - construction.position.y;
      surface.material = this.#gardenTileMaterials[0]!;
    }
    for (const x of [-width / 2, width / 2]) {
      for (const z of [-width / 2, width / 2]) {
        const post = MeshBuilder.CreateBox(`scaffold-${site.id}-${x}-${z}`, { width: 0.09, depth: 0.09, height: Math.max(0.42, height) }, this.#scene);
        post.parent = construction;
        post.position.set(x * 0.9, 0, z * 0.9);
        post.material = this.#scaffoldMaterial;
      }
    }
    for (const y of [-height * 0.25, height * 0.25]) {
      const rail = MeshBuilder.CreateBox(`scaffold-rail-${site.id}-${y}`, { width: width * 0.96, depth: 0.07, height: 0.08 }, this.#scene);
      rail.parent = construction;
      rail.position.set(0, y, -width * 0.47);
      rail.material = this.#scaffoldMaterial;
    }
    return this.#registerStructure(construction);
  }

  #registerStructure(root: Mesh): Mesh {
    root.receiveShadows = true;
    for (const child of root.getChildMeshes()) {
      child.receiveShadows = true;
    }
    return root;
  }

  #createContactShadow(parent: Mesh, width: number, depth: number): Mesh {
    const shadow = MeshBuilder.CreateDisc(`contact-shadow-${parent.name}`, { radius: 0.5, tessellation: 16 }, this.#scene);
    shadow.parent = parent;
    shadow.rotation.x = Math.PI / 2;
    shadow.position.set(0.1, -parent.position.y + 0.035, 0.12);
    shadow.scaling.set(width, depth, 1);
    shadow.material = this.#contactShadowMaterial;
    shadow.isPickable = false;
    return shadow;
  }

  #applySelection(): void {
    const selected = this.#selectedSiteId ? this.#selectableMeshes.get(this.#selectedSiteId) : undefined;
    this.#selectionMarker.isVisible = Boolean(selected);
    if (selected) this.#selectionMarker.position.set(selected.position.x, 0.135, selected.position.z);
  }

  #wrapCamera(): void {
    if (!this.#space || !this.#store) return;
    const target = this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
    const priorVillage = this.#space.project(this.#villageAnchor);
    const shift = this.#space.rebase(target, this.#store.world.chunkSize);
    if (!shift) return;
    const nextVillage = this.#space.project(this.#villageAnchor);
    const villageShift = { x: priorVillage.x - nextVillage.x, z: priorVillage.z - nextVillage.z };
    this.#camera.target.x -= shift.x; this.#camera.target.z -= shift.z;
    this.#camera.position.x -= shift.x; this.#camera.position.z -= shift.z;
    this.#workers.shift(shift.x, shift.z);
    for (const mesh of [...this.#villageMeshes, ...this.#previewMeshes, ...this.#pendingHarvestMeshes,
      this.#selectionMarker, this.#buildableGrid, this.#buildableArea].filter((m): m is Mesh => m !== null)) {
      mesh.position.x -= villageShift.x; mesh.position.z -= villageShift.z; mesh.computeWorldMatrix(true);
    }
    for (const cell of this.#e2eCells) { cell.x -= villageShift.x; cell.z -= villageShift.z; }
    for (const feature of this.#e2eFeatures) { feature.x -= shift.x; feature.z -= shift.z; }
    this.#renderer?.shift(shift.x, shift.z);
    this.#regionalOverview.shift(shift.x, shift.z);
    if (this.#state) this.#updateTravelPaths(this.#state, this.#showTravel, this.#selectedRoute);
  }

  readonly #testCamera = (event: Event): void => {
    if (!this.#space) return;
    const target = (event as CustomEvent<TravelCell & { radius?: number; alpha?: number; beta?: number }>).detail, point = this.#space.project(target);
    this.#camera.inertialPanningX = this.#camera.inertialPanningY = 0;
    this.#camera.inertialAlphaOffset = this.#camera.inertialBetaOffset = this.#camera.inertialRadiusOffset = 0;
    this.#camera.target.copyFromFloats(point.x, 0.45, point.z);
    if (target.radius !== undefined) this.#camera.radius = Math.max(8, Math.min(this.#camera.upperRadiusLimit ?? 680, target.radius));
    if (target.alpha !== undefined) this.#camera.alpha = target.alpha;
    if (target.beta !== undefined) this.#camera.beta = Math.max(0.05, Math.min(1.35, target.beta));
  };
  readonly #testMetricsReset = (): void => {
    this.#frameMs.length = 0; this.#streamMs.length = 0;
    if (this.#renderer) {
      this.#renderer.integrationMs.length = 0; this.#renderer.activeIntegrationMs.length = 0;
      this.#renderer.slowestUnit = { kind: '', ms: 0 };
    }
  };

  public acceptDeposit(deposit: StoneDeposit): void { this.#store?.deposit(deposit); }
  public setCosmologyDebug(enabled: boolean): void {
    this.#cosmologyDebug = enabled && this.#globalModelAvailable();
    if (!enabled) { this.#pendingSolarProfile = false; this.#torusOverview?.restoreNavigation(); this.#cosmologyPhase = null; this.#cosmologyPeriod = COSMOLOGY.periodMs; }
  }
  public setCosmologyServerOffset(offsetMs: number): void { this.#cosmologyServerOffsetMs = offsetMs; }
  public setCosmologyPhase(fraction: number | null): void {
    this.#cosmologyPhase = fraction === null ? null : Math.max(0, Math.min(1, fraction)) * TAU;
    this.#cosmologyNextAt = 0;
  }
  public setCosmologyPeriod(seconds: number): void {
    this.#cosmologyPeriod = Math.max(30, Math.min(28800, seconds)) * 1000; this.#cosmologyNextAt = 0;
  }
  public previewSolarProfile(): void {
    this.showWorld();
    if (this.#mode === 'world' && !this.#transition.active && this.#torusOverview) this.#torusOverview.showSolarProfile();
    else this.#pendingSolarProfile = true;
  }
  public getCosmologyDiagnostics() { return this.#cosmologyMetrics; }
  #updateCosmology(serverMs: number, now: number): void {
    if (!this.#state || !this.#space) return;
    const phase = this.#cosmologyPhase ?? cyclePhase(serverMs, combinedPeriod(this.#cosmologyPeriod));
    if (this.#mode === 'world') this.#torusOverview?.updateCosmology(phase,
      (serverMs - COSMOLOGY.epochMs) / this.#cosmologyPeriod, now, this.#cosmologyDebug);
    if (now < this.#cosmologyNextAt) return;
    this.#cosmologyNextAt = now + 200;
    this.#villageNight = illumination(this.#villageAnchor.cellX / this.#space.width * TAU,
      this.#villageAnchor.cellY / this.#space.height * TAU + Math.PI, phase).direct <= 0;
    const started = performance.now();
    if (this.#mode !== 'world') this.#regionalOverview.updateLighting(phase, now);
    const target = this.#mode === 'world' ? this.#worldTarget ?? this.#villageAnchor
      : this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
    const u = target.cellX / this.#space.width * TAU, v = target.cellY / this.#space.height * TAU + Math.PI;
    const light = illumination(u, v, phase);
    this.#solarLight.direction.copyFromFloats(-light.localDirection[0], -light.localDirection[1], -light.localDirection[2]);
    this.#baseSolar = light.direct > 0 ? .85 : 0;
    this.#solarLight.intensity = this.#baseSolar * this.#presentationLight;
    const weather = weatherAt(target.cellX / this.#space.width, target.cellY / this.#space.height, serverMs, this.#weather?.seed ?? 0);
    this.#rainIntensity = weather.rain;
    this.#baseAmbient = .34 + light.direct * .24 * (1 - weather.cloud * .4);
    if (import.meta.env.DEV) this.#canvas.dataset.weather = JSON.stringify(weather);
    this.#scene.clearColor = Color4.FromHexString(light.direct > .01 ? '#8ea0a0ff' : '#263744ff');
    this.#scene.fogColor.copyFromFloats(this.#scene.clearColor.r, this.#scene.clearColor.g, this.#scene.clearColor.b);
    const phases = cyclePhases(phase);
    this.#cosmologyMetrics = { phase, torusPhase: phases.torus, sunPhase: phases.sun, rotationPeriodMs: this.#cosmologyPeriod,
      u, v, direct: light.direct, occluded: light.occluded,
      paused: this.#cosmologyPhase !== null, updateMs: performance.now() - started,
      ...(this.#torusOverview?.metrics() ?? { worldRenderMs: 0, worldMeshes: 0, shadowBytes: 0 }) };
    if (import.meta.env.DEV) this.#canvas.dataset.cosmology = JSON.stringify(this.#cosmologyMetrics);
  }
  public skipArrival(finish = false): void {
    if (finish && this.#arrival) { this.#applyLanding(VILLAGE_LANDING); this.#aimTownHall(1); }
    if(this.#flyover?.landing && this.#arrival) this.#endFlyover();
    this.#arrivalPending = false; this.#arrival = null; this.#presentationLight = 1;
    this.onArrival(null);
  }
  #applyLanding(pose: LandingPose): void {
    this.#camera.radius = pose.radius; this.#camera.beta = pose.beta; this.#camera.fov = pose.fov;
    this.#camera.upperBetaLimit = Math.max(1.05, pose.beta);
    this.#camera.inertialRadiusOffset = this.#camera.inertialAlphaOffset = this.#camera.inertialBetaOffset = 0;
    this.#lastCameraRadius = pose.radius;
  }
  public zoomDuringArrival(deltaY: number): void {
    this.skipArrival();
    this.#camera.radius = Math.max(8, Math.min(680, this.#camera.radius * Math.exp(Math.sign(deltaY) * .2)));
  }
  #updateArrival(now: number): void {
    if (this.#arrivalPending && !this.#transition.active && this.#state && this.#space) {
      this.#arrivalPending = false;
      const target = this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
      if (Math.hypot(delta(target.cellX, this.#villageAnchor.cellX, this.#space.width), delta(target.cellY, this.#villageAnchor.cellY, this.#space.height)) <= 24) {
        const u = this.#villageAnchor.cellX / this.#space.width * TAU, v = this.#villageAnchor.cellY / this.#space.height * TAU + Math.PI;
        if (!this.#clock || this.#clock.u !== u || this.#clock.v !== v) this.#clock = new SolarClock(u, v);
        this.#arrival = { started: now, name: this.#state.village.name,
          fromTarget: target,
          from: { radius: this.#camera.radius, beta: this.#camera.beta, fov: this.#camera.fov },
          time: this.#clock.label(Date.now() + this.#cosmologyServerOffsetMs,
            this.#cosmologyPhase ?? cyclePhase(Date.now() + this.#cosmologyServerOffsetMs, combinedPeriod(this.#cosmologyPeriod))) };
      }
    }
    if (!this.#arrival) return;
    const elapsed = now - this.#arrival.started, reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = arrivalFrame(elapsed, reduced);
    this.#applyLanding(landingPose(this.#arrival.from, elapsed, reduced));
    this.#aimTownHall(reduced ? 1 : Math.min(1,elapsed/5200));
    this.#presentationLight = frame.light;
    if (frame.done) { this.skipArrival(); return; }
    if (now >= this.#arrivalNextAt) {
      this.#arrivalNextAt = now + 32;
      this.onArrival({ name: this.#arrival.name, time: this.#arrival.time, veil: frame.veil, black: frame.black, title: frame.title });
    }
  }
  public retryTerrain(): void { this.#overviewRetryAt = 0; this.#store?.revalidate(); }
  #aimTownHall(progress: number): void {
    if(!this.#space || !this.#state || !this.#arrival) return;
    const hall=townHallFocus(this.#state), to=this.#space.project(hall);
    const from=this.#space.projectFrom(this.#arrival.fromTarget,hall), t=progress*progress*(3-2*progress);
    const height=this.#store?.ground(hall.cellX,hall.cellY)?.height ?? 0;
    this.#camera.target.set(from.x+(to.x-from.x)*t,.45+(height+.65-.45)*t,from.z+(to.z-from.z)*t);
  }
  public startFlyover(): void {
    if(this.#flyover || !this.#state || this.#transition.active) return;
    this.skipArrival();
    if (!this.#globalModelAvailable()) {
      this.showRegion(); this.#flyover = { requested: performance.now(), started: performance.now(), landing: false, local: true };
      this.#camera.detachControl(); return;
    }
    this.#flyover={requested:performance.now(),started:null,landing:false};
    this.#camera.detachControl(); this.#torusOverview?.camera.detachControl();
    if(this.#mode!=='world') this.showWorld();
  }
  #endFlyover(): void {
    this.#flyover=null; this.#torusOverview?.finishFlyover();
    this.#requestedWorld=false;
    delete this.#canvas.dataset.flyover;
    if(!this.#transition.active) (this.#mode==='world'?this.#torusOverview?.camera:this.#camera)?.attachControl(this.#canvas,true);
  }
  #updateFlyover(now: number): void {
    const shot=this.#flyover; if(!shot || !this.#state) return;
    if (shot.local && !shot.landing) {
      const regional = (this.#state.science?.knowledgeCoefficient ?? 0) >= .15 && (this.#state.science?.levels.geography ?? 0) >= 1;
      const duration = regional ? 5000 : 1200, progress = Math.min(1, (now - shot.requested) / duration);
      if (regional && this.#space) {
        const focus = this.#space.project(townHallFocus(this.#state)), glide = (1 - progress) ** 2;
        this.#camera.target.set(focus.x + glide * 18, .45, focus.z - glide * 12);
        this.#camera.radius = 170 + glide * 80;
      }
      if (progress >= 1) {
        shot.landing = true; this.showVillage();
      }
      return;
    }
    if(import.meta.env.DEV) this.#canvas.dataset.flyover=JSON.stringify({stage:shot.landing?'landing':shot.started===null?'waiting':now-shot.started<12000?'orbit':'descent',elapsed:shot.started===null?0:now-shot.started});
    if(this.#transition.failed || now-shot.requested>45000) { this.#endFlyover(); return; }
    if(shot.landing) {
      if(!this.#transition.active && !this.#arrival && !this.#arrivalPending) this.#endFlyover();
      return;
    }
    if(this.#mode!=='world' || !this.#torusOverview || this.#transition.active) return;
    shot.started ??= now;
    if(this.#torusOverview.flyover(now-shot.started,townHallFocus(this.#state),this.#returnAlpha)) {
      shot.landing=true; this.#torusOverview.finishFlyover(); this.showVillage();
    }
  }

  #worldTarget: TravelCell | null = null;
  #setMode(mode: TerrainViewMode): void {
    if (this.#mode === mode) return;
    this.#pointerDown = null;
    if (mode === 'village' && this.#mode !== 'village') this.#arrivalPending = true;
    else if (mode !== 'village') this.skipArrival();
    this.#mode = mode;
    if (mode === 'world') {
      this.#store?.setPaused(true); this.#renderer?.setVisible(false);
      this.#requestedWorld = this.#worldFromWheel = false;
    }
    this.#buildableGrid?.setEnabled(mode === 'village');
    this.#buildableArea?.setEnabled(mode === 'village');
    for (const mesh of this.#previewMeshes) mesh.setEnabled(mode === 'village');
    this.#onCameraMoved(); this.#onViewChanged(mode);
  }
  #updateViewMode(): void {
    if (!this.#space || this.#flyover || this.#transition.active || this.#arrival || this.#arrivalPending) return;
    const radius = this.#camera.radius;
    const limit = this.#camera.upperRadiusLimit ?? 680;
    const regionStart = Math.min(110, Math.max(20, limit * 0.42));
    const next: TerrainViewMode = radius >= limit * 0.85 ? 'world'
      : radius >= (this.#mode === 'region' ? regionStart * 0.86 : regionStart) ? 'region' : 'village';
    if (next === 'world') {
      this.#setMode('region');
      this.#worldFromWheel = true; this.showWorld(); return;
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
    if(this.#flyover?.landing) return;
    if (this.#transition.active) { this.#pendingView = 'world'; return; }
    if (!this.#space || this.#mode === 'world' || performance.now() < this.#projectionRetryAt) return;
    this.#requestedWorld = true;
    if (!this.#torusOverview) return;
    this.#returnRadius = this.#camera.radius; this.#returnAlpha = this.#camera.alpha; this.#returnBeta = this.#camera.beta;
    this.#worldTarget = this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
    this.#changeProjection(() => {
      this.#returnRadius = this.#camera.radius; this.#returnAlpha = this.#camera.alpha; this.#returnBeta = this.#camera.beta;
      this.#worldTarget = this.#space!.inverse(this.#camera.target.x, this.#camera.target.z);
      this.#torusOverview!.enter(this.#worldTarget!, this.#returnAlpha, this.#returnRadius, this.#returnBeta, this.#camera.fov);
      this.#torusOverview!.mark(this.#villageAnchor, this.#worldTarget!);
      if(this.#flyover && this.#state) this.#torusOverview!.flyover(0,townHallFocus(this.#state),this.#returnAlpha);
      if (this.#pendingSolarProfile) { this.#torusOverview!.showSolarProfile(); this.#pendingSolarProfile = false; }
      if (this.#pendingCatView) { this.#torusOverview!.showCatEyes(); this.#pendingCatView = false; }
      this.#setMode('world');
    });
  }
  #returnToPlane(village: boolean): void {
    this.#torusOverview?.restoreNavigation();
    if (!village && this.#torusOverview) this.#returnAlpha = this.#torusOverview.planarHeading();
    const target = village ? this.#villageAnchor : this.#torusOverview?.observed() ?? this.#worldTarget;
    this.#worldTarget = target;
    if (target && this.#space) {
      const p = this.#space.project(target); this.#camera.target.copyFromFloats(p.x, .45, p.z);
    }
    this.#camera.alpha = this.#returnAlpha; this.#camera.beta = this.#returnBeta;
    this.#camera.radius = village ? 90 : Math.max(120, Math.min(this.#returnRadius, (this.#camera.upperRadiusLimit ?? 680) * .8));
    this.#setMode(village ? 'village' : 'region');
  }
  public showRegion(): void {
    if(this.#flyover) return;
    if (this.#transition.active) { this.#pendingView = 'region'; return; }
    this.#requestedWorld = false;
    this.#worldFromWheel = false;
    if (this.#mode === 'world') this.#changeProjection(() => this.#returnToPlane(false));
    else { this.#camera.radius = Math.min(260, (this.#camera.upperRadiusLimit ?? 680) * .65); this.#setMode('region'); }
  }
  public showVillage(): void {
    if(this.#flyover && !this.#flyover.landing) return;
    if (this.#transition.active) { this.#pendingView = 'village'; return; }
    this.#requestedWorld = false;
    this.#worldFromWheel = false;
    if (this.#mode === 'world') { this.#changeProjection(() => this.#returnToPlane(true)); return; }
    if (this.#space) {
      const p = this.#space.project(this.#villageAnchor); this.#camera.target.copyFromFloats(p.x, .45, p.z);
    }
    this.#camera.radius = this.#mode === 'village' ? VILLAGE_LANDING.radius : Math.max(90, this.#camera.radius);
    this.#setMode('village');
  }
  public rotateWorld(horizontal: number, vertical: number): void {
    if(this.#flyover) return;
    if (this.#mode === 'world' && this.#torusOverview) {
      this.#torusOverview.camera.alpha += horizontal * 0.13;
      this.#torusOverview.camera.beta = Math.max(0.08, Math.min(Math.PI - 0.08, this.#torusOverview.camera.beta + vertical * 0.13));
    }
  }
  public selectWorldCenter(): void {
    if(this.#flyover) return;
    if (this.#mode !== 'world' || !this.#torusOverview) return;
    const chosen = this.#torusOverview.select(this.#engine.getRenderWidth() / 2, this.#engine.getRenderHeight() / 2);
    if (chosen) { this.#worldTarget = chosen; this.#torusOverview.focus(chosen); this.#torusOverview.mark(this.#villageAnchor, chosen); }
  }
  #loadOverview(now: number): void {
    if (!this.#state || !this.#space || !this.#overviewAbort) return;
    const world = this.#state.world, signal = this.#overviewAbort.signal;
    const store = this.#store;
    if (!store) return;
    const center = this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
    const explicitOverview = this.#requestedWorld || this.#mode === 'region';
    const idleVillage = this.#mode === 'village' && now - this.#lastViewChangeAt >= 3_000
      && store.pending === 0 && this.#renderer?.queued === 0;
    if (!this.#overview && !this.#overviewLoading && now >= this.#overviewRetryAt && store.pending < 2
      && (explicitOverview || idleVillage && this.#renderer?.rendered(center.cellX, center.cellY))) {
      this.#overviewLoading = true;
      void getTerrainOverview(world.slug, signal).then((data) => {
        if (signal.aborted || data.world.id !== world.id || data.world.generationVersion !== world.generationVersion) return;
        const view = this.#torusOverview ?? new TorusOverview(this.#engine, data, this.#villageAnchor,
          this.#space!.inverse(this.#camera.target.x, this.#camera.target.z), () => this.#weather);
        view.setGeography(data); view.setGlobalModel(this.#globalModelAvailable());
        this.#overview = data; this.#regionalOverview.set(data); this.#torusOverview = view;
        if (this.#requestedWorld) this.showWorld();

      }).catch(() => { this.#overviewRetryAt = performance.now() + 5_000; })
        .finally(() => { if (!signal.aborted) this.#overviewLoading = false; });
    }
    const villageCenter = `${Math.floor(center.cellX / 128)},${Math.floor(center.cellY / 128)}`;
    if (this.#overview && !this.#villagesLoading && !this.#vegetationLoading && (now >= this.#villagesDue || villageCenter !== this.#villagesCenter)
      && store.pending < 2 && (explicitOverview || idleVillage)) {
      this.#villagesLoading = true; this.#villagesCenter = villageCenter;
      void getTerrainVillages(world.slug, center.cellX, center.cellY, signal).then(data => {
        if (signal.aborted || data.world.id !== world.id || data.world.generationVersion !== world.generationVersion) return;
        this.#regionalVillages.set(data); this.#villagesDue = performance.now() + 30_000;
      }).catch(() => { this.#villagesDue = performance.now() + 5_000; })
        .finally(() => { if (!signal.aborted) this.#villagesLoading = false; });
    }
    if (this.#overview && !this.#villagesLoading && !this.#vegetationLoading && now >= this.#vegetationDue && store.pending < 2
      && (explicitOverview || idleVillage || this.#mode === 'world')) {
      this.#vegetationLoading = true;
      void getTerrainVegetationOverview(world.slug, signal).then((data) => {
        if (signal.aborted || data.world.id !== world.id || data.world.generationVersion !== world.generationVersion) return;
        this.#regionalOverview.set(this.#overview!, data);
        this.#torusOverview?.setVegetation(data);
        this.#vegetationDue = performance.now() + Math.max(1_000, data.maxAgeMs - data.ageMs);
      }).catch(() => { this.#vegetationDue = performance.now() + 5_000; })
        .finally(() => { if (!signal.aborted) this.#vegetationLoading = false; });
    }
  }

  #streamTerrain(now: number): void {
    if (!this.#space || !this.#store || !this.#renderer || !this.#state) return;
    const started = performance.now();
    const detailPaused = (this.#mode !== 'village' || this.#arrival !== null) && (this.#camera.radius >= 160 || this.#requestedWorld);
    if (this.#store.paused && !detailPaused) { this.#viewSignature = ''; this.#demandAt = 0; }
    this.#store.setPaused(detailPaused);
    this.#renderer.setVisible(!detailPaused || !this.#overview);
    if (!detailPaused && now >= this.#demandAt) {
      const signature = [this.#space.version, this.#camera.alpha, this.#camera.beta, this.#camera.radius,
        this.#camera.target.x, this.#camera.target.z, this.#engine.getRenderWidth(), this.#engine.getRenderHeight()].join(':');
      const moved = signature !== this.#viewSignature;
      if (moved) {
      this.#viewSignature = signature;
      this.#lastViewChangeAt = now;
      const target = this.#space.inverse(this.#camera.target.x, this.#camera.target.z);
      const planes = Frustum.GetPlanes(this.#camera.getViewMatrix(true).multiply(this.#camera.getProjectionMatrix(true)));
      const size = this.#store.world.chunkSize;
      const intersects = (x: number, y: number, span: number) => {
        const anchor = { cellX: Math.floor(x / size) * size, cellY: Math.floor(y / size) * size };
        const p = this.#space!.projectFrom({ cellX: x, cellY: y }, anchor), margin = RENDER_UNIT_CELLS * TILE_SIZE;
        return new BoundingBox(new Vector3(p.x - TILE_SIZE / 2 - margin, -1, p.z - TILE_SIZE / 2 - margin),
          new Vector3(p.x + (span - 0.5) * TILE_SIZE + margin, 8, p.z + (span - 0.5) * TILE_SIZE + margin)).isInFrustum(planes);
      };
      const demand = terrainDemand(target, this.#space.width, this.#space.height, size, (x, y) => intersects(x * size, y * size, size));
      this.#terrainDemand = demand; this.#terrainIntersects = intersects; this.#store.demandChunks(demand);
      }
      if (moved || this.#terrainDemand.some(d => d.visible && this.#store!.changed.has(d.key)))
        this.#renderer.demand(this.#terrainDemand, this.#terrainIntersects);
      this.#demandAt = now + TERRAIN_STREAMING.coalesceMs;
    }
    if (document.visibilityState === 'visible') this.#store.tick(
      this.#overviewLoading || this.#vegetationLoading || this.#villagesLoading || this.#requestedWorld && !this.#overview ? 1 : TERRAIN_STREAMING.concurrentBatches);
    if (!detailPaused) this.#renderer.tick();
    const loading: TerrainStatus = this.#requestedWorld && !this.#torusOverview
      ? this.#overviewRetryAt > now ? 'retry' : 'loading'
      : detailPaused ? !this.#overview ? this.#overviewRetryAt > now ? 'retry' : 'loading' : null
      : this.#store.degraded ? 'retry' : this.#renderer.missingVisible ? 'loading' : null;
    if (loading !== this.#terrainLoading) { this.#terrainLoading = loading; this.#onTerrainLoading(loading); }
    if (this.#projectionVersion !== this.#renderer.version) {
      this.#projectionVersion = this.#renderer.version;
      this.#workers.reproject();
      this.#updateTravelPaths(this.#state, this.#showTravel, this.#selectedRoute);
    }
    this.#streamMs.push(performance.now() - started); if (this.#streamMs.length > 3600) this.#streamMs.shift();
    if (now < this.#metricsAt) return;
    this.#metricsAt = now + 1000;
    if (navigator.webdriver) {
      const viewport = this.#camera.viewport.toGlobal(this.#engine.getRenderWidth(), this.#engine.getRenderHeight());
      this.#canvas.dataset.woodlandScreens = JSON.stringify(this.#renderer.meshes().flatMap(mesh => {
        const meta = mesh.metadata as { woodlandId?: string; cellX: number; cellY: number } | null;
        if (!meta?.woodlandId || !this.#renderer!.rendered(meta.cellX, meta.cellY)) return [];
        const ground = this.#store!.ground(meta.cellX, meta.cellY);
        if (!ground) return [];
        const world = this.#space!.project(meta);
        const point = Vector3.Project(new Vector3(world.x, ground.height + 1.5, world.z), Matrix.Identity(), this.#scene.getTransformMatrix(), viewport);
        return [{ id: meta.woodlandId, x: point.x / this.#engine.getRenderWidth(), y: point.y / this.#engine.getRenderHeight() }];
      }));
    }
    this.#canvas.dataset.terrainStreaming = JSON.stringify({ origin: this.#space.origin, version: this.#space.version,
      resident: this.#renderer.residents.size, graphicPeak: this.#renderer.peakGraphicChunks, cached: this.#store.entries.size, queued: this.#renderer.queued,
      network: this.#store.pending, focusGround: this.#renderer.rendered(this.#space.inverse(this.#camera.target.x, this.#camera.target.z).cellX, this.#space.inverse(this.#camera.target.x, this.#camera.target.z).cellY), loaded: [...this.#renderer.residents.keys()],
      integrationP95: percentile(this.#renderer.integrationMs), integrationMax: Math.max(0, ...this.#renderer.integrationMs),
      integrationActiveP95: percentile(this.#renderer.activeIntegrationMs),
      slowestUnit: this.#renderer.slowestUnit,
      streamP95: percentile(this.#streamMs), streamMax: Math.max(0, ...this.#streamMs),
      meshes: this.#scene.meshes.length, geometries: this.#scene.geometries.length, materials: this.#scene.materials.length,
      drawCalls: this.#sceneStats?.drawCallsCounter.current ?? null,
      activeMeshesMs: this.#sceneStats?.activeMeshesEvaluationTimeCounter.current ?? null,
      nativeRenderMs: this.#sceneStats?.renderTimeCounter.current ?? null,
      mode: this.#mode, overview: Boolean(this.#overview), fogStart: this.#scene.fogStart, fogEnd: this.#scene.fogEnd,
      detailPaused, worldRequested: this.#requestedWorld,
      reducedQuality: this.#reducedQuality,
      frameP95: percentile(this.#frameMs) });
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
      this.#camera.beta = Math.max(
        lowerBeta,
        Math.min(upperBeta, this.#camera.beta + current.beta - previous.beta),
      );
    }
    this.#camera.fov = current.fov;
    this.#lastCameraRadius = this.#camera.radius;
  }

  public dispose(): void {
    window.removeEventListener('keydown',this.#flyoverKey,true);
    this.#villageBraziers?.dispose();
    this.#villageRoads?.dispose();
    this.#rain.dispose(); this.#weather?.dispose();
    this.#overviewAbort?.abort(); this.#torusOverview?.dispose(); this.#regionalOverview.dispose(); this.#regionalVillages.dispose(); this.#clouds.dispose();
    this.#sceneStats?.dispose();
    this.#canvas.removeEventListener('terrain-camera', this.#testCamera);
    this.#canvas.removeEventListener('terrain-metrics-reset', this.#testMetricsReset);
    window.removeEventListener('online', this.#resumeTerrain);
    document.removeEventListener('visibilitychange', this.#resumeTerrain);
    this.#renderer?.dispose(); this.#store?.dispose();
    this.#canvas.removeEventListener('pointerdown', this.#handlePointerDown, { capture: true });
    this.#canvas.removeEventListener('pointermove', this.#handlePointerMove, { capture: true });
    this.#canvas.removeEventListener('pointerup', this.#handlePointerUp, { capture: true });
    this.#canvas.removeEventListener('pointercancel', this.#handlePointerCancel, { capture: true });
    this.#canvas.removeEventListener('wheel', this.#handleWheel, { capture: true });
    this.#resizeObserver.disconnect();
    this.#workers.dispose();
    this.#scene.dispose();
    this.#engine.dispose();
    this.#canvas.width = 0;
    this.#canvas.height = 0;
  }
}
