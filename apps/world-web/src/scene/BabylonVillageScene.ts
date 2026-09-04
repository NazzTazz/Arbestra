import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
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

const WORLD_CELLS = 64;
const CHUNK_CELLS = 8;
const TILE_SIZE = 2.5;

export class BabylonVillageScene {
  readonly #engine: Engine;
  readonly #scene: Scene;
  readonly #camera: ArcRotateCamera;
  readonly #canvas: HTMLCanvasElement;
  readonly #villageMeshes: Mesh[] = [];
  readonly #selectableMeshes = new Map<string, Mesh>();
  readonly #onSiteSelected: (siteId: string, anchor: ScreenAnchor) => void;
  readonly #onCameraMoved: () => void;
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
  readonly #flowerMaterial: StandardMaterial;
  readonly #reservedGardenMaterial: StandardMaterial;
  readonly #constructionMaterial: StandardMaterial;
  readonly #scaffoldMaterial: StandardMaterial;
  readonly #selectionMaterial: StandardMaterial;
  readonly #contactShadowMaterial: StandardMaterial;
  readonly #packedEarthMaterial: StandardMaterial;
  readonly #sawdustMaterial: StandardMaterial;
  readonly #selectionMarker: Mesh;
  readonly #deepGround: Mesh;
  readonly #treePrototypes = new Map<number, { trunk: Mesh; lower: Mesh; upper: Mesh; shadow: Mesh }>();
  readonly #reducedQuality = navigator.webdriver;
  #selectedSiteId: string | null = null;
  #availableSiteId: string | null = null;
  #highlightedSiteIds = new Set<string>();
  #siteScreenPositions = new Map<string, { x: number; y: number }>();
  #pointerDown: { x: number; y: number } | null = null;
  #lastVisualSignature = '';
  #lastFrameAt = 0;
  #lastSitePositionsSignature = '';
  #lastAnchorPublishAt = 0;
  #worldWidthUnits = 2048 * TILE_SIZE;
  #worldHeightUnits = 1024 * TILE_SIZE;

  readonly #handlePointerDown = (event: PointerEvent): void => {
    this.#pointerDown = { x: event.clientX, y: event.clientY };
    const bounds = this.#canvas.getBoundingClientRect();
    const pointer = { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
    let nearest: { siteId: string; distance: number } | null = null;
    for (const [siteId, position] of this.#siteScreenPositions) {
      const distance = Math.hypot(pointer.x - position.x, pointer.y - position.y);
      if (!nearest || distance < nearest.distance) nearest = { siteId, distance };
    }
    if (nearest && nearest.distance < 0.1) this.selectSite(nearest.siteId, { x: event.clientX, y: event.clientY });
  };

  readonly #handlePointerMove = (event: PointerEvent): void => {
    if (!this.#pointerDown || Math.hypot(event.clientX - this.#pointerDown.x, event.clientY - this.#pointerDown.y) < 8) return;
    this.#pointerDown = null;
    this.#onCameraMoved();
  };

  readonly #handlePointerUp = (): void => { this.#pointerDown = null; };
  readonly #handleWheel = (): void => this.#onCameraMoved();

  public constructor(
    canvas: HTMLCanvasElement,
    onSiteSelected: (siteId: string, anchor: ScreenAnchor) => void,
    onCameraMoved: () => void,
  ) {
    this.#canvas = canvas;
    this.#onSiteSelected = onSiteSelected;
    this.#onCameraMoved = onCameraMoved;
    this.#engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
    this.#engine.setHardwareScalingLevel(Math.max(this.#reducedQuality ? 4 : 1.2, window.devicePixelRatio / 1.5));
    this.#scene = new Scene(this.#engine);
    this.#scene.skipPointerMovePicking = true;
    this.#scene.clearColor = Color4.FromHexString('#8ea0a0ff');
    this.#scene.fogMode = Scene.FOGMODE_LINEAR;
    this.#scene.fogStart = 45;
    this.#scene.fogEnd = 95;
    this.#scene.fogColor = Color3.FromHexString('#8ea0a0');
    this.#scene.imageProcessingConfiguration.exposure = 0.92;
    this.#scene.imageProcessingConfiguration.contrast = 1.18;

    this.#camera = new ArcRotateCamera(
      'strategic-camera',
      -Math.PI / 2 + 0.9,
      0.84,
      window.innerWidth < 600 ? 25 : 23,
      new Vector3(0, 0.45, 0),
      this.#scene,
    );
    this.#camera.fov = 0.5;
    this.#camera.lowerRadiusLimit = 16;
    this.#camera.upperRadiusLimit = 52;
    this.#camera.lowerBetaLimit = 0.68;
    this.#camera.upperBetaLimit = 1.05;
    this.#camera.panningSensibility = 105;
    this.#camera.panningAxis = new Vector3(1, 0, 1);
    this.#camera.wheelDeltaPercentage = 0.008;
    this.#camera.pinchDeltaPercentage = 0.008;
    this.#camera.inertia = 0.72;
    this.#camera.attachControl(canvas, true);

