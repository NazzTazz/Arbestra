import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Mesh, type Mesh as MeshType } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Scene } from '@babylonjs/core/scene';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { TerrainOverview, TerrainVegetationOverview, TravelCell } from '@arbestra/contracts';
import { CELL_UNITS, normalize, type WorldSpace } from './world-space';
import { CosmologyWorld } from './cosmology-world';
import { TAU, illumination } from './cosmology';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { attachSurfaceCamera, surfaceFrame, surfaceRadius, keepSurfaceCameraClear, blendDirection } from './torus-camera';
import { volumeMesh } from './regional-villages';
import { WeatherMaterial, type WeatherMap } from './weather-view';

const R = 2.4, TUBE = 1;
const REGION_CELLS = 640, REGION_STEP = 8;
const SURFACE_RADIUS = .48;

function sample(data: TerrainOverview, x: number, y: number): number {
  const bx = Math.floor(normalize(x, data.world.widthCells) * data.gridWidth / data.world.widthCells);
  const by = Math.floor(normalize(y, data.world.heightCells) * data.gridHeight / data.world.heightCells);
  return by * data.gridWidth + bx;
}

export function torusPoint(cell: TravelCell, world: TerrainOverview['world']): Vector3 {
  const theta = 2 * Math.PI * normalize(cell.cellX, world.widthCells) / world.widthCells;
  const phi = 2 * Math.PI * normalize(cell.cellY, world.heightCells) / world.heightCells + Math.PI;
  return new Vector3((R + TUBE * Math.cos(phi)) * Math.cos(theta), TUBE * Math.sin(phi),
    (R + TUBE * Math.cos(phi)) * Math.sin(theta));
}

export function torusCell(point: Vector3, world: TerrainOverview['world']): TravelCell {
  const theta = Math.atan2(point.z, point.x), phi = Math.atan2(point.y, Math.hypot(point.x, point.z) - R);
  return { cellX: Math.floor(normalize(theta / (2 * Math.PI), 1) * world.widthCells) % world.widthCells,
    cellY: Math.floor(normalize((phi - Math.PI) / (2 * Math.PI), 1) * world.heightCells) % world.heightCells };
}

function color(data: TerrainOverview, vegetation: TerrainVegetationOverview | null, index: number): [number, number, number] {
  const water = data.waterCoverage[index]! / 255, rock = data.rockCoverage[index]! / 255;
  const wood = vegetation && vegetation.world.id === data.world.id && vegetation.world.generationVersion === data.world.generationVersion
    && vegetation.gridWidth === data.gridWidth && vegetation.gridHeight === data.gridHeight
    ? vegetation.woodlandCoverage[index]! / 255 : 0;
  const elevation = Math.min(1, Math.max(0, data.meanElevations[index]! / 25));
  const grass: [number, number, number] = [91 + elevation * 20 - wood * 25, 117 + elevation * 19 - wood * 9, 63 + elevation * 10 - wood * 25];
  const land = Math.max(0, 1 - water - rock);
  return [grass[0] * land + 105 * rock + 58 * water,
    grass[1] * land + 108 * rock + 105 * water,
    grass[2] * land + 92 * rock + 117 * water];
}

