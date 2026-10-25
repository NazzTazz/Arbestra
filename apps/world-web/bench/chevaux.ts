/**
 * Banc de mesure : N chevaux animés, squelettes classiques contre animation précalculée en texture
 * (thin instances). Page de développement uniquement : absente des entrées de build de vite.config.ts.
 *
 * Paramètres d'URL : ?gpu=low|high (préférence WebGL), ?rapide (sous-ensemble), ?mesure=8 (secondes).
 * Résultats : tableau affiché et window.__banc (JSON).
 */
import {
  ArcRotateCamera,
  BakedVertexAnimationManager,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  EngineInstrumentation,
  HemisphericLight,
  LoadAssetContainerAsync,
  Matrix,
  MeshBuilder,
  Quaternion,
  Scene,
  SceneInstrumentation,
  StandardMaterial,
  Vector3,
  VertexAnimationBaker,
  type AnimationGroup,
  type AssetContainer,
  type Mesh,
  type TransformNode,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

type Lod = 'lod0' | 'lod1' | 'lod2';
type Mode = 'squelette' | 'texture';
interface Row {
  mode: Mode;
  lod: Lod;
  n: number;
  vue: 'proche' | 'moyen';
  cpu_ms: number;
  cpu_p95_ms: number;
  image_ms: number;
  ips: number;
  gpu_ms: number | null;
  complet_ms: number;
  appels: number;
  triangles: number;
  preparation_ms: number;
  texture_ko: number | null;
}

const params = new URLSearchParams(location.search);
const MEASURE_S = Number(params.get('mesure') ?? 8);
const WARM_S = Number(params.get('chauffe') ?? 3);
const HEIGHT_M = 0.85; // gabarit des figurines : cheval de 0,85 m aux oreilles
const BAKE_FPS = 30;
const canvas = document.getElementById('vue') as HTMLCanvasElement;
const status = document.getElementById('etat')!;
const output = document.getElementById('resultats')!;
const engine = new Engine(canvas, true, {
  powerPreference: params.get('gpu') === 'low' ? 'low-power' : 'high-performance',
  antialias: true,
});
const scene = new Scene(engine);
(window as unknown as { __scene: Scene }).__scene = scene; // inspection depuis la console
scene.clearColor = new Color4(0.62, 0.7, 0.75, 1);
const camera = new ArcRotateCamera('camera', -Math.PI / 2 + 0.6, 0.95, 20, new Vector3(0, 0.4, 0), scene);
new HemisphericLight('ciel', new Vector3(0, 1, 0), scene).intensity = 0.7;
const sun = new DirectionalLight('soleil', new Vector3(-0.4, -1, 0.5), scene);
sun.intensity = 1.1;
const ground = MeshBuilder.CreateGround('sol', { width: 120, height: 120 }, scene);
const grass = new StandardMaterial('herbe', scene);
grass.diffuseColor = Color3.FromHexString('#6e8247');
grass.specularColor = Color3.Black();
ground.material = grass;

const gl = (engine as unknown as { _gl: WebGL2RenderingContext })._gl;
const debug = gl.getExtension('WEBGL_debug_renderer_info');
const renderer = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'inconnu';
const engineStats = new EngineInstrumentation(engine);
engineStats.captureGPUFrameTime = true;
const sceneStats = new SceneInstrumentation(scene);
sceneStats.captureFrameTime = true;

const containers = new Map<Lod, Promise<AssetContainer>>();
const container = (lod: Lod) => {
  if (!containers.has(lod)) containers.set(lod, LoadAssetContainerAsync(`./assets/cheval-${lod}.glb`, scene));
  return containers.get(lod)!;
};
const scales = new Map<Lod, number>();

function layout(n: number) {
  const side = Math.ceil(Math.sqrt(n)),
    spacing = 1.5,
    out: { x: number; z: number; yaw: number }[] = [];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++)
    out.push({
      x: ((i % side) - (side - 1) / 2) * spacing,
      z: (Math.floor(i / side) - (side - 1) / 2) * spacing,
      yaw: rnd() * Math.PI * 2,
    });
  return { places: out, rnd };
}

function pick(groups: AnimationGroup[], name: string) {
  return groups.find((g) => g.name === name) ?? groups.find((g) => g.name.endsWith(name))!;
}

/**
 * Ramène un exemplaire au gabarit du jeu. La hauteur se mesure après déformation par le squelette :
 * l'armature du modèle porte une échelle 100 (modèle en centimètres) que la boîte du maillage au
 * repos ignore.
 */
