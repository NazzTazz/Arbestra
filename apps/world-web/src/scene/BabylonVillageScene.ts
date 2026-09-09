import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import '@babylonjs/core/Culling/ray';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Mesh as BabylonMesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Rendering/edgesRenderer';
import { Scene } from '@babylonjs/core/scene';

import type { VillageCell, VillageState } from '@arbestra/contracts';

import type { ScreenAnchor } from '../ui/WorldContextMenu';
import { changedStoneFeatures, extractionTravel, stoneVisualSignature, terrainSignature } from './deposit-visuals';
import { cellKey, cellsAlongSegment, type AreaPreview, type Cell } from './construction-selection';

const CHUNK_CELLS = 8;
const TILE_SIZE = 2.5;

function wrappedCellDelta(value: number, origin: number, size: number): number {
  const direct = value - origin;
  if (direct > size / 2) return direct - size;
  if (direct < -size / 2) return direct + size;
  return direct;
}

export class BabylonVillageScene {
  readonly #engine: Engine;
  readonly #scene: Scene;
  readonly #camera: ArcRotateCamera;
  readonly #canvas: HTMLCanvasElement;
  readonly #villageMeshes: Mesh[] = [];
  readonly #terrainMeshes: Mesh[] = [];
  readonly #featureMeshes: Mesh[] = [];
  readonly #stoneGroups = new Map<string, { signature: string; meshes: Mesh[] }>();
  readonly #extractionPeople = new Map<string, { meshes: Mesh[]; target: Vector3; startedAt: number; completesAt: number }>();
  #selectedFeatureId: string | null = null;
  readonly #onFeatureSelected: (featureId: string, anchor: ScreenAnchor) => void;
  readonly #harvestPeople: Array<{ mesh: Mesh; target: Vector3; index: number; startedAt: number; completesAt: number }> = [];
  readonly #selectableMeshes = new Map<string, Mesh>();
  readonly #onSiteSelected: (siteId: string, anchor: ScreenAnchor) => void;
  readonly #onCameraMoved: () => void;
  readonly #onAreaGesture: (first: Cell, last: Cell, tap: boolean) => void;
  readonly #onGardenHarvest: (cell: Cell, newGesture: boolean) => void;
  readonly #previewMeshes: Mesh[] = [];
  readonly #invalidAreaMaterial: StandardMaterial;
  readonly #resizeObserver: ResizeObserver;
  readonly #siteMaterial: StandardMaterial;
  readonly #candidateMaterial: StandardMaterial;
  readonly #timberMaterial: StandardMaterial;
  readonly #lightTimberMaterial: StandardMaterial;
  readonly #darkTimberMaterial: StandardMaterial;
  readonly #roofMaterial: StandardMaterial;
  readonly #stoneMaterial: StandardMaterial;
  readonly #windowMaterial: StandardMaterial;
  readonly #soilMaterial: StandardMaterial;
  readonly #furrowMaterial: StandardMaterial;
  readonly #leafMaterial: StandardMaterial;
  readonly #leafLightMaterial: StandardMaterial;
  readonly #leafDarkMaterial: StandardMaterial;
  readonly #trunkMaterial: StandardMaterial;
  readonly #reservedGardenMaterial: StandardMaterial;
  readonly #constructionMaterial: StandardMaterial;
  readonly #scaffoldMaterial: StandardMaterial;
  readonly #selectionMaterial: StandardMaterial;
  readonly #contactShadowMaterial: StandardMaterial;
  readonly #packedEarthMaterial: StandardMaterial;
  readonly #sawdustMaterial: StandardMaterial;
  readonly #selectionMarker: Mesh;
  readonly #deepGround: Mesh;
  readonly #reducedQuality = navigator.webdriver;
  #buildableGrid: Mesh | null = null;
  #selectedSiteId: string | null = null;
  #highlightedSiteIds = new Set<string>();
  #constructionMode = false;
  #selectingArea = false;
  #harvestableSites = new Set<string>();
  #fullGardenSites = new Set<string>();
  #harvestVisited = new Set<string>();
  #villageAnchor: Cell = { cellX: 0, cellY: 0 };
  #pointerDown: { x: number; y: number; pointerId: number; mouseArea: boolean; harvest: boolean; first: Cell | null; last: Cell | null } | null = null;
  #lastDragCell = '';
  #lastPreviewSignature = '';
  #lastVisualSignature = '';
  #lastTerrainSignature = '';
  #lastFeatureSignature = '';
  #lastHarvestSignature = '';
  #serverOffsetMs = 0;
  #lastFrameAt = 0;
  #lastCameraRadius: number | null = null;
  #worldWidthUnits = 2048 * TILE_SIZE;
  #worldHeightUnits = 1024 * TILE_SIZE;

