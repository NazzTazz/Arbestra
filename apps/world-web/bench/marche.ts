/**
 * Banc de recette de la colonne de lumière du marché : la vraie halle-marché
 * (hôtel de ville niveau 2, asset cuit et parties vivantes comme en jeu) sur le
 * quadrillage de l'atelier, et le vrai module MarketBeacon. Page de
 * développement, absente du build, sans API ni base.
 *
 * Paramètres d'URL :
 * - ?heure=-0.3 : incidence solaire de départ (négative la nuit, 0,6 en plein jour) ;
 * - ?fige=900 : déclenche au chargement puis fige l'horloge de l'effet 900 ms
 *   après (capture déterministe) ;
 * - ?generation=complete : construit toute la halle au lieu de charger l'asset cuit ;
 * - ?r=26, ?beta=1.12 : distance et inclinaison de la caméra ;
 * - ?livraisons=3 : nombre de livraisons groupées du déclenchement figé.
 */
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PointerEventTypes,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer';
import { MARKET_BEACON, MarketBeacon } from '../src/scene/market-beacon';
import { buildFootprintGrid } from '../src/scene/footprint-grid';
import { buildTownHallMarket } from '../src/scene/town-hall-market-factory';
import { TimberThatch } from '../src/scene/timber-thatch';
import { buildingAssets, loadBakedBuilding } from '../src/scene/building-assets';
import { setSceneNight } from '../src/scene/village-braziers';
import { skyLight } from '../src/scene/sky-light';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('vue') as HTMLCanvasElement;
const measure = document.getElementById('mesure')!;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
// The village scene's settings (BabylonVillageScene constructor).
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogStart = 280;
scene.fogEnd = 500;
scene.imageProcessingConfiguration.exposure = 0.92;
scene.imageProcessingConfiguration.contrast = 1.18;
scene.setRenderingAutoClearDepthStencil(1, false);
const daylight = new HemisphericLight('daylight', new Vector3(-0.35, 1, -0.25), scene);
const sun = new DirectionalLight('sun', new Vector3(-0.62, -1, 0.42), scene);

const camera = new ArcRotateCamera(
  'camera',
  -Math.PI / 2 + 0.9,
  Number(params.get('beta') ?? 1.12),
  Number(params.get('r') ?? 26),
  new Vector3(0, 3, 0),
  scene,
);
camera.fov = 0.55;
camera.lowerRadiusLimit = 5;
camera.upperRadiusLimit = 120;
camera.upperBetaLimit = 1.5;
camera.wheelDeltaPercentage = 0.01;
camera.minZ = 0.1;
camera.attachControl(canvas, true);

const grass = new StandardMaterial('herbe', scene);
grass.diffuseColor = Color3.FromHexString('#526d40');
grass.specularColor = Color3.Black();
const ground = MeshBuilder.CreateGround('sol', { width: 400, height: 400 }, scene);
ground.material = grass;
ground.isPickable = false;
ground.receiveShadows = true;
const grid = new Mesh('quadrillage', scene);
buildFootprintGrid(scene, grid, 12, 12, 4);

// The town hall, built as BabylonVillageScene.#createTownHallMarket does.
const kit = new TimberThatch(scene);
const hall = new Mesh('town-hall-banc', scene);
const key = 'town-hall-2-finished';
async function buildHall() {
  if (params.get('generation') === 'complete' || !buildingAssets[key]) {
    buildTownHallMarket(hall, kit, 'finished');
    return 'génération complète';
  }
  await loadBakedBuilding(hall, key, true);
  const live = new Mesh(`${hall.name}-live`, scene);
  live.parent = hall;
  buildTownHallMarket(live, kit, 'finished', hall, false, 'live');
  return 'asset cuit et parties vivantes';
}
const built = await buildHall();
const meshes = hall.getChildMeshes();
for (const mesh of meshes) mesh.isPickable = true;
const { min, max } = hall.getHierarchyBoundingVectors(true);
const foot = new Vector3((min.x + max.x) / 2, 0, (min.z + max.z) / 2);
camera.target.set(foot.x, Math.min(4, max.y * 0.6), foot.z);

const beacon = new MarketBeacon(scene);
const cluster = scene.lights.find((l) => l instanceof ClusteredLightContainer) as ClusteredLightContainer | undefined;