    const daylight = new HemisphericLight('daylight', new Vector3(-0.35, 1, -0.25), this.#scene);
    daylight.diffuse = new Color3(0.92, 0.94, 0.79);
    daylight.groundColor = new Color3(0.18, 0.22, 0.14);
    daylight.intensity = 0.62;
    const sun = new DirectionalLight('sun', new Vector3(-0.62, -1, 0.42), this.#scene);
    sun.diffuse = new Color3(1, 0.82, 0.58);
    sun.position = new Vector3(24, 34, -24);
    sun.intensity = 1.05;
    sun.shadowFrustumSize = 46;
    sun.autoCalcShadowZBounds = true;

    this.#siteMaterial = this.#material('available-site', '#647442', 0.42);
    this.#candidateMaterial = this.#material('extension-candidate', '#9ac866', 0.82, '#1c3510');
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
    this.#flowerMaterial = this.#material('field-flowers', '#ded8b2');
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
    this.#createScenery();
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
    canvas.addEventListener('pointercancel', this.#handlePointerUp, { capture: true });
    canvas.addEventListener('wheel', this.#handleWheel, { capture: true, passive: true });

    this.#resizeObserver = new ResizeObserver(() => this.#engine.resize());
    this.#resizeObserver.observe(canvas);
    this.#engine.runRenderLoop(() => {
      const now = performance.now();
      if (now - this.#lastFrameAt < 1_000 / (this.#reducedQuality ? 5 : 45)) return;
      this.#wrapCamera();
      this.#scene.render();
      if (now - this.#lastAnchorPublishAt >= 100) {
        this.#publishSitePositions();
        this.#lastAnchorPublishAt = now;
      }
      this.#lastFrameAt = performance.now();
    });
  }

  public update(state: VillageState, highlightedSiteIds: string[] = []): void {
    this.#worldWidthUnits = state.world.widthCells * TILE_SIZE;
    this.#worldHeightUnits = state.world.heightCells * TILE_SIZE;
    this.#deepGround.scaling.set(state.world.widthCells / 2048, 1, state.world.heightCells / 1024);
    this.#canvas.dataset.buildingCount = String(state.cells.filter((site) => site.building).length);
    this.#canvas.dataset.completedBuildingCount = String(state.cells.filter((site) => site.building?.status === 'completed').length);
    this.#canvas.dataset.underConstructionCount = String(state.cells.filter((site) => site.building?.status === 'under-construction').length);
    const visualSignature = JSON.stringify({
      highlightedSiteIds,
      sites: state.cells.map((site) => [
        site.id,
        site.canBuild,
        site.building?.type,
        site.building?.status,
        site.building?.level,
        site.building?.targetLevel,
        site.footprint?.state,
      ]),
    });
    if (visualSignature === this.#lastVisualSignature) return;
    this.#lastVisualSignature = visualSignature;
    for (const mesh of this.#villageMeshes.splice(0)) mesh.dispose(false, false);
    this.#selectableMeshes.clear();
    this.#availableSiteId = state.cells.find((site) => site.canBuild)?.id ?? null;
    this.#highlightedSiteIds = new Set(highlightedSiteIds);
    for (const site of state.cells) {
      const mesh = site.footprint?.buildingType === 'garden' && site.footprint.role === 'extension'
        ? this.#createGardenExtension(site)
        : site.building?.status === 'under-construction'
          ? this.#createConstructionSite(site)
          : site.building
            ? this.#createBuilding(site)
            : this.#createAvailableSite(site);
      mesh.metadata = { siteId: site.id };
      mesh.isPickable = true;
      this.#villageMeshes.push(mesh);
      this.#selectableMeshes.set(site.id, mesh);
    }
    this.#applySelection();
  }

  public selectSite(siteId: string, anchor: ScreenAnchor): void {
    if (!this.#selectableMeshes.has(siteId)) return;
    this.#selectedSiteId = siteId;
    this.#applySelection();
    this.#onSiteSelected(siteId, anchor);
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
    const groundMaterial = this.#material('living-ground', '#ffffff');
    groundMaterial.specularColor.set(0, 0, 0);
    const worldStart = -(WORLD_CELLS * TILE_SIZE) / 2;
    const groundColor = Color3.FromHexString('#536b37');

    for (let chunkX = 0; chunkX < WORLD_CELLS; chunkX += CHUNK_CELLS) {
      for (let chunkZ = 0; chunkZ < WORLD_CELLS; chunkZ += CHUNK_CELLS) {
        const positions: number[] = [];
        const indices: number[] = [];
        const normals: number[] = [];
        const colors: number[] = [];
        for (let localX = 0; localX < CHUNK_CELLS; localX += 1) {
          for (let localZ = 0; localZ < CHUNK_CELLS; localZ += 1) {
            const cellX = chunkX + localX;
            const cellZ = chunkZ + localZ;
            const x = worldStart + cellX * TILE_SIZE;
            const z = worldStart + cellZ * TILE_SIZE;
            const outerRelief = 0;
            const first = positions.length / 3;
            positions.push(
              x, outerRelief, z,
              x + TILE_SIZE, outerRelief, z,
              x + TILE_SIZE, outerRelief, z + TILE_SIZE,
              x, outerRelief, z + TILE_SIZE,
            );
            indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
            for (const [vertexX, vertexZ] of [[cellX, cellZ], [cellX + 1, cellZ], [cellX + 1, cellZ + 1], [cellX, cellZ + 1]] as const) {
              const fineNoise = this.#hash(vertexX + 7, vertexZ + 19) - 0.5;
              const broadNoise = this.#hash(Math.floor(vertexX / 3) + 31, Math.floor(vertexZ / 3) + 73) - 0.5;
              const shade = 1 + fineNoise * 0.028 + broadNoise * 0.018;
              colors.push(groundColor.r * shade, groundColor.g * shade, groundColor.b * shade, 1);
            }
          }
        }
        VertexData.ComputeNormals(positions, indices, normals);
        const data = new VertexData();
        data.positions = positions;
        data.indices = indices;
        data.normals = normals;
        data.colors = colors;
        const chunk = new BabylonMesh(`terrain-chunk-${chunkX}-${chunkZ}`, this.#scene);
        data.applyToMesh(chunk);
        chunk.material = groundMaterial;
        chunk.receiveShadows = true;
        chunk.isPickable = false;
      }
    }

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

  #createScenery(): void {
    const sceneryMeshes: Mesh[] = [];
    for (const [x, z, scale, variant] of [
      [-7.2, -5.7, 0.9, 0], [-7.8, 4.8, 0.72, 1], [7.1, -5.5, 0.78, 2], [7.4, 5.9, 1.02, 0],
      [-5.4, 7.4, 0.62, 2], [5.2, -7.3, 0.68, 1],
    ] as const) this.#createTree(x, z, scale, variant);

    for (let index = 0; index < (this.#reducedQuality ? 8 : 34); index += 1) {
      const angle = this.#hash(index, 11) * Math.PI * 2;
      const radius = 8.5 + this.#hash(index, 29) * 26;
      const x = Math.cos(angle) * radius + (this.#hash(index, 47) - 0.5) * 4;
      const z = Math.sin(angle) * radius + (this.#hash(index, 61) - 0.5) * 4;
      const scale = 0.58 + this.#hash(index, 83) * 0.78;
      this.#createTree(x, z, scale, index % 3);
    }

    for (let index = 0; index < (this.#reducedQuality ? 4 : 12); index += 1) {
      const angle = this.#hash(index, 101) * Math.PI * 2;
      const radius = 8.5 + this.#hash(index, 131) * 26;
      this.#createRockCluster(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.55 + this.#hash(index, 151) * 0.8, index, sceneryMeshes);
    }

    for (let index = 0; index < (this.#reducedQuality ? 3 : 12); index += 1) {
      const angle = this.#hash(index, 173) * Math.PI * 2;
      const radius = 8.5 + this.#hash(index, 191) * 25;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      for (let part = 0; part < 3; part += 1) {
        const bush = MeshBuilder.CreateIcoSphere(`bush-${index}-${part}`, { radius: 0.2 + this.#hash(index, part + 211) * 0.1, subdivisions: 1 }, this.#scene);
        bush.position.set(x + (part - 1) * 0.24, 0.18 + (part % 2) * 0.06, z + (part % 2) * 0.18);
        bush.scaling.y = 0.72;
        bush.rotation.y = angle + part;
        bush.material = part === 1 ? this.#leafLightMaterial : this.#leafMaterial;
        bush.isPickable = false;
        sceneryMeshes.push(bush);
      }
    }

    for (let index = 0; index < (this.#reducedQuality ? 3 : 9); index += 1) {
      const angle = this.#hash(index, 223) * Math.PI * 2;
      const radius = 6.5 + this.#hash(index, 239) * 11;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      for (let bloom = 0; bloom < 3; bloom += 1) {
        const flower = MeshBuilder.CreateIcoSphere(`flower-${index}-${bloom}`, { radius: 0.055, subdivisions: 1 }, this.#scene);
        flower.position.set(x + (bloom - 1) * 0.14, 0.09, z + (bloom % 2) * 0.12);
        flower.material = this.#flowerMaterial;
        flower.isPickable = false;
        sceneryMeshes.push(flower);
      }
    }
    this.#mergeStaticScenery(sceneryMeshes);
  }

  #createTree(x: number, z: number, scale: number, variant: number): void {
    let prototype = this.#treePrototypes.get(variant);
    if (!prototype) {
      const trunk = MeshBuilder.CreateCylinder(`tree-trunk-${variant}`, { height: 1.1, diameterTop: 0.22, diameterBottom: 0.38, tessellation: 6 }, this.#scene);
      trunk.material = this.#trunkMaterial;
      const lower = MeshBuilder.CreateCylinder(`tree-lower-${variant}`, { height: variant === 1 ? 1.35 : 1.55, diameterTop: 0.16, diameterBottom: variant === 2 ? 1.8 : 1.55, tessellation: 7 }, this.#scene);
      lower.material = variant === 2 ? this.#leafDarkMaterial : this.#leafMaterial;
      const upper = MeshBuilder.CreateCylinder(`tree-upper-${variant}`, { height: 1.25, diameterTop: 0.04, diameterBottom: 1.15, tessellation: 7 }, this.#scene);
      upper.material = variant === 0 ? this.#leafLightMaterial : this.#leafMaterial;
      const shadow = MeshBuilder.CreateDisc(`tree-shadow-${variant}`, { radius: 0.5, tessellation: 12 }, this.#scene);
      shadow.material = this.#contactShadowMaterial;
      prototype = { trunk, lower, upper, shadow };
      this.#treePrototypes.set(variant, prototype);
    }

    const serial = `${Math.round(x * 10)}-${Math.round(z * 10)}`;
    const trunk = prototype.trunk.getTotalVertices() > 0 && prototype.trunk.position.equals(Vector3.Zero())
      ? prototype.trunk
      : prototype.trunk.createInstance(`tree-trunk-instance-${serial}`);
    const lower = trunk === prototype.trunk ? prototype.lower : prototype.lower.createInstance(`tree-lower-instance-${serial}`);
    const upper = trunk === prototype.trunk ? prototype.upper : prototype.upper.createInstance(`tree-upper-instance-${serial}`);
    const shadow = trunk === prototype.trunk ? prototype.shadow : prototype.shadow.createInstance(`tree-shadow-instance-${serial}`);
    const rotation = this.#hash(Math.round(x * 10), Math.round(z * 10)) * Math.PI;
    trunk.position.set(x, 0.5 * scale, z);
    lower.position.set(x, 1.48 * scale, z);
    upper.position.set(x, 2.22 * scale, z);
    shadow.position.set(x + 0.08 * scale, 0.025, z + 0.08 * scale);
    trunk.scaling.setAll(scale);
    lower.scaling.setAll(scale);
    upper.scaling.setAll(scale);
    shadow.scaling.set(1.3 * scale, 0.92 * scale, 1);
    trunk.rotation.y = rotation;
    lower.rotation.y = rotation + 0.15;
    upper.rotation.y = rotation - 0.12;
    shadow.rotation.x = Math.PI / 2;
    trunk.isPickable = false;
    lower.isPickable = false;
    upper.isPickable = false;
    shadow.isPickable = false;
  }

  #createRockCluster(x: number, z: number, scale: number, index: number, sceneryMeshes: Mesh[]): void {
    for (let part = 0; part < (index % 3 === 0 ? 3 : 2); part += 1) {
      const rock = MeshBuilder.CreateIcoSphere(`rock-${index}-${part}`, { radius: scale * (0.42 - part * 0.07), subdivisions: 1 }, this.#scene);
      rock.position.set(x + part * scale * 0.42, scale * (0.3 - part * 0.03), z + (part % 2) * scale * 0.28);
      rock.scaling.set(1, 0.72, 0.86);
      rock.rotation.set(part * 0.24, this.#hash(index, part + 251) * Math.PI, part * -0.16);
      rock.material = this.#stoneMaterial;
      rock.isPickable = false;
      sceneryMeshes.push(rock);
    }
  }

  #mergeStaticScenery(meshes: Mesh[]): void {
    const byMaterial = new Map<StandardMaterial, Mesh[]>();
    for (const mesh of meshes) {
      if (mesh.parent) mesh.setParent(null);
      const material = mesh.material;
      if (!(material instanceof StandardMaterial)) continue;
      const group = byMaterial.get(material) ?? [];
      group.push(mesh);
      byMaterial.set(material, group);
    }
    for (const [material, group] of byMaterial) {
      const merged = BabylonMesh.MergeMeshes(group, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = `scenery-${material.name}`;
      merged.isPickable = false;
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
    if (highlighted) {
      marker.enableEdgesRendering();
      marker.edgesColor.set(0.78, 0.95, 0.52, 0.9);
      marker.edgesWidth = 2;
    } else {
      marker.visibility = 0.07;
      marker.enableEdgesRendering();
      marker.edgesColor.set(0.54, 0.63, 0.38, 0.48);
      marker.edgesWidth = 1;
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
    const body = MeshBuilder.CreateBox(`dwelling-${site.id}`, { width: 1.7, depth: 1.55, height: 1.12 }, this.#scene);
    body.position.set(site.x, 0.66, site.z);
    body.material = this.#lightTimberMaterial;
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

  #publishSitePositions(): void {
    const width = this.#engine.getRenderWidth();
    const height = this.#engine.getRenderHeight();
    const positions: Record<string, { x: number; y: number }> = {};
    this.#siteScreenPositions.clear();
    for (const [siteId, mesh] of this.#selectableMeshes) {
      const projected = Vector3.Project(
        mesh.getAbsolutePosition(),
        Matrix.IdentityReadOnly,
        this.#scene.getTransformMatrix(),
        this.#camera.viewport.toGlobal(width, height),
      );
      const screenPosition = { x: projected.x / width, y: projected.y / height };
      positions[siteId] = screenPosition;
      this.#siteScreenPositions.set(siteId, screenPosition);
    }
    const available = this.#availableSiteId ? positions[this.#availableSiteId] : undefined;
    if (available) {
      const x = String(available.x);
      const y = String(available.y);
      if (this.#canvas.dataset.availableSiteX !== x) this.#canvas.dataset.availableSiteX = x;
      if (this.#canvas.dataset.availableSiteY !== y) this.#canvas.dataset.availableSiteY = y;
    }
    const signature = JSON.stringify(positions);
    if (signature !== this.#lastSitePositionsSignature) {
      this.#canvas.dataset.sitePositions = signature;
      this.#lastSitePositionsSignature = signature;
    }
  }

  public dispose(): void {
    this.#canvas.removeEventListener('pointerdown', this.#handlePointerDown, { capture: true });
    this.#canvas.removeEventListener('pointermove', this.#handlePointerMove, { capture: true });
    this.#canvas.removeEventListener('pointerup', this.#handlePointerUp, { capture: true });
    this.#canvas.removeEventListener('pointercancel', this.#handlePointerUp, { capture: true });
    this.#canvas.removeEventListener('wheel', this.#handleWheel, { capture: true });
    this.#resizeObserver.disconnect();
    this.#scene.dispose();
    this.#engine.dispose();
    this.#canvas.width = 0;
    this.#canvas.height = 0;
  }
}
