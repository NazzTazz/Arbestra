/**
 * Banc de recette des villageois : figurines et gestes de chantier joués par le vrai
 * VillageWorkers, sur des chantiers synthétiques (bois et pierre à 1, 2, 3 et 10
 * villageois, un jardin). Page de développement uniquement, sans API ni base.
 *
 * Paramètres d'URL : ?zoom=moyen|proche|loin (villageois d'environ 17 px au zoom moyen),
 * ?cible=bois-3 (centre la vue sur un chantier), ?decalage=40 (secondes depuis le début).
 */
import {
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import type { VillageState } from '@arbestra/contracts';
import { VillageWorkers } from '../src/scene/village-workers';
import { WORKER_COLOURS } from '../src/scene/worker-figure';

const CELL = 2.5;
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('vue') as HTMLCanvasElement;
const status = document.getElementById('etat')!;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.12, 0.14, 0.12, 1);
const material = (name: string, colour: string) => {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(colour);
  m.specularColor = new Color3(0.025, 0.025, 0.025);
  return m;
};
new HemisphericLight('ciel', new Vector3(0, 1, 0), scene).intensity = 0.55;
const sun = new DirectionalLight('soleil', new Vector3(-0.4, -1, 0.5), scene);
sun.intensity = 0.65;
const ground = MeshBuilder.CreateGround('sol', { width: 80, height: 40 }, scene);
ground.material = material('herbe', '#5d7a43');

// Chantiers : colonnes de bois puis de pierre, un jardin à part.
const start = Date.now() - Number(params.get('decalage') ?? 0) * 1000;
const sites = [
  ...[1, 2, 3, 10].map((count, i) => ({ id: `bois-${count}`, resource: 'wood', count, x: -12 + i * 4, z: 6 })),
  ...[1, 2, 3, 10].map((count, i) => ({ id: `pierre-${count}`, resource: 'stone', count, x: -12 + i * 4, z: -2 })),
];
for (const s of sites) {
  const at = new Vector3(s.x * CELL, 0, s.z * CELL);
  if (s.resource === 'wood')
    for (let k = 0; k < 4; k++) {
      const trunk = MeshBuilder.CreateCylinder(`tronc-${s.id}-${k}`, { height: 1.4, diameter: 0.2 }, scene);
      trunk.position.set(at.x + (k - 1.5) * 0.7, 0.7, at.z + 0.6 + (k % 2) * 0.4);
      trunk.material = material('bois', '#523620');
      const crown = MeshBuilder.CreateSphere(`houppier-${s.id}-${k}`, { diameter: 1.1, segments: 4 }, scene);
      crown.position.set(trunk.position.x, 1.6, trunk.position.z);
      crown.material = material('feuilles', '#2f5a2c');
    }
  else {
    const rock = MeshBuilder.CreateSphere(`roche-${s.id}`, { diameter: 1.6, segments: 3 }, scene);
    rock.scaling.y = 0.6;
    rock.position.set(at.x, 0.3, at.z + 0.6);
    rock.material = material('roche', '#8d8f8c');
  }
}
const path = (x: number, z: number) => [
  { cellX: x, cellY: z - 6 },
  { cellX: x, cellY: z - 3 },
  { cellX: x, cellY: z },
];
const extraction = (s: (typeof sites)[number]) => ({
  id: `lot-${s.id}`,
  resourceCode: s.resource,
  workerCount: s.count,
  featureId: `ressource-${s.id}`,
  cellX: s.x,
  cellY: s.z,
  path: path(s.x, s.z),
  startedAt: new Date(start).toISOString(),
  completesAt: new Date(start + 20 * 60_000).toISOString(),
  transportMs: 5000,
});
const harvest = {
  id: 'recolte',
  startedAt: new Date(start).toISOString(),
  completesAt: new Date(start + 20 * 60_000).toISOString(),
  transportMs: 5000,
  path: path(6, 2),
  stops: [
    {
      cellX: 6,
      cellY: 2,
      path: path(6, 2),
      arrivesAfterMs: 5000,
      workEndsAfterMs: 5000 + 120_000,
      reservedCarrots: 12,
    },
  ],
  returnPath: [...path(6, 2)].reverse(),
};
const plot = MeshBuilder.CreateGround('parcelle', { width: CELL, height: CELL }, scene);
plot.position.set(6 * CELL, 0.01, 2 * CELL);
plot.material = material('terre', '#6b4a2e');
const state = {
  world: { id: 'banc' },
  village: {
    id: 'banc',
    worksites: sites.map((s) => ({ id: s.id, activeExtraction: { id: `lot-${s.id}` } })),
    extractions: sites.map(extraction),
  },
  cells: [{ building: { garden: { plots: [{ ...harvest.stops[0], harvest }] } } }],
  travelRoutes: [],
} as unknown as VillageState;

const workers = new VillageWorkers(
  scene,
  {
    skin: WORKER_COLOURS.skin.map((c, i) => material(`worker-skin-${i}`, c)),
    clothes: WORKER_COLOURS.clothes.map((c, i) => material(`worker-clothes-${i}`, c)),
    hair: WORKER_COLOURS.hair.map((c, i) => material(`worker-hair-${i}`, c)),
    pants: material('worker-pants', WORKER_COLOURS.pants),
    white: material('worker-white', '#ffffff'),
    timber: material('trunk', '#523620'),
    stone: material('stone', '#8d8f8c'),
  },
  {
    path: (p) => p.map((c) => new Vector3(c.cellX * CELL, 0, c.cellY * CELL)),
    project: (c) => ({ x: c.cellX * CELL, z: c.cellY * CELL }),
    ground: () => 0,
    free: () => true,
    key: (p) => `${(p.x / CELL).toFixed(3)}:${(p.z / CELL).toFixed(3)}`,
    detailed: () => true,
  },
);
workers.sync(state, Date.now());

// Caméra du jeu : orthographique, rotation (0,877 ; 0 ; 0,588) ; 17 px par villageois au zoom moyen.
const zoom = params.get('zoom') ?? 'moyen';
const camera = new ArcRotateCamera('camera', -Math.PI / 2 - 0.588, 0.877, 60, Vector3.Zero(), scene);
camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
camera.attachControl(canvas, true);
const target = sites.find((s) => s.id === params.get('cible'));
camera.target = target
  ? new Vector3(target.x * CELL, 0, target.z * CELL)
  : params.get('cible') === 'jardin'
    ? new Vector3(6 * CELL, 0, 2 * CELL)
    : new Vector3(-6 * CELL, 0, 2 * CELL);
const villagerPx = { loin: 8, moyen: 17, proche: 45 }[zoom] ?? 17;
const fit = () => {
  const half = (canvas.clientHeight / villagerPx) * 0.69 * 0.5,
    ratio = canvas.clientWidth / canvas.clientHeight;
  camera.orthoTop = half;
  camera.orthoBottom = -half;
  camera.orthoLeft = -half * ratio;
  camera.orthoRight = half * ratio;
};
fit();
window.addEventListener('resize', () => {
  engine.resize();
  fit();
});
let frames = 0;
engine.runRenderLoop(() => {
  const now = Date.now();
  workers.animate(now, true);
  scene.render();
  if (++frames % 30 === 0)
    status.textContent = `${((now - start) / 1000).toFixed(0)} s · ${workers.figures.length} villageois · ${engine.getFps().toFixed(0)} i/s · zoom ${zoom}`;
});
Object.assign(window, { __banc: { scene, workers, camera } });