// Tuning: the bench edits the module's single table in place, for this page only.
const tuning = MARKET_BEACON as unknown as {
  holdMs: number;
  light: { intensity: number; height: number; range: number };
};
function slider(id: string, value: number, apply: (value: number) => void, unit = '') {
  const input = document.getElementById(id) as HTMLInputElement,
    label = document.getElementById(`${id}-texte`)!;
  const set = () => {
    apply(+input.value);
    label.textContent = id === 'heure' ? `${input.value} (${night ? 'nuit' : 'jour'})` : `${input.value}${unit}`;
  };
  input.value = String(value);
  input.addEventListener('input', set);
  set();
}
let night = false;
function setHour(incidence: number) {
  const sky = skyLight(incidence, 0);
  sun.intensity = sky.sun;
  sun.diffuse.copyFromFloats(...sky.sunColor);
  daylight.intensity = sky.ambient;
  daylight.diffuse.copyFromFloats(...sky.ambientColor);
  daylight.groundColor.copyFromFloats(...sky.groundColor);
  scene.clearColor = new Color4(...sky.sky, 1);
  scene.fogColor = new Color3(...sky.sky);
  // As the village: the fires (and their cluster, the beacon's light with them) burn while the sun is down.
  night = incidence <= 0;
  setSceneNight(scene, night);
}
slider('heure', Number(params.get('heure') ?? 0.45), setHour);
slider('intensite', MARKET_BEACON.light.intensity, (v) => (tuning.light.intensity = v));
slider('hauteur', MARKET_BEACON.light.height, (v) => (tuning.light.height = v));
slider('portee', MARKET_BEACON.light.range, (v) => {
  tuning.light.range = v;
  if (beacon.light) beacon.light.range = v;
  if (cluster && cluster.maxRange < v) cluster.maxRange = v;
});
slider('tenue', MARKET_BEACON.holdMs, (v) => (tuning.holdMs = v), ' ms');

const frozen = params.get('fige');
let frozenAt: number | null = null;
const clock = () => frozenAt ?? performance.now();
function trigger(deliveries = 1) {
  frozenAt = null;
  updates.length = 0;
  beacon.trigger(clock(), deliveries);
}
document.getElementById('declencher')!.addEventListener('click', () => trigger());
document.getElementById('groupe')!.addEventListener('click', () => trigger(3));
document.getElementById('copier')!.addEventListener('click', () => {
  void navigator.clipboard?.writeText(
    JSON.stringify({ holdMs: tuning.holdMs, light: { ...MARKET_BEACON.light } }, null, 2),
  );
});
scene.onPointerObservable.add((info) => {
  if (info.type !== PointerEventTypes.POINTERTAP) return;
  const picked = info.pickInfo?.pickedMesh;
  if (picked && (picked === hall || picked.isDescendantOf(hall))) trigger();
});

// CPU time of the beacon's own per-frame work, while lit.
const updates: number[] = [];
scene.onBeforeRenderObservable.add(() => {
  const started = performance.now();
  beacon.update(clock(), foot.x, foot.y, foot.z);
  if (beacon.active) updates.push(performance.now() - started);
});
const frames: number[] = [];
let last = performance.now();
engine.runRenderLoop(() => {
  const now = performance.now();
  frames.push(now - last);
  last = now;
  if (frames.length > 240) frames.shift();
  scene.render();
});
window.addEventListener('resize', () => engine.resize());

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
};
setInterval(() => {
  const report = {
    halle: built,
    lumiere: beacon.light
      ? cluster?.isEnabled()
        ? 'allumée (nuit)'
        : 'prête, éteinte de jour'
      : 'non prise en charge',
    nuit: night,
    particules: beacon.instanceCount,
    majParImage: { echantillons: updates.length, p50: percentile(updates, 0.5), p95: percentile(updates, 0.95) },
    image: { p50: percentile(frames, 0.5), p95: percentile(frames, 0.95) },
  };
  (window as unknown as { __marche: typeof report }).__marche = report;
  measure.textContent =
    `${report.halle} · lumière ${report.lumiere}\n` +
    `Mise à jour de l’effet : p50 ${report.majParImage.p50.toFixed(3)} ms, p95 ${report.majParImage.p95.toFixed(3)} ms` +
    ` (${report.majParImage.echantillons} images)\n` +
    `Intervalle entre images : p50 ${report.image.p50.toFixed(1)} ms, p95 ${report.image.p95.toFixed(1)} ms`;
}, 500);

/** Start the effect, then stop its clock `ms` later: a deterministic capture. */
function capture(ms: number, deliveries = 1) {
  trigger(deliveries);
  frozenAt = performance.now() + ms;
}
if (frozen !== null) {
  await scene.whenReadyAsync();
  capture(Number(frozen), Number(params.get('livraisons') ?? 1));
}
// Console access for measurements and captures.
(window as unknown as { __banc: object }).__banc = { beacon, scene, engine, foot, trigger, capture, setHour };