export class RegionalOverview {
  #mesh: MeshType | null = null;
  #masses: MeshType | null = null;
  readonly #massMaterial: StandardMaterial;
  #material: StandardMaterial;
  #centerX = NaN;
  #centerY = NaN;
  #data: TerrainOverview | null = null;
  #vegetation: TerrainVegetationOverview | null = null;
  #baseColors: Float32Array | null = null;
  #litColors: Float32Array | null = null;
  #extent = 0;
  #subdivisions = 0;
  #lightAt = 0;
  #lastLightPhase = NaN;
  constructor(private readonly scene: Scene, weather: () => WeatherMap | null = () => null, space: () => WorldSpace | null = () => null) {
    this.#massMaterial = new StandardMaterial('regional-masses-material', scene);
    this.#massMaterial.diffuseColor = Color3.White(); this.#massMaterial.specularColor = Color3.Black();
    this.#material = new StandardMaterial('regional-overview-material', scene);
    this.#material.diffuseColor = Color3.White();
    this.#material.specularColor = Color3.Black();
    this.#material.backFaceCulling = false;
    this.#material.disableLighting = true; this.#material.emissiveColor = Color3.White();
    new WeatherMaterial(this.#material, 'ground', weather, space);
    new WeatherMaterial(this.#massMaterial, 'ground', weather, space);
  }
  set(data: TerrainOverview, vegetation: TerrainVegetationOverview | null = null): void {
    this.#data = data; this.#vegetation = vegetation; this.#centerX = NaN;
  }
  update(space: WorldSpace, target: TravelCell): void {
    if (!this.#data) return;
    const cx = Math.floor(target.cellX / 16) * 16, cy = Math.floor(target.cellY / 16) * 16;
    if (cx === this.#centerX && cy === this.#centerY) return;
    this.#centerX = cx; this.#centerY = cy;
    const data = this.#data;
    const extent = Math.min(REGION_CELLS, data.world.widthCells - 1, data.world.heightCells - 1);
    const subdivisions = Math.max(1, Math.ceil(extent / REGION_STEP)), step = extent / subdivisions;
    this.#extent = extent; this.#subdivisions = subdivisions; this.#lightAt = 0; this.#lastLightPhase = NaN;
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    const point = space.project({ cellX: cx, cellY: cy });
    for (let j = 0; j <= subdivisions; j++) for (let i = 0; i <= subdivisions; i++) {
      const x = cx - extent / 2 + i * step;
      const y = cy - extent / 2 + j * step;
      const index = sample(data, x, y), isWater = data.waterCoverage[index]! > 127;
      positions.push(point.x + (x - cx) * CELL_UNITS, isWater ? -0.86 : data.meanElevations[index]! * 0.025 - 0.28,
        point.z + (y - cy) * CELL_UNITS);
      const [r, g, b] = color(data, this.#vegetation, index);
      colors.push(r / 255, g / 255, b / 255, 1);
    }
    for (let j = 0; j < subdivisions; j++) for (let i = 0; i < subdivisions; i++) {
      const a = j * (subdivisions + 1) + i, b = a + 1, c = a + subdivisions + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    const mesh = new Mesh('regional-overview', this.scene);
    const vertex = new VertexData(); vertex.positions = positions; vertex.indices = indices; vertex.colors = colors;
    const normals = new Array<number>(positions.length).fill(0);
    for (let index = 1; index < normals.length; index += 3) normals[index] = 1;
    vertex.normals = normals;
    vertex.applyToMesh(mesh, true);
    this.#baseColors = new Float32Array(colors); this.#litColors = new Float32Array(colors);
    mesh.material = this.#material; mesh.isPickable = false;
    this.#mesh?.dispose(false, false); this.#mesh = mesh;
    const masses: Parameters<typeof volumeMesh>[2] = [];
    for (let j = 0; j < subdivisions; j += 2) for (let i = 0; i < subdivisions; i += 2) {
      const x = cx - extent / 2 + (i + 1) * step, y = cy - extent / 2 + (j + 1) * step;
      const index = sample(data, x, y);
      if (data.waterCoverage[index]! > 96) continue;
      const wood = this.#vegetation?.woodlandCoverage[index] ?? 0, rock = data.rockCoverage[index]!;
      if (wood < 48 && rock < 96) continue;
      const forest = wood >= 48, height = forest ? 4 + wood / 64 : 2 + rock / 128;
      masses.push({ x: point.x + (x - cx) * CELL_UNITS, z: point.z + (y - cy) * CELL_UNITS,
        y: data.meanElevations[index]! * .025 + height / 2, width: step * CELL_UNITS * (forest ? 1.5 : 1.2),
        depth: step * CELL_UNITS * (forest ? 1.5 : 1.2), height,
        color: forest ? [.18, .29, .12] : [.43, .45, .38] });
    }
    this.#masses?.dispose(); this.#masses = volumeMesh(this.scene, 'regional-forest-rock-masses', masses, this.#massMaterial);
  }
  shift(x: number, z: number): void {
    for (const mesh of [this.#mesh, this.#masses]) if (mesh) { mesh.position.x -= x; mesh.position.z -= z; }
  }
  detailBlend(blend: number): void { if (this.#masses) this.#masses.visibility = blend; }
  setPresentationLight(factor: number): void {
    const light = .24 + .76 * factor;
    this.#material.emissiveColor.copyFromFloats(light, light, light);
  }
  clear(): void {
    this.#mesh?.dispose(); this.#masses?.dispose(); this.#mesh = this.#masses = null;
    this.#data = this.#vegetation = null; this.#centerX = NaN;
  }
  updateLighting(phase: number, now: number): void {
    if (!this.#mesh || !this.#data || !this.#baseColors || !this.#litColors || now < this.#lightAt || phase === this.#lastLightPhase) return;
    this.#lightAt = now + 400; this.#lastLightPhase = phase;
    // A bounded canonical lattice, independent of which detailed chunks are resident.
    const size = 16, field = new Float32Array((size + 1) ** 2);
    for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) {
      const x = this.#centerX - this.#extent / 2 + this.#extent * i / size;
      const y = this.#centerY - this.#extent / 2 + this.#extent * j / size;
      field[j * (size + 1) + i] = .34 + .66 * illumination(x / this.#data.world.widthCells * TAU,
        y / this.#data.world.heightCells * TAU + Math.PI, phase).direct;
    }
    for (let j = 0; j <= this.#subdivisions; j++) for (let i = 0; i <= this.#subdivisions; i++) {
      const x = i / this.#subdivisions * size, y = j / this.#subdivisions * size;
      const ix = Math.min(size - 1, Math.floor(x)), iy = Math.min(size - 1, Math.floor(y)), fx = x - ix, fy = y - iy;
      const a = iy * (size + 1) + ix;
      const top = field[a]! * (1 - fx) + field[a + 1]! * fx;
      const bottom = field[a + size + 1]! * (1 - fx) + field[a + size + 2]! * fx;
      const light = top * (1 - fy) + bottom * fy, index = (j * (this.#subdivisions + 1) + i) * 4;
      for (let c = 0; c < 3; c++) this.#litColors[index + c] = this.#baseColors[index + c]! * light;
    }
    this.#mesh.updateVerticesData('color', this.#litColors);
  }
  dispose(): void { this.#mesh?.dispose(false, false); this.#masses?.dispose(); this.#massMaterial.dispose(); this.#material.dispose(); }
}

export class TorusOverview {
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly #mesh: MeshType;
  readonly #material: StandardMaterial;
  readonly #texture: DynamicTexture;
  readonly #villageMarker: MeshType;
  readonly #targetMarker: MeshType;
  readonly #cosmology: CosmologyWorld;
  readonly #stats: SceneInstrumentation;
  #fitRadius = 8.2;
  #anchor = Vector3.Zero();
  #surfaceView = false;
  #entryRadius = SURFACE_RADIUS;
  #normal = Vector3.Up();
  #previousRadius = Infinity;
  #flyover = false;
  #lastDisplayPhase: number | null = null;
  #displayPhaseOffset = 0;
  #savedNavigation: { target: Vector3; position: Vector3; up: Vector3; radius: number } | null = null;
  #data: TerrainOverview;
  #vegetation: TerrainVegetationOverview | null = null;
  constructor(engine: Engine, data: TerrainOverview, village: TravelCell, target: TravelCell, weather: () => WeatherMap | null = () => null) {
    this.#data = data;
    this.scene = new Scene(engine);
    this.#stats = new SceneInstrumentation(this.scene);
    this.#stats.captureRenderTime = true;
    try {
    this.scene.clearColor = new Color4(0, 0, 0, 1);
    this.camera = new ArcRotateCamera('world-camera', 0.5, 0.68, 8.2, Vector3.Zero(), this.scene);
    this.camera.lowerRadiusLimit = 5.8; this.camera.upperRadiusLimit = 11;
    this.camera.lowerBetaLimit = 0.05; this.camera.upperBetaLimit = Math.PI - 0.05;
    this.camera.panningSensibility = 0;
    this.camera.wheelDeltaPercentage = .015;
    this.camera.pinchDeltaPercentage = .015;
    this.fit(engine);
    this.#texture = new DynamicTexture('world-overview-texture', { width: data.gridWidth, height: data.gridHeight }, this.scene, true);
    this.#texture.wrapU = Texture.WRAP_ADDRESSMODE; this.#texture.wrapV = Texture.WRAP_ADDRESSMODE;
    this.#material = new StandardMaterial('world-overview-material', this.scene);
    this.#material.diffuseTexture = this.#texture; this.#material.emissiveColor = Color3.Black();
    this.#material.linkEmissiveWithDiffuse = true;
    this.#material.specularColor = Color3.Black(); this.#material.backFaceCulling = false;
    this.#mesh = MeshBuilder.CreateTorus('canonical-world-torus', { diameter: R * 2, thickness: TUBE * 2, tessellation: 96 }, this.scene);
    this.#mesh.material = this.#material;
    this.#villageMarker = MeshBuilder.CreateSphere('village-marker', { diameter: 0.13, segments: 8 }, this.scene);
    this.#targetMarker = MeshBuilder.CreateSphere('target-marker', { diameter: 0.11, segments: 8 }, this.scene);
    for (const [marker, hex] of [[this.#villageMarker, '#f5db83'], [this.#targetMarker, '#dcf1ee']] as const) {
      const material = new StandardMaterial(`${marker.name}-material`, this.scene);
      material.emissiveColor = Color3.FromHexString(hex); material.disableLighting = true;
      marker.material = material; marker.isPickable = false;
    }
    this.#cosmology = new CosmologyWorld(this.scene, this.#mesh, [this.#villageMarker, this.#targetMarker], weather);
    this.mark(village, target);
    this.#draw();
    const focus = torusPoint(target, data.world);
    this.camera.alpha = Math.atan2(focus.z, focus.x);
    } catch (error) { this.scene.dispose(); throw error; }
  }
  setVegetation(data: TerrainVegetationOverview): void { this.#vegetation = data; this.#draw(); }
  fit(engine: Engine): void {
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const radius = Math.max(8.2, 3.9 / (Math.tan(this.camera.fov / 2) * aspect));
    this.#fitRadius = radius;
    this.camera.lowerRadiusLimit = this.#surfaceView ? this.#entryRadius * .67 : radius * 0.72;
    this.camera.upperRadiusLimit = radius * 2.8;
    if (!this.#surfaceView && this.camera.radius < radius) this.camera.radius = radius;
  }
  enter(target: TravelCell, planarAlpha: number, planarRadius = 260, planarBeta = 0, planarFov = .8): void {
    this.#lastDisplayPhase = null; this.#displayPhaseOffset = 0;
    this.#savedNavigation = null;
    this.camera.fov = planarFov;
    this.#entryRadius = surfaceRadius(target, this.#data.world, planarRadius, planarBeta);
    this.#normal = Vector3.FromArray([...surfaceFrame(target, this.#data.world).normal]);
    this.#surfaceView = true;
    this.#previousRadius=this.#entryRadius;
    this.camera.minZ = .01;
    this.camera.lowerRadiusLimit = this.#entryRadius * .67;
    this.#anchor = attachSurfaceCamera(this.camera, this.#cosmology.root, target, this.#data.world, planarAlpha, this.#entryRadius);
  }
  mark(village: TravelCell, target: TravelCell): void {
    for (const [marker, cell] of [[this.#villageMarker, village], [this.#targetMarker, target]] as const) {
      const p = torusPoint(cell, this.#data.world);
      const theta = 2 * Math.PI * normalize(cell.cellX, this.#data.world.widthCells) / this.#data.world.widthCells;
      const center = new Vector3(R * Math.cos(theta), 0, R * Math.sin(theta));
      marker.position = p.add(p.subtract(center).normalize().scale(0.065));
    }
  }
  select(x: number, y: number): TravelCell | null {
    const hit = this.scene.pick(x, y, (mesh) => mesh === this.#mesh, false, this.camera);
    return hit?.hit && hit.pickedPoint
      ? torusCell(Vector3.TransformCoordinates(hit.pickedPoint, this.#cosmology.root.computeWorldMatrix(true).clone().invert()), this.#data.world) : null;
  }
  updateCosmology(phase: number, turns: number, now: number, debug: boolean): void {
    const markerScale = Math.min(1, this.camera.radius / this.#fitRadius);
    this.#villageMarker.scaling.setAll(markerScale); this.#targetMarker.scaling.setAll(markerScale);
    if (this.#surfaceView && !this.#flyover) {
      const radius=this.camera.radius, limit=this.camera.lowerRadiusLimit ?? .06;
      if(radius<this.#previousRadius && radius<this.#entryRadius*3) {
        this.camera.getViewMatrix(true);
        const amount=Math.min(1,(this.#previousRadius-radius)/Math.max(.001,radius-limit)*2);
        const direction=blendDirection(this.camera.position.subtract(this.#anchor).normalize(),this.#normal,amount);
        this.camera.setPosition(this.#anchor.add(direction.scale(radius)));
      }
      this.#previousRadius=radius;
      keepSurfaceCameraClear(this.camera, this.#anchor, this.#normal);
    }
    if (this.#lastDisplayPhase !== null) {
      const step = Math.atan2(Math.sin(phase-this.#lastDisplayPhase),Math.cos(phase-this.#lastDisplayPhase));
      // Follow pauses/seeks, and accelerate elapsed motion rather than multiplying the epoch.
      if (Math.abs(step)<.05) this.#displayPhaseOffset += step*4;
      else this.#displayPhaseOffset = 0;
    }
    this.#lastDisplayPhase = phase;
    // Recover the local lighting phase before crossing back through the cloud mask.
    const blend = this.#surfaceView ? Math.max(0,Math.min(1,(this.camera.radius/this.#entryRadius-1)/2)) : 1;
    const smooth = blend*blend*(3-2*blend);
    this.#cosmology.update(phase+this.#displayPhaseOffset*smooth, turns, now, debug);
  }
  /** One orbit in the torus frame, then a normal-aligned descent to the village. */
  flyover(elapsed: number, target: TravelCell, heading: number): boolean {
    if(!this.#flyover) { this.enter(target,heading,260,0,.8); this.#flyover=true; }
    const frame=surfaceFrame(target,this.#data.world), normal=Vector3.FromArray([...frame.normal]);
    const radius=this.camera.upperRadiusLimit ?? this.#fitRadius*2.8;
    const azimuth=Math.atan2(normal.z,normal.x);
    this.camera.detachControl();
    this.camera.inertialAlphaOffset=this.camera.inertialBetaOffset=this.camera.inertialRadiusOffset=0;
    if(elapsed<12000) {
      const angle=azimuth+Math.PI*2*Math.max(0,elapsed)/12000;
      this.camera.upVector=Vector3.Up(); this.camera.setTarget(Vector3.Zero());
      this.camera.setPosition(new Vector3(Math.cos(angle)*.86,.51,Math.sin(angle)*.86).normalize().scale(radius));
    } else {
      const t=Math.min(1,(elapsed-12000)/6000), eased=t*t*(3-2*t);
      const from=new Vector3(Math.cos(azimuth)*.86,.51,Math.sin(azimuth)*.86).normalize();
      const direction=blendDirection(from,normal,eased);
      const up=Vector3.FromArray([...frame.east]).scale(-Math.cos(heading))
        .add(Vector3.FromArray([...frame.north]).scale(-Math.sin(heading))).normalize();
      this.camera.upVector=blendDirection(Vector3.Up(),up,eased);
      const aim=this.#anchor.scale(eased);
      this.camera.setTarget(aim);
      this.camera.setPosition(aim.add(direction.scale(radius+(this.#entryRadius*.7-radius)*eased)));
    }
    return elapsed>=18000;
  }
  finishFlyover(): void {
    if(this.#flyover) this.camera.setTarget(this.#anchor);
    this.#flyover=false; this.#previousRadius=this.camera.radius;
  }
  eyesVisible(): boolean { return this.#surfaceView && this.#cosmology.eyesVisible(); }
  observed(): TravelCell {
    return this.select(this.scene.getEngine().getRenderWidth() / 2, this.scene.getEngine().getRenderHeight() / 2)
      ?? torusCell(this.#anchor, this.#data.world);
  }
  planarHeading(): number {
    const cell = this.observed(), frame = surfaceFrame(cell, this.#data.world);
    const upWorld = Vector3.TransformNormal(Vector3.Up(), this.camera.getViewMatrix(true).clone().invert());
    const up = Vector3.TransformNormal(upWorld, this.#cosmology.root.computeWorldMatrix(true).clone().invert()).normalize();
    return Math.atan2(-Vector3.Dot(up, Vector3.FromArray([...frame.north])), -Vector3.Dot(up, Vector3.FromArray([...frame.east])));
  }
  focus(target: TravelCell): void {
    const next = torusPoint(target, this.#data.world);
    const offset = this.camera.position.subtract(this.camera.target);
    this.#anchor = next; this.#normal = Vector3.FromArray([...surfaceFrame(target, this.#data.world).normal]);
    this.camera.setTarget(next); this.camera.setPosition(next.add(offset));
  }
  restoreNavigation(): void {
    const saved = this.#savedNavigation;
    if (!saved) return;
    this.camera.lowerRadiusLimit = this.#entryRadius * .67;
    this.camera.parent = this.#cosmology.root; this.camera.upVector = saved.up;
    this.camera.setTarget(saved.target); this.camera.setPosition(saved.position); this.camera.radius = saved.radius;
    this.#surfaceView = true; this.camera.lowerRadiusLimit = this.#entryRadius * .67;
    this.camera.inertialAlphaOffset = this.camera.inertialBetaOffset = this.camera.inertialRadiusOffset = 0;
    this.#savedNavigation = null;
  }
  metrics() { return { worldRenderMs: this.#stats.renderTimeCounter.current,
    worldMeshes: this.scene.meshes.length, shadowBytes: 512 * 512 * 6 * 4 }; }
  navigationMetrics() {
    const root = this.#cosmology.root.computeWorldMatrix(true);
    const anchor = Vector3.TransformCoordinates(this.#anchor, root);
    const viewport = this.camera.viewport.toGlobal(this.scene.getEngine().getRenderWidth(), this.scene.getEngine().getRenderHeight());
    const screen = Vector3.Project(anchor, Matrix.Identity(), this.scene.getTransformMatrix(), viewport);
    return { sticky: this.camera.parent === this.#cosmology.root, anchor: this.#anchor.asArray(),
      screen: [screen.x / viewport.width, screen.y / viewport.height],
      position: this.camera.globalPosition.asArray(), radius: this.camera.radius,
      alpha: this.camera.alpha, beta: this.camera.beta };
  }
  showSolarProfile(): void {
    if (!this.#savedNavigation) this.#savedNavigation = { target: this.camera.target.clone(), position: this.camera.position.clone(), up: this.camera.upVector.clone(), radius: this.camera.radius };
    this.camera.lowerRadiusLimit = this.#fitRadius * .7;
    this.#surfaceView = false; this.camera.parent = null; this.camera.upVector = Vector3.Up(); this.camera.setTarget(Vector3.Zero());
    this.camera.radius = this.#fitRadius * 1.6;
    this.camera.alpha = -Math.PI / 2; this.camera.beta = Math.PI / 2;
  }
  showCatEyes(): void {
    this.showSolarProfile();
    const eyes = this.#cosmology.eyePosition();
    this.camera.setTarget(eyes);
    this.camera.setPosition(eyes.add(eyes.negate().normalize().scale(6)));
    this.camera.inertialAlphaOffset = this.camera.inertialBetaOffset = this.camera.inertialRadiusOffset = 0;
    this.camera.inertialPanningX = this.camera.inertialPanningY = 0;
  }
  #draw(): void {
    const data = this.#data, width = data.gridWidth, height = data.gridHeight;
    const context = this.#texture.getContext();
    const image = new ImageData(width, height);
    const xBuckets = new Uint16Array(width), yBuckets = new Uint16Array(height);
    for (let x = 0; x < width; x++) {
      const outer = 2 * Math.PI * (x + 0.5) / width - Math.PI / 2;
      const matrix = Matrix.Translation(R, 0, 0).multiply(Matrix.RotationY(outer));
      const point = Vector3.TransformCoordinates(new Vector3(TUBE, 0, 0), matrix);
      const cell = torusCell(point, data.world);
      xBuckets[x] = Math.floor(cell.cellX * width / data.world.widthCells);
    }
    const outerZero = Matrix.Translation(R, 0, 0).multiply(Matrix.RotationY(-Math.PI / 2));
    for (let y = 0; y < height; y++) {
      const inner = 2 * Math.PI * (1 - (y + 0.5) / height) + Math.PI;
      const point = Vector3.TransformCoordinates(new Vector3(TUBE * Math.cos(inner), TUBE * Math.sin(inner), 0), outerZero);
      const cell = torusCell(point, data.world);
      yBuckets[y] = Math.floor(cell.cellY * height / data.world.heightCells);
    }
    const palette = new Uint8Array(width * height * 3);
    for (let index = 0; index < width * height; index++) {
      const [r, g, b] = color(data, this.#vegetation, index);
      const offset = index * 3;
      palette[offset] = r; palette[offset + 1] = g; palette[offset + 2] = b;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const colorOffset = (yBuckets[y]! * width + xBuckets[x]!) * 3, offset = (y * width + x) * 4;
      image.data[offset] = palette[colorOffset]!;
      image.data[offset + 1] = palette[colorOffset + 1]!;
      image.data[offset + 2] = palette[colorOffset + 2]!;
      image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0); this.#texture.update(false);
  }
  dispose(): void { this.#stats.dispose(); this.scene.dispose(); }
}