function normalize(lod: Lod, root: TransformNode) {
  if (!scales.has(lod)) {
    root.computeWorldMatrix(true);
    const meshes = root.getChildMeshes(false);
    for (const m of meshes) {
      m.skeleton?.prepare(true);
      m.refreshBoundingInfo({ applySkeleton: true, applyMorph: false });
      m.computeWorldMatrix(true);
    }
    let lo = Infinity,
      hi = -Infinity;
    for (const m of meshes) {
      const box = m.getBoundingInfo().boundingBox;
      lo = Math.min(lo, box.minimumWorld.y);
      hi = Math.max(hi, box.maximumWorld.y);
    }
    scales.set(lod, HEIGHT_M / (hi - lo));
    (window as unknown as { __mesure: unknown }).__mesure = { lod, hauteurBrute: hi - lo, echelle: HEIGHT_M / (hi - lo) };
  }
  root.scaling.scaleInPlace(scales.get(lod)!);
}

function place(root: TransformNode, x: number, z: number, yaw: number) {
  root.position.set(x, 0, z);
  const q = root.rotationQuaternion ?? Quaternion.Identity();
  root.rotationQuaternion = Quaternion.RotationYawPitchRoll(yaw, 0, 0).multiply(q);
}

/** A : un squelette et un groupe d'animation par cheval. */
async function setupSkeletons(lod: Lod, n: number) {
  const c = await container(lod);
  const { places, rnd } = layout(n);
  const made: ReturnType<AssetContainer['instantiateModelsToScene']>[] = [];
  for (let i = 0; i < n; i++) {
    const inst = c.instantiateModelsToScene((name) => `s${i}_${name}`, false, { doNotInstantiate: true });
    const root = inst.rootNodes[0] as TransformNode;
    normalize(lod, root);
    place(root, places[i]!.x, places[i]!.z, places[i]!.yaw);
    const walk = pick(inst.animationGroups, 'Walk');
    for (const g of inst.animationGroups) if (g !== walk) g.stop();
    walk.start(true, 1, walk.from, walk.to);
    walk.goToFrame(walk.from + rnd() * (walk.to - walk.from));
    made.push(inst);
  }
  return {
    textureKb: null,
    dispose() {
      for (const inst of made) {
        for (const g of inst.animationGroups) g.dispose();
        for (const s of inst.skeletons) s.dispose();
        for (const r of inst.rootNodes) r.dispose(false, true);
      }
    },
  };
}

/**
 * B : un seul maillage en thin instances. Les matrices d'os sont précalculées par image, pour
 * chaque animation retenue, en pilotant les groupes d'animation glTF (le précalculateur intégré
 * de Babylon ne sait piloter que des animations portées par le squelette).
 */
async function setupTexture(lod: Lod, n: number) {
  const c = await container(lod);
  const inst = c.instantiateModelsToScene((name) => `v_${name}`, false, { doNotInstantiate: true });
  const root = inst.rootNodes[0] as TransformNode;
  normalize(lod, root);
  // le chargeur crée un maillage par matériau (7 ici), tous sur le même squelette
  const parts = root.getChildMeshes(false).filter((m) => m.skeleton) as Mesh[];
  const mesh = parts[0]!;
  const skeleton = mesh.skeleton!;
  for (const g of inst.animationGroups) g.stop();
  const stride = (skeleton.bones.length + 1) * 16;
  const rows: Float32Array[] = [];
  const clips: Record<string, { start: number; end: number }> = {};
  for (const name of ['Walk', 'Idle']) {
    const g = pick(inst.animationGroups, name);
    const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    const frames = Math.max(2, Math.round(((g.to - g.from) / fps) * BAKE_FPS));
    g.start(false, 1, g.from, g.to);
    g.pause();
    const start = rows.length;
    for (let f = 0; f < frames; f++) {
      g.goToFrame(g.from + (f / BAKE_FPS) * fps);
      for (const bone of skeleton.bones) bone.getTransformNode()?.computeWorldMatrix(true);
      skeleton.prepare(true);
      rows.push(skeleton.getTransformMatrices(mesh).slice(0, stride));
    }
    g.stop();
    clips[name] = { start, end: rows.length - 1 };
  }
  const data = new Float32Array(rows.length * stride);
  rows.forEach((r, i) => data.set(r, i * stride));
  const texture = new VertexAnimationBaker(scene, mesh).textureFromBakedVertexData(data);
  const manager = new BakedVertexAnimationManager(scene);
  manager.texture = texture;
  const { places, rnd } = layout(n);
  const walk = clips.Walk!;
  const settings = new Float32Array(n * 4);
  places.forEach((_, i) => settings.set([walk.start, walk.end, rnd() * (walk.end - walk.start + 1), BAKE_FPS], i * 4));
  for (const part of parts) {
    part.bakedVertexAnimationManager = manager;
    part.computeWorldMatrix(true);
    const world = part.getWorldMatrix().clone(),
      inverse = world.clone().invert();
    const matrices = new Float32Array(n * 16);
    places.forEach((p, i) => {
      // instance × monde du maillage = monde × rotation × translation
      world.multiply(Matrix.RotationY(p.yaw)).multiply(Matrix.Translation(p.x, 0, p.z)).multiply(inverse).copyToArray(matrices, i * 16);
    });
    part.thinInstanceSetBuffer('matrix', matrices, 16, true);
    part.thinInstanceSetBuffer('bakedVertexAnimationSettingsInstanced', settings.slice(), 4, true);
    part.alwaysSelectAsActiveMesh = true;
  }
  const tick = scene.onBeforeRenderObservable.add(() => (manager.time += engine.getDeltaTime() / 1000));
  return {
    textureKb: Math.round((data.byteLength / 1024) * 10) / 10,
    dispose() {
      scene.onBeforeRenderObservable.remove(tick);
      texture.dispose();
      manager.dispose();
      for (const g of inst.animationGroups) g.dispose();
      for (const s of inst.skeletons) s.dispose();
      for (const r of inst.rootNodes) r.dispose(false, true);
    },
  };
}

