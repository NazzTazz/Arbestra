import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Shaders/shadowMap.vertex';
import '@babylonjs/core/Shaders/shadowMap.fragment';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Ray } from '@babylonjs/core/Culling/ray';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { Scene } from '@babylonjs/core/scene';
import { TAU, cyclePhases, illumination, solarCurvePoint, sunPosition, torusFrame } from './cosmology';
import { recognizableCatEye } from './cat-observation';
import { WeatherMaterial, type WeatherMap } from './weather-view';
import { createSolarGlare } from './solar-glare';
import { createSolarSky } from './solar-sky';
import { TorusFog } from './torus-fog';

/** All presentation resources belong to the existing world scene and dispose with it. */
export class CosmologyWorld {
  readonly root: TransformNode;
  readonly #sun: PointLight;
  readonly #sunMesh: Mesh;
  readonly #path: LinesMesh;
  readonly #probes: Array<{ mesh: Mesh; material: StandardMaterial; u: number; v: number }> = [];
  readonly #eyes: Mesh[] = [];
  readonly #eyeMaterial: StandardMaterial;
  readonly #cloudVolume: TorusFog;
  #reflection = 0;
  #nextProbeAt = 0;
  constructor(private readonly scene: Scene, private readonly torus: Mesh, markers: Mesh[], private readonly weather: () => WeatherMap | null) {
    this.root = new TransformNode('rotating-world', scene);
    torus.parent = this.root;
    for (const marker of markers) marker.parent = this.root;
    this.#sun = new PointLight('local-solar-source', Vector3.Zero(), scene);
    this.#sun.diffuse = Color3.FromHexString('#fff0d6'); this.#sun.intensity = 2.2;
    this.#sun.shadowMinZ = .1; this.#sun.shadowMaxZ = 35;
    const shadow = new ShadowGenerator(512, this.#sun);
    shadow.usePoissonSampling = true;
    shadow.bias = .001; shadow.normalBias = .04;
    shadow.addShadowCaster(torus); torus.receiveShadows = true;
    shadow.getShadowMap()!.refreshRate = 4;
    this.#sunMesh = MeshBuilder.CreateSphere('visible-sun', { diameter: .26, segments: 12 }, scene);
    const solar = new StandardMaterial('solar-glow', scene);
    solar.disableLighting = true; solar.emissiveColor = new Color3(5, 4.4, 3.2);
    this.#sunMesh.material = solar; this.#sunMesh.isPickable = false;
    createSolarGlare(scene, this.#sunMesh, torus);
    this.#path = MeshBuilder.CreateLines('solar-eight', { points: Array.from({ length: 257 }, (_, i) => Vector3.FromArray([...solarCurvePoint(i / 256 * TAU)])) }, scene);
    this.#path.color = Color3.FromHexString('#d4ae6b'); this.#path.alpha = .45; this.#path.isPickable = false;
    for (const v of [0, Math.PI, Math.PI / 4]) for (let i = 0; i < 8; i++) {
      const u = i / 8 * TAU, frame = torusFrame(u, v);
      const mesh = MeshBuilder.CreateSphere(`solar-probe-${v}-${i}`, { diameter: .085, segments: 6 }, scene);
      mesh.parent = this.root; mesh.position.copyFromFloats(...frame.point);
      mesh.position.addInPlace(Vector3.FromArray([...frame.normal]).scale(.07)); mesh.isPickable = false;
      const material = new StandardMaterial(`${mesh.name}-color`, scene);
      material.disableLighting = true; mesh.material = material;
      this.#probes.push({ mesh, material, u, v });
    }
    this.#cloudVolume = new TorusFog(scene);
    if (torus.material instanceof StandardMaterial) new WeatherMaterial(torus.material, 'world', weather);

    createSolarSky(scene);

    const eyes = new StandardMaterial('tapetum-reflection', scene); this.#eyeMaterial = eyes;
    const eyeTexture = new DynamicTexture('diffuse-tapetum', 64, scene, false); eyeTexture.hasAlpha = true;
    const eyeCtx = eyeTexture.getContext(), gradient = eyeCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, 'rgba(189,201,126,.8)'); gradient.addColorStop(.5, 'rgba(125,153,97,.65)'); gradient.addColorStop(1, 'rgba(80,110,75,0)');
    eyeCtx.fillStyle = gradient; eyeCtx.fillRect(0, 0, 64, 64);
    eyeCtx.clearRect(29, 14, 6, 36); eyeTexture.update();
    eyes.diffuseTexture = eyeTexture; eyes.useAlphaFromDiffuseTexture = true; eyes.disableLighting = true;
    eyes.emissiveColor = new Color3(.55, .63, .36); eyes.backFaceCulling = false;
    for (const x of [10.3, 11.7]) {
      const eye = MeshBuilder.CreatePlane('hidden-cat-eye', { width: .62, height: .84 }, scene);
      eye.position.set(x, 2.8, -13); eye.lookAt(Vector3.Zero()); eye.material = eyes; eye.isPickable = false;
      this.#eyes.push(eye);
    }
  }
  update(phase: number, _turns: number, now: number, debug: boolean): void {
    const phases = cyclePhases(phase);
    this.root.rotation.y = -phases.torus;
    const p = sunPosition(phases.sun); this.#sun.position.copyFromFloats(...p); this.#sunMesh.position.copyFromFloats(...p);
    this.#cloudVolume.update(phase, this.#sun.position, this.weather());
    this.#path.setEnabled(debug);
    for (const probe of this.#probes) probe.mesh.setEnabled(debug);
    if (debug && now >= this.#nextProbeAt) {
      this.#nextProbeAt = now + 250;
      for (const probe of this.#probes) {
        const light = illumination(probe.u, probe.v, phase);
        probe.material.emissiveColor.copyFrom(Color3.FromHexString(light.lit ? '#ffdc76' : light.occluded ? '#bf7ab5' : '#5484ba'));
      }
    }
    const camera = this.scene.activeCamera;
    const eye = this.#eyes[0]!;
    // Deterministic drift is deliberately smaller than an eye, over a whole solar cycle.
    for (const item of this.#eyes) item.position.y = 2.8 + Math.sin(phases.sun * .5) * .08;
    if (camera) {
      const toSun = this.#sun.position.subtract(eye.position).normalize();
      const toViewer = camera.globalPosition.subtract(eye.position).normalize();
      this.#reflection = Math.pow(Math.max(0, Vector3.Dot(toSun, toViewer)), 32) * .7;
      this.#eyeMaterial.alpha = this.#reflection;
    }
  }
  eyePosition(): Vector3 {
    return this.#eyes[0]!.position.add(this.#eyes[1]!.position).scale(.5);
  }
  eyesVisible(): boolean {
    const camera = this.scene.activeCamera;
    if (!camera || this.#reflection < .28) return false;
    const viewport = camera.viewport.toGlobal(1, 1);
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!canvas) return false;
    const { width, height } = canvas.getBoundingClientRect();
    return this.#eyes.every(eye => {
      const projected = Vector3.Project(eye.position, Matrix.Identity(), this.scene.getTransformMatrix(), viewport);
      const corners = eye.getBoundingInfo().boundingBox.vectorsWorld.map(point =>
        Vector3.Project(point, Matrix.Identity(), this.scene.getTransformMatrix(), viewport));
      if (corners.some(point => point.z < 0 || point.z > 1)) return false;
      const eyeWidth = (Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x))) * width;
      const eyeHeight = (Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y))) * height;
      if (!recognizableCatEye(this.#reflection, projected.x, projected.y, eyeWidth, eyeHeight)) return false;
      const delta = eye.position.subtract(camera.globalPosition);
      const ray = new Ray(camera.globalPosition, delta.normalizeToNew(), delta.length());
      // Dense portions of the veil also disqualify observation; the visual alpha still blends naturally.
      return !this.scene.pickWithRay(ray, mesh => mesh === this.torus)?.hit
        && !this.#cloudVolume.obscures(camera.globalPosition, eye.position);
    });
  }
}