  readonly #handlePointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary) { this.#pointerDown = null; return; }
    if (event.button !== 0) return;
    const mouseArea = this.#selectingArea && event.pointerType !== 'touch';
    const first = this.#cellAtPointer(event);
    const harvest = !this.#selectingArea && first !== null && this.#harvestableSites.has(cellKey(first));
    this.#pointerDown = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, mouseArea, harvest, first, last: first };
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
      const last = this.#cellAtPointer(event), previous = this.#pointerDown.last;
      if (last && previous && cellKey(last) !== cellKey(previous)) {
        for (const cell of cellsAlongSegment(previous, last, { widthCells: this.#worldWidthUnits / TILE_SIZE, heightCells: this.#worldHeightUnits / TILE_SIZE })) {
          if (!this.#harvestVisited.has(cellKey(cell))) { this.#harvestVisited.add(cellKey(cell)); this.#onGardenHarvest(cell, false); }
        }
        this.#pointerDown.last = last;
      }
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
    if (!this.#pointerDown || this.#pointerDown.pointerId !== event.pointerId) return;
    const gesture = this.#pointerDown;
    if (gesture.harvest) {
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
    const featureId = picked.pickedMesh?.metadata?.featureId as string | undefined;
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
    this.#pointerDown = null;
  };
  readonly #handleWheel = (): void => this.#clearSelection();

  public constructor(
    canvas: HTMLCanvasElement,
    onSiteSelected: (siteId: string, anchor: ScreenAnchor) => void,
    onCameraMoved: () => void,
    onAreaGesture: (first: Cell, last: Cell, tap: boolean) => void,
    onFeatureSelected: (featureId: string, anchor: ScreenAnchor) => void = () => {},
    onGardenHarvest: (cell: Cell, newGesture: boolean) => void = () => {},
  ) {
    this.#canvas = canvas;
    this.#onFeatureSelected = onFeatureSelected;
    this.#onSiteSelected = onSiteSelected;
    this.#onCameraMoved = onCameraMoved;
    this.#onAreaGesture = onAreaGesture;
    this.#onGardenHarvest = onGardenHarvest;
    this.#engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
    this.#engine.setHardwareScalingLevel(Math.max(this.#reducedQuality ? 4 : 1.2, window.devicePixelRatio / 1.5));
    this.#scene = new Scene(this.#engine);
    this.#scene.skipPointerMovePicking = true;
    this.#scene.clearColor = Color4.FromHexString('#8ea0a0ff');
    this.#scene.imageProcessingConfiguration.exposure = 0.92;
    this.#scene.imageProcessingConfiguration.contrast = 1.18;

    this.#camera = new ArcRotateCamera(
      'strategic-camera',
      -Math.PI / 2 + 0.9,
      0.84,
      window.innerWidth < 600 ? 42 : 38,
      new Vector3(0, 0.45, 0),
      this.#scene,
    );
    this.#camera.fov = 0.55;
    this.#camera.lowerRadiusLimit = 8;
    this.#camera.upperRadiusLimit = 120;
    this.#camera.lowerBetaLimit = 0.05;
    this.#camera.upperBetaLimit = 0.95;
    this.#camera.panningSensibility = 105;
    this.#camera.panningAxis = new Vector3(1, 0, 1);
    this.#camera.wheelDeltaPercentage = 0.008;
    this.#camera.pinchDeltaPercentage = 0.008;
    this.#camera.inertia = 0.72;
    this.#camera.attachControl(canvas, true);

    const daylight = new HemisphericLight('daylight', new Vector3(-0.35, 1, -0.25), this.#scene);
    daylight.diffuse = new Color3(0.92, 0.94, 0.79);
    daylight.groundColor = new Color3(0.18, 0.22, 0.14);
    daylight.intensity = 0.58;
    const sun = new DirectionalLight('sun', new Vector3(-0.62, -1, 0.42), this.#scene);
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
    this.#windowMaterial = this.#material('window', '#d6a44e', 1, '#35240f');
    this.#soilMaterial = this.#material('soil', '#684025');
    this.#furrowMaterial = this.#material('furrow', '#38241a');
    this.#leafMaterial = this.#material('leaves', '#3f6c35');
    this.#leafLightMaterial = this.#material('leaves-light', '#668442');
    this.#leafDarkMaterial = this.#material('leaves-dark', '#294e2d');
    this.#trunkMaterial = this.#material('trunk', '#523620');
    this.#reservedGardenMaterial = this.#material('garden-reserved', '#bd8a43', 0.54);
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
    for (const material of this.#scene.materials) material.freeze();

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

    this.#resizeObserver = new ResizeObserver(() => this.#engine.resize());
    this.#resizeObserver.observe(canvas);
    this.#engine.runRenderLoop(() => {
      const now = performance.now();
      if (now - this.#lastFrameAt < 1_000 / (this.#reducedQuality ? 5 : 45)) return;
      this.#wrapCamera();
      this.#updateCameraProfile();
      this.#animateHarvestPeople();
      this.#animateExtractionPeople();
      this.#scene.render();
      this.#lastFrameAt = performance.now();
    });
  }

  public update(state: VillageState, highlightedSiteIds: string[] = [], constructionMode = false): void {
    this.#villageAnchor = { cellX: state.village.anchorCellX, cellY: state.village.anchorCellY };
    this.#worldWidthUnits = state.world.widthCells * TILE_SIZE;
    this.#worldHeightUnits = state.world.heightCells * TILE_SIZE;
    this.#deepGround.scaling.set(state.world.widthCells / 2048, 1, state.world.heightCells / 1024);
    this.#updateTerrain(state);
    this.#createWorldFeatures(state);
    this.#serverOffsetMs = Date.now() - Date.parse(state.serverTime);
    const plots = state.cells.flatMap((cell) => cell.building?.garden?.plots ?? []);
    this.#harvestableSites = new Set(plots.filter((plot) => plot.storedCarrots >= 1 && !plot.harvest).map(cellKey));
    this.#fullGardenSites = new Set(plots.filter((plot) => plot.full && !plot.harvest).map(cellKey));
    this.#updateHarvestPeople(state);
    this.#updateExtractionPeople(state);
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
        this.#fullGardenSites.has(site.id),
      ]),
    });
    if (visualSignature === this.#lastVisualSignature) return;
    this.#lastVisualSignature = visualSignature;
    for (const mesh of this.#villageMeshes.splice(0)) mesh.dispose(false, false);
    this.#selectableMeshes.clear();
    this.#highlightedSiteIds = new Set(highlightedSiteIds);
    this.#constructionMode = constructionMode;
    this.#updateBuildableGrid(state.cells);
    for (const site of state.cells) {
      const mesh = site.building?.status === 'under-construction'
        ? this.#createConstructionSite(site)
        : site.footprint?.buildingType === 'garden'
          ? this.#createGardenExtension(site)
          : site.building
            ? this.#createBuilding(site)
            : this.#createAvailableSite(site);
      for (const selectable of [mesh, ...mesh.getChildMeshes()]) {
        selectable.metadata = { ...selectable.metadata, siteId: site.id };
        selectable.isPickable = Boolean(site.footprint || this.#constructionMode && site.canBuild);
      }
      this.#villageMeshes.push(mesh);
      this.#selectableMeshes.set(site.id, mesh);
    }
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
    const bounds = this.#canvas.getBoundingClientRect();
    const ray = this.#scene.createPickingRay(event.clientX - bounds.left, event.clientY - bounds.top, Matrix.Identity(), this.#camera);
    if (Math.abs(ray.direction.y) < 0.00001) return null;
    const distance = (0.075 - ray.origin.y) / ray.direction.y;
    if (distance < 0) return null;
    const width = this.#worldWidthUnits / TILE_SIZE, height = this.#worldHeightUnits / TILE_SIZE;
    const x = Math.round((ray.origin.x + ray.direction.x * distance) / TILE_SIZE) + this.#villageAnchor.cellX;
    const y = Math.round((ray.origin.z + ray.direction.z * distance) / TILE_SIZE) + this.#villageAnchor.cellY;
    return { cellX: ((x % width) + width) % width, cellY: ((y % height) + height) % height };
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
      mesh.position.set(
        wrappedCellDelta(cell.cellX, this.#villageAnchor.cellX, this.#worldWidthUnits / TILE_SIZE) * TILE_SIZE,
        0.15,
        wrappedCellDelta(cell.cellY, this.#villageAnchor.cellY, this.#worldHeightUnits / TILE_SIZE) * TILE_SIZE,
      );
      mesh.material = obstacles.has(cellKey(cell)) ? this.#invalidAreaMaterial
        : existing.has(cellKey(cell)) ? this.#selectionMaterial
          : invalid && !preview?.newCells ? this.#invalidAreaMaterial : this.#candidateMaterial;
      mesh.isPickable = false;
      this.#previewMeshes.push(mesh);
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

  #createTerrain(): Mesh {
    const earth = MeshBuilder.CreateBox('deep-ground', {
      width: this.#worldWidthUnits * 3,
      depth: this.#worldHeightUnits * 3,
      height: 0.8,
    }, this.#scene);
    earth.position.y = -0.46;
    earth.material = this.#material('deep-earth', '#4c4b2d');
    earth.receiveShadows = true;
    earth.isPickable = false;
    return earth;
  }

  #updateTerrain(state: VillageState): void {
    const signature = terrainSignature(state);
    if (signature === this.#lastTerrainSignature) return;
    this.#lastTerrainSignature = signature;
    for (const mesh of this.#terrainMeshes.splice(0)) mesh.dispose(false, false);

    const material = this.#material('generated-ground', '#ffffff');
    material.specularColor.set(0, 0, 0);
    const colorsByTerrain = new Map([
      [1, Color3.FromHexString('#536b37')],
      [2, Color3.FromHexString('#456f78')],
      [3, Color3.FromHexString('#686a5f')],
    ]);

    for (let chunkX = 0; chunkX < state.region.width; chunkX += CHUNK_CELLS) {
      for (let chunkY = 0; chunkY < state.region.height; chunkY += CHUNK_CELLS) {
        const positions: number[] = [];
        const indices: number[] = [];
        const normals: number[] = [];
        const colors: number[] = [];
        for (let localX = 0; localX < CHUNK_CELLS; localX += 1) {
          for (let localY = 0; localY < CHUNK_CELLS; localY += 1) {
            const regionX = chunkX + localX;
            const regionY = chunkY + localY;
            const index = regionY * state.region.width + regionX;
            const worldCellX = (state.region.originCellX + regionX) % state.world.widthCells;
            const worldCellY = (state.region.originCellY + regionY) % state.world.heightCells;
            const centerX = wrappedCellDelta(worldCellX, state.village.anchorCellX, state.world.widthCells) * TILE_SIZE;
            const centerZ = wrappedCellDelta(worldCellY, state.village.anchorCellY, state.world.heightCells) * TILE_SIZE;
            const elevation = (state.region.elevations[index] ?? 0) * 0.025;
            const first = positions.length / 3;
            positions.push(
              centerX - TILE_SIZE / 2, elevation, centerZ - TILE_SIZE / 2,
              centerX + TILE_SIZE / 2, elevation, centerZ - TILE_SIZE / 2,
              centerX + TILE_SIZE / 2, elevation, centerZ + TILE_SIZE / 2,
              centerX - TILE_SIZE / 2, elevation, centerZ + TILE_SIZE / 2,
            );
            indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
            const base = colorsByTerrain.get(state.region.terrainCodes[index] ?? 1) ?? colorsByTerrain.get(1)!;
            const shade = 0.975 + this.#hash(worldCellX, worldCellY) * 0.05;
            for (let vertex = 0; vertex < 4; vertex += 1) colors.push(base.r * shade, base.g * shade, base.b * shade, 1);
          }
        }
        VertexData.ComputeNormals(positions, indices, normals);
        const data = new VertexData();
        data.positions = positions;
        data.indices = indices;
        data.normals = normals;
        data.colors = colors;
        const mesh = new BabylonMesh(`generated-terrain-${chunkX}-${chunkY}`, this.#scene);
        data.applyToMesh(mesh);
        mesh.material = material;
        mesh.receiveShadows = true;
        mesh.isPickable = false;
        this.#terrainMeshes.push(mesh);
      }
    }
    material.freeze();
  }

  #createWorldFeatures(state: VillageState): void {
    this.#updateStoneFeatures(state);
    const signature = terrainSignature(state);
    if (signature === this.#lastFeatureSignature) return;
    this.#lastFeatureSignature = signature;
    for (const mesh of this.#featureMeshes.splice(0)) mesh.dispose(false, false);
    const scenery: Mesh[] = [];
    for (const feature of state.region.features) {
      const x = wrappedCellDelta(feature.cellX, state.village.anchorCellX, state.world.widthCells) * TILE_SIZE;
      const z = wrappedCellDelta(feature.cellY, state.village.anchorCellY, state.world.heightCells) * TILE_SIZE;
      const localX = wrappedCellDelta(feature.cellX, state.region.originCellX, state.world.widthCells);
      const localY = wrappedCellDelta(feature.cellY, state.region.originCellY, state.world.heightCells);
      const elevationIndex = localY * state.region.width + localX;
      const elevation = (state.region.elevations[elevationIndex] ?? 0) * 0.025;
      const seed = Math.abs(feature.variantSeed);
      if (feature.type === 'woodland') {
        const count = 2 + seed % 3;
        for (let tree = 0; tree < count; tree += 1) {
          const angle = this.#hash(seed, tree + 401) * Math.PI * 2;
          const radius = 0.22 + this.#hash(seed, tree + 419) * 0.48;
          this.#createTree(
            x + Math.cos(angle) * radius,
            z + Math.sin(angle) * radius,
            0.48 + this.#hash(seed, tree + 431) * 0.22,
            (seed + tree) % 3,
            scenery,
            elevation,
          );
        }
      }
    }
    this.#featureMeshes.push(...this.#mergeStaticScenery(scenery));
  }

  #updateStoneFeatures(state: VillageState): void {
    const origin = terrainSignature(state);
    const previous = new Map([...this.#stoneGroups].map(([id, group]) => [id, group.signature]));
    const diff = changedStoneFeatures(previous, state.region.features, origin);
    for (const id of [...diff.removed, ...diff.changed.map((feature) => feature.id)]) {
      for (const mesh of this.#stoneGroups.get(id)?.meshes ?? []) mesh.dispose(false, false);
      this.#stoneGroups.delete(id);
    }
    for (const feature of diff.changed) {
      const meshes: Mesh[] = [];
      if (feature.deposit && feature.deposit.state !== 'depleted') {
        const x = wrappedCellDelta(feature.cellX, state.village.anchorCellX, state.world.widthCells) * TILE_SIZE;
        const z = wrappedCellDelta(feature.cellY, state.village.anchorCellY, state.world.heightCells) * TILE_SIZE;
        const localX = wrappedCellDelta(feature.cellX, state.region.originCellX, state.world.widthCells);
        const localY = wrappedCellDelta(feature.cellY, state.region.originCellY, state.world.heightCells);
        const elevation = (state.region.elevations[localY * state.region.width + localX] ?? 0) * 0.025;
        const seed = Math.abs(feature.variantSeed);
        const scale = (0.58 + this.#hash(seed, 443) * 0.35)
          * (0.55 + 0.45 * feature.deposit.remainingAmount / feature.deposit.initialAmount);
        this.#createRockCluster(x, z, scale, seed, meshes, elevation);
        for (const mesh of meshes) {
          mesh.metadata = { featureId: feature.id };
          mesh.isPickable = true;
        }
      }
      this.#stoneGroups.set(feature.id, { signature: stoneVisualSignature(feature, origin), meshes });
    }
    this.#applyFeatureSelection();
  }

  #applyFeatureSelection(): void {
    for (const [id, group] of this.#stoneGroups) for (const mesh of group.meshes) {
      if (id === this.#selectedFeatureId) {
        mesh.enableEdgesRendering();
        mesh.edgesColor.set(0.95, 0.85, 0.3, 1);
        mesh.edgesWidth = 3;
      } else mesh.disableEdgesRendering();
    }
  }

  #updateExtractionPeople(state: VillageState): void {
    const active = new Set(state.village.extractions.map((work) => work.id));
    for (const [id, group] of this.#extractionPeople) if (!active.has(id)) {
      for (const mesh of group.meshes) mesh.dispose(false, false);
      this.#extractionPeople.delete(id);
    }
    for (const work of state.village.extractions) {
      const existing = this.#extractionPeople.get(work.id);
      if (existing) continue;
      const meshes = Array.from({ length: work.workerCount }, (_, index) => {
        const mesh = MeshBuilder.CreateBox(`extraction-person-${work.id}-${index}`, { width: 0.22, height: 0.42, depth: 0.22 }, this.#scene);
        mesh.material = this.#darkTimberMaterial;
        mesh.isPickable = false;
        return mesh;
      });
      this.#extractionPeople.set(work.id, { meshes, startedAt: Date.parse(work.startedAt), completesAt: Date.parse(work.completesAt),
        target: new Vector3(wrappedCellDelta(work.cellX, state.village.anchorCellX, state.world.widthCells) * TILE_SIZE, 0.33,
          wrappedCellDelta(work.cellY, state.village.anchorCellY, state.world.heightCells) * TILE_SIZE) });
    }
  }

  #animateExtractionPeople(): void {
    const now = Date.now() - this.#serverOffsetMs;
    for (const group of this.#extractionPeople.values()) {
      const fraction = extractionTravel(now, group.startedAt, group.completesAt);
      for (const [index, mesh] of group.meshes.entries()) {
        const target = group.target.add(new Vector3(Math.cos(index * 2.4) * 0.65, 0, Math.sin(index * 2.4) * 0.65));
        mesh.position.copyFrom(Vector3.Lerp(new Vector3(0, 0.33, 0), target, fraction));
      }
    }
  }

  #updateHarvestPeople(state: VillageState): void {
    const gardens = state.cells.flatMap((cell) => cell.building?.garden?.plots.flatMap((plot) => plot.harvest
      ? [{ plot, harvest: plot.harvest }] : []) ?? []);
    const signature = JSON.stringify(gardens.map(({ plot, harvest }) => [plot.cellX, plot.cellY, harvest.id, harvest.startedAt, harvest.completesAt]));
    if (signature === this.#lastHarvestSignature) return;
    this.#lastHarvestSignature = signature;
    for (const person of this.#harvestPeople.splice(0)) person.mesh.dispose(false, false);
    for (const [index, garden] of gardens.entries()) {
      const cell = state.cells.find((item) => item.cellX === garden.plot.cellX && item.cellY === garden.plot.cellY);
      if (!cell) continue;
      const mesh = MeshBuilder.CreateBox(`harvest-person-${garden.harvest.id}`, { width: 0.22, height: 0.42, depth: 0.22 }, this.#scene);
      mesh.material = this.#darkTimberMaterial;
      mesh.isPickable = false;
      mesh.position.set(cell.x, 0.33, cell.z);
      this.#harvestPeople.push({ mesh, target: new Vector3(cell.x, 0.33, cell.z), index,
        startedAt: Date.parse(garden.harvest.startedAt), completesAt: Date.parse(garden.harvest.completesAt) });
    }
  }

  #animateHarvestPeople(): void {
    if (this.#harvestPeople.length === 0) return;
    const serverNow = Date.now() - this.#serverOffsetMs;
    const origin = new Vector3(0, 0.33, 0);
    for (const person of this.#harvestPeople) {
      const fraction = Math.max(0, Math.min(1, (serverNow - person.startedAt) / (person.completesAt - person.startedAt)));
      const roundTrip = fraction <= 0.5 ? fraction * 2 : (1 - fraction) * 2;
      const wobble = Math.sin((fraction * 80) + person.index) * 0.04;
      person.mesh.position.copyFrom(Vector3.Lerp(origin, person.target, roundTrip));
      person.mesh.position.y += wobble;
    }
  }

  #updateBuildableGrid(cells: VillageCell[]): void {
    this.#buildableGrid?.dispose();
    const segments = new Map<string, [Vector3, Vector3]>();
    const edgeCounts = new Map<string, number>();
    const add = (from: Vector3, to: Vector3): void => {
      const a = `${from.x}:${from.z}`;
      const b = `${to.x}:${to.z}`;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      segments.set(key, [from, to]);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    };
    const y = 0.105;
    const half = TILE_SIZE / 2;
    for (const cell of cells) {
      const northWest = new Vector3(cell.x - half, y, cell.z - half);
      const northEast = new Vector3(cell.x + half, y, cell.z - half);
      const southEast = new Vector3(cell.x + half, y, cell.z + half);
      const southWest = new Vector3(cell.x - half, y, cell.z + half);
      add(northWest, northEast);
      add(northEast, southEast);
      add(southEast, southWest);
      add(southWest, northWest);
    }
    const lines = [...segments].filter(([key]) => this.#constructionMode || edgeCounts.get(key) === 1).map(([, segment]) => segment);
    const grid = lines.length > 0
      ? MeshBuilder.CreateLineSystem(
          'buildable-grid',
          { lines },
          this.#scene,
        )
      : null;
    this.#buildableGrid = grid;
    if (!grid) return;
    grid.color = Color3.FromHexString('#738352');
    grid.visibility = 0.26;
    grid.isPickable = false;
  }

  #createTree(
    x: number,
    z: number,
    scale: number,
    variant: number,
    scenery: Mesh[],
    baseY = 0,
  ): void {
    const serial = `${Math.round(x * 10)}-${Math.round(z * 10)}`;
    const trunk = MeshBuilder.CreateCylinder(
      `tree-trunk-${serial}`,
      { height: 1.1, diameterTop: 0.22, diameterBottom: 0.38, tessellation: 6 },
      this.#scene,
    );
    trunk.material = this.#trunkMaterial;
    const lower = MeshBuilder.CreateCylinder(
      `tree-lower-${serial}`,
      {
        height: variant === 1 ? 1.35 : 1.55,
        diameterTop: 0.16,
        diameterBottom: variant === 2 ? 1.8 : 1.55,
        tessellation: 7,
      },
      this.#scene,
    );
    lower.material = variant === 2 ? this.#leafDarkMaterial : this.#leafMaterial;
    const upper = MeshBuilder.CreateCylinder(
      `tree-upper-${serial}`,
      { height: 1.25, diameterTop: 0.04, diameterBottom: 1.15, tessellation: 7 },
      this.#scene,
    );
    upper.material = variant === 0 ? this.#leafLightMaterial : this.#leafMaterial;
    const rotation = this.#hash(Math.round(x * 10), Math.round(z * 10)) * Math.PI;
    trunk.position.set(x, baseY + 0.5 * scale, z);
    lower.position.set(x, baseY + 1.48 * scale, z);
    upper.position.set(x, baseY + 2.22 * scale, z);
    trunk.scaling.setAll(scale);
    lower.scaling.setAll(scale);
    upper.scaling.setAll(scale);
    trunk.rotation.y = rotation;
    lower.rotation.y = rotation + 0.15;
    upper.rotation.y = rotation - 0.12;
    trunk.isPickable = false;
    lower.isPickable = false;
    upper.isPickable = false;
    scenery.push(trunk, lower, upper);
  }

  #createRockCluster(x: number, z: number, scale: number, index: number, sceneryMeshes: Mesh[], baseY = 0): void {
    for (let part = 0; part < (index % 3 === 0 ? 3 : 2); part += 1) {
      const rock = MeshBuilder.CreateIcoSphere(`rock-${index}-${part}`, { radius: scale * (0.42 - part * 0.07), subdivisions: 1 }, this.#scene);
      rock.position.set(x + part * scale * 0.42, baseY + scale * (0.3 - part * 0.03), z + (part % 2) * scale * 0.28);
      rock.scaling.set(1, 0.72, 0.86);
      rock.rotation.set(part * 0.24, this.#hash(index, part + 251) * Math.PI, part * -0.16);
      rock.material = this.#stoneMaterial;
      rock.isPickable = false;
      sceneryMeshes.push(rock);
    }
  }

  #mergeStaticScenery(meshes: Mesh[]): Mesh[] {
    const byMaterial = new Map<StandardMaterial, Mesh[]>();
    for (const mesh of meshes) {
      if (mesh.parent) mesh.setParent(null);
      const material = mesh.material;
      if (!(material instanceof StandardMaterial)) continue;
      const group = byMaterial.get(material) ?? [];
      group.push(mesh);
      byMaterial.set(material, group);
    }
    const mergedMeshes: Mesh[] = [];
    for (const [material, group] of byMaterial) {
      const merged = BabylonMesh.MergeMeshes(group, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = `scenery-${material.name}`;
      merged.isPickable = false;
      merged.freezeWorldMatrix();
      mergedMeshes.push(merged);
    }
    return mergedMeshes;
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
    const body = MeshBuilder.CreateBox(`town-hall-${site.id}`, { width: 2.45, depth: 2.15, height: 1.72 }, this.#scene);
    body.position.set(site.x, 0.94, site.z);
    body.material = this.#timberMaterial;
    const base = MeshBuilder.CreateBox(`town-hall-base-${site.id}`, { width: 2.75, depth: 2.45, height: 0.22 }, this.#scene);
    base.parent = body;
    base.position.y = -0.82;
    base.material = this.#stoneMaterial;
    const roof = MeshBuilder.CreateCylinder(`town-hall-roof-${site.id}`, { height: 1.08, diameterTop: 0, diameterBottom: 3.25, tessellation: 4 }, this.#scene);
    roof.parent = body;
    roof.position.y = 1.28;
    roof.rotation.y = Math.PI / 4;
    roof.material = this.#roofMaterial;
    const door = MeshBuilder.CreateBox(`town-hall-door-${site.id}`, { width: 0.55, height: 0.92, depth: 0.08 }, this.#scene);
    door.parent = body;
    door.position.set(0, -0.38, -1.1);
    door.material = this.#darkTimberMaterial;
    for (const x of [-0.72, 0.72]) {
      const window = MeshBuilder.CreateBox(`town-hall-window-${site.id}-${x}`, { width: 0.36, height: 0.36, depth: 0.07 }, this.#scene);
      window.parent = body;
      window.position.set(x, 0.15, -1.1);
      window.material = this.#windowMaterial;
    }
    for (const x of [-1.02, 1.02]) {
      for (const z of [-0.86, 0.86]) {
        const post = MeshBuilder.CreateBox(`town-hall-post-${site.id}-${x}-${z}`, { width: 0.13, depth: 0.13, height: 1.62 }, this.#scene);
        post.parent = body;
        post.position.set(x, 0, z);
        post.material = this.#darkTimberMaterial;
      }
    }
    const chimney = MeshBuilder.CreateBox(`town-hall-chimney-${site.id}`, { width: 0.32, depth: 0.34, height: 1.12 }, this.#scene);
    chimney.parent = body;
    chimney.position.set(0.68, 1.08, 0.38);
    chimney.material = this.#stoneMaterial;
    const frontBeam = MeshBuilder.CreateBox(`town-hall-front-beam-${site.id}`, { width: 2.16, depth: 0.1, height: 0.13 }, this.#scene);
    frontBeam.parent = body;
    frontBeam.position.set(0, 0.54, -1.08);
    frontBeam.material = this.#darkTimberMaterial;
    const porch = MeshBuilder.CreateBox(`town-hall-porch-${site.id}`, { width: 1.05, depth: 0.62, height: 0.1 }, this.#scene);
    porch.parent = body;
    porch.position.set(0, 0.03, -1.34);
    porch.rotation.x = -0.14;
    porch.material = this.#roofMaterial;
    for (const x of [-0.42, 0.42]) {
      const porchPost = MeshBuilder.CreateBox(`town-hall-porch-post-${site.id}-${x}`, { width: 0.09, depth: 0.09, height: 0.62 }, this.#scene);
      porchPost.parent = body;
      porchPost.position.set(x, -0.31, -1.54);
      porchPost.material = this.#darkTimberMaterial;
    }
    this.#createContactShadow(body, 2.75, 2.45);
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
    const plot = MeshBuilder.CreateBox(`garden-${site.id}`, { width: TILE_SIZE, depth: TILE_SIZE, height: 0.1 }, this.#scene);
    plot.position.set(site.x, 0.11, site.z);
    plot.material = reserved ? this.#reservedGardenMaterial : this.#soilMaterial;
    for (const offset of [-0.58, 0, 0.58]) {
      const furrow = MeshBuilder.CreateBox(`furrow-${site.id}-${offset}`, { width: 1.92, depth: 0.12, height: 0.045 }, this.#scene);
      furrow.parent = plot;
      furrow.position.set(0, 0.075, offset);
      furrow.material = this.#furrowMaterial;
    }
    if (!reserved) {
      for (const [x, z] of [[-0.58, -0.29], [0, 0.29], [0.58, -0.29]] as const) {
        const sprout = MeshBuilder.CreateCylinder(`sprout-${site.id}-${x}-${z}`, { height: 0.22, diameterTop: 0, diameterBottom: 0.18, tessellation: 4 }, this.#scene);
        sprout.parent = plot;
        sprout.position.set(x, 0.18, z);
        sprout.material = this.#leafMaterial;
      }
      if (this.#fullGardenSites.has(site.id)) {
        const marker = MeshBuilder.CreateCylinder(`garden-full-${site.id}`, { height: 0.12, diameter: 0.62, tessellation: 16 }, this.#scene);
        marker.parent = plot; marker.position.set(0, 1.05, 0); marker.material = this.#windowMaterial; marker.isPickable = false;
        const stem = MeshBuilder.CreateCylinder(`garden-full-stem-${site.id}`, { height: 0.34, diameter: 0.08, tessellation: 8 }, this.#scene);
        stem.parent = plot; stem.position.set(0, 0.83, 0); stem.material = this.#leafDarkMaterial; stem.isPickable = false;
      }
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
    const target = this.#camera.target;
    const x = ((target.x + this.#worldWidthUnits / 2) % this.#worldWidthUnits + this.#worldWidthUnits) % this.#worldWidthUnits
      - this.#worldWidthUnits / 2;
    const z = ((target.z + this.#worldHeightUnits / 2) % this.#worldHeightUnits + this.#worldHeightUnits) % this.#worldHeightUnits
      - this.#worldHeightUnits / 2;
    if (x !== target.x || z !== target.z || target.y !== 0.45) this.#camera.setTarget(new Vector3(x, 0.45, z));
  }

  #updateCameraProfile(): void {
    const minimum = this.#camera.lowerRadiusLimit ?? 8;
    const maximum = this.#camera.upperRadiusLimit ?? 120;
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
    this.#canvas.removeEventListener('pointerdown', this.#handlePointerDown, { capture: true });
    this.#canvas.removeEventListener('pointermove', this.#handlePointerMove, { capture: true });
    this.#canvas.removeEventListener('pointerup', this.#handlePointerUp, { capture: true });
    this.#canvas.removeEventListener('pointercancel', this.#handlePointerCancel, { capture: true });
    this.#canvas.removeEventListener('wheel', this.#handleWheel, { capture: true });
    this.#resizeObserver.disconnect();
    for (const person of this.#harvestPeople.splice(0)) person.mesh.dispose(false, false);
    this.#scene.dispose();
    this.#engine.dispose();
    this.#canvas.width = 0;
    this.#canvas.height = 0;
  }
}