function view(kind: 'proche' | 'moyen') {
  // moyen : un cheval de 0,85 m fait ~17 px de haut à l'écran
  const h = engine.getRenderHeight(),
    fov = camera.fov;
  camera.radius = kind === 'proche' ? 11 : (HEIGHT_M * h) / (17 * 2 * Math.tan(fov / 2));
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const p95 = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)]! : NaN);
const r2 = (x: number) => Math.round(x * 100) / 100;

let onFrame: ((cpu: number, now: number) => void) | null = null;
engine.runRenderLoop(() => {
  const t = performance.now();
  scene.render();
  onFrame?.(performance.now() - t, t);
});
const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

async function measure(): Promise<Omit<Row, 'mode' | 'lod' | 'n' | 'vue' | 'preparation_ms' | 'texture_ko'>> {
  await wait(WARM_S);
  const cpu: number[] = [],
    intervals: number[] = [],
    gpu: number[] = [];
  let last = 0,
    gpuCount = engineStats.gpuFrameTimeCounter.count;
  onFrame = (c, now) => {
    cpu.push(c);
    if (last) intervals.push(now - last);
    last = now;
    const counter = engineStats.gpuFrameTimeCounter;
    if (counter.count !== gpuCount) {
      gpuCount = counter.count;
      gpu.push(counter.current * 1e-6); // nanosecondes -> millisecondes
    }
  };
  await wait(MEASURE_S);
  onFrame = null;
  // les compteurs de Babylon ne comptent pas les thin instances : triangles = indices × instances
  const calls = sceneStats.drawCallsCounter.current;
  let triangles = 0;
  const active = scene.getActiveMeshes(); // tableau réutilisé : seules les `length` premières cases comptent
  for (let i = 0; i < active.length; i++) {
    const m = active.data[i] as Mesh;
    triangles += (m.getTotalIndices() / 3) * Math.max(1, m.thinInstanceCount ?? 0);
  }
  // salve synchrone : rendu + lecture d'un pixel, temps complet non plafonné par la synchro verticale
  engine.stopRenderLoop();
  const pixel = new Uint8Array(4),
    full: number[] = [];
  for (let k = 0; k < 40; k++) {
    const t = performance.now();
    scene.render();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    full.push(performance.now() - t);
  }
  engine.runRenderLoop(() => {
    const t = performance.now();
    scene.render();
    onFrame?.(performance.now() - t, t);
  });
  return {
    cpu_ms: r2(mean(cpu)),
    cpu_p95_ms: r2(p95(cpu)),
    image_ms: r2(mean(intervals)),
    ips: r2(1000 / mean(intervals)),
    gpu_ms: gpu.length ? r2(mean(gpu)) : null,
    complet_ms: r2(mean(full.slice(5))),
    appels: calls,
    triangles,
  };
}

function table(rows: Row[]) {
  const head = 'mode       lod   n    vue     cpu   p95   image  ips    gpu    complet appels triangles prépa  texKo';
  const line = (r: Row) =>
    [
      r.mode.padEnd(10),
      r.lod.padEnd(5),
      String(r.n).padEnd(4),
      r.vue.padEnd(7),
      String(r.cpu_ms).padEnd(5),
      String(r.cpu_p95_ms).padEnd(5),
      String(r.image_ms).padEnd(6),
      String(r.ips).padEnd(6),
      String(r.gpu_ms ?? '—').padEnd(6),
      String(r.complet_ms).padEnd(7),
      String(r.appels).padEnd(6),
      String(r.triangles).padEnd(9),
      String(r.preparation_ms).padEnd(6),
      String(r.texture_ko ?? '—'),
    ].join(' ');
  return [head, ...rows.map(line)].join('\n');
}

/** ?voir=texture,lod0,50,proche : affiche une seule configuration, sans mesurer (contrôle visuel). */
async function show(spec: string) {
  if (spec.startsWith('brut')) {
    // diagnostic : le modèle tel que chargé, sans clonage, sans mise à l'échelle
    const [, lodName, clip] = spec.split(',');
    const c = await container((lodName as Lod) ?? 'lod0');
    c.addAllToScene();
    for (const g of c.animationGroups) g.stop();
    if (clip !== 'aucune') (c.animationGroups.find((g) => g.name === (clip ?? 'Walk')) ?? pick(c.animationGroups, 'Walk')).start(true);
    const meshes = c.meshes.filter((m) => m.getTotalVertices() > 0);
    for (const m of meshes) m.refreshBoundingInfo({ applySkeleton: true, applyMorph: false });
    const { min, max } = meshes[0]!.getHierarchyBoundingVectors(true);
    camera.setTarget(min.add(max).scale(0.5));
    camera.radius = max.subtract(min).length() * 1.5;
    camera.beta = 1.25;
    camera.maxZ = 100000;
    (window as unknown as { __brut: unknown }).__brut = {
      maillages: meshes.map((m) => ({ nom: m.name, os: m.skeleton?.bones.length ?? 0, parent: m.parent?.name })),
      racines: c.rootNodes.map((r) => ({ nom: r.name, echelle: (r as TransformNode).scaling?.asArray() })),
      taille: max.subtract(min).asArray().map((v) => +v.toFixed(2)),
    };
    status.textContent = `${renderer} — brut`;
    return;
  }
  const [mode, lod, n, v] = spec.split(',') as [Mode, Lod, string, 'proche' | 'moyen'];
  status.textContent = `${renderer} — affichage ${spec}`;
  if (mode === 'squelette') await setupSkeletons(lod, Number(n));
  else await setupTexture(lod, Number(n));
  view(v ?? 'proche');
}

async function run() {
  if (params.has('voir')) return show(params.get('voir')!);
  const quick = params.has('rapide');
  const counts = quick ? [50, 300] : [50, 100, 300, 600];
  const views: ('proche' | 'moyen')[] = quick ? ['moyen'] : ['proche', 'moyen'];
  const plans = (
    [
      ['squelette', 'lod0'],
      ['texture', 'lod0'],
      ['texture', 'lod1'],
      ['texture', 'lod2'],
    ] as [Mode, Lod][]
  ).filter(([m]) => !params.has('modes') || params.get('modes')!.split(',').includes(m));
  // précharge tous les niveaux : le chargement ne doit pas tomber dans une fenêtre de mesure
  for (const [, lod] of plans) await container(lod);
  const rows: Row[] = [];
  const banc = { carte: renderer, preference: params.get('gpu') ?? 'high', minutageGpu: Boolean(engine.getCaps().timerQuery), rows, fini: false };
  (window as unknown as { __banc: typeof banc }).__banc = banc;
  for (const [mode, lod] of plans)
    for (const n of counts) {
      status.textContent = `${renderer} — préparation ${mode} ${lod} × ${n}…`;
      const t0 = performance.now();
      const setup = mode === 'squelette' ? await setupSkeletons(lod, n) : await setupTexture(lod, n);
      const preparation = Math.round(performance.now() - t0);
      for (const v of views) {
        status.textContent = `${renderer} — mesure ${mode} ${lod} × ${n}, vue ${v}…`;
        view(v);
        rows.push({ mode, lod, n, vue: v, ...(await measure()), preparation_ms: preparation, texture_ko: setup.textureKb });
        output.textContent = table(rows);
      }
      setup.dispose();
    }
  banc.fini = true;
  status.textContent = `${renderer} — terminé (minutage GPU ${banc.minutageGpu ? 'disponible' : 'indisponible'}).`;
}

run().catch((e: unknown) => {
  status.textContent = `Erreur : ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
