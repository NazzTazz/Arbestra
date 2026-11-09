/**
 * Banc de mesure : sol plat actuel contre gazon modélisé en thin instances
 * (blender-elements/sol-herbe), sur des terrains de n × n cases traversés de chemins de terre.
 * Page de développement uniquement : absente des entrées de build de vite.config.ts.
 *
 * Paramètres d'URL : ?mesure=4 (secondes), ?chauffe=2, ?voir=herbe|plat (vue libre sans mesure).
 * Résultats : tableau affiché et window.__banc (JSON).
 */
import {
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  EngineInstrumentation,
  HemisphericLight,
  Matrix,
  Mesh,
  Scene,
  SceneInstrumentation,
  StandardMaterial,
  Vector3,
  VertexData,
} from '@babylonjs/core';
import kit from './assets/tuiles-herbe.json';

type Mode = 'plat' | 'herbe';
type Piece = keyof typeof kit.pieces;
const CELL = kit.cell,
  HALF = CELL / 2,
  UNIT = 16; // cases par unité de rendu du sol, comme terrain-unit.ts
const params = new URLSearchParams(location.search);
const MEASURE_S = Number(params.get('mesure') ?? 4);
const WARM_S = Number(params.get('chauffe') ?? 2);
const canvas = document.getElementById('vue') as HTMLCanvasElement;
const status = document.getElementById('etat')!;
const output = document.getElementById('resultats')!;
const engine = new Engine(canvas, true, { powerPreference: 'high-performance' });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.12, 0.14, 0.12, 1);
new HemisphericLight('ciel', new Vector3(0, 1, 0), scene).intensity = 0.55;
new DirectionalLight('soleil', new Vector3(-0.4, -1, 0.5), scene).intensity = 0.7;
const white = new StandardMaterial('blanc', scene);
white.specularColor = Color3.Black();
const gl = (engine as unknown as { _gl: WebGL2RenderingContext })._gl;
const debug = gl.getExtension('WEBGL_debug_renderer_info');
const renderer = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'inconnu';
const engineStats = new EngineInstrumentation(engine);
engineStats.captureGPUFrameTime = true;
const sceneStats = new SceneInstrumentation(scene);

// ---------- terrain : chemins de terre toutes les 6 cases ----------
const isPath = (x: number, z: number) => x % 6 === 3 || z % 6 === 3;
function mask(x: number, z: number, n: number) {
  let m = 0;
  if (x + 1 < n && isPath(x + 1, z)) m |= 1;
  if (x > 0 && isPath(x - 1, z)) m |= 2;
  if (z + 1 < n && isPath(x, z + 1)) m |= 4;
  if (z > 0 && isPath(x, z - 1)) m |= 8;
  return m;
}
/** Quart de tour Babylon (RotationY, repère gauche) : +x → −z → −x → +z. */
const turn = (m: number) => (m & 1 ? 8 : 0) | (m & 8 ? 2 : 0) | (m & 2 ? 4 : 0) | (m & 4 ? 1 : 0);
function shapeFor(m: number): [Piece, number] {
  for (const [name, base] of Object.entries(kit.shapes)) {
    let r = base;
    for (let q = 0; q < 4; q++, r = turn(r)) if (r === m) return [`chemin-${name}` as Piece, q];
  }
  throw new Error(`masque ${m}`);
}
const hash = (x: number, z: number) => {
  const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const centre = (i: number, n: number) => (i - n / 2 + 0.5) * CELL;

// ---------- pièces du kit ----------
const decoded = new Map<Piece, VertexData>();
function pieceData(name: Piece) {
  let data = decoded.get(name);
  if (data) return data;
  const piece = kit.pieces[name],
    count = piece.positions.length / 3,
    positions = new Float32Array(count * 3),
    colors = new Float32Array(count * 4),
    indices = new Uint32Array(count),
    normals = new Float32Array(count * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = piece.positions[i]! * kit.units.position;
  for (let v = 0; v < count; v++) {
    const c = kit.units.color;
    colors.set([piece.colors[v * 3]! * c, piece.colors[v * 3 + 1]! * c, piece.colors[v * 3 + 2]! * c, 1], v * 4);
  }
  for (let i = 0; i < count; i += 3) indices.set([i, i + 2, i + 1], i);
  VertexData.ComputeNormals(positions, indices, normals);
  data = Object.assign(new VertexData(), { positions, colors, indices, normals });
  decoded.set(name, data);
  return data;
}

/** Sol plat par unités de 16 × 16 cases : dalle verte, ou terre seule sous le gazon. */
function ground(n: number, mode: Mode): Mesh[] {
  const greens = ['#557d3c', '#5f8644', '#4f7737', '#678a49'].map((c) => Color3.FromHexString(c)),
    earth = Color3.FromHexString('#8a7350'),
    side = Color3.FromHexString('#6a5536'),
    meshes: Mesh[] = [];
  for (let ux = 0; ux < n; ux += UNIT)
    for (let uz = 0; uz < n; uz += UNIT) {
      const positions: number[] = [],
        colors: number[] = [],
        indices: number[] = [];
      const quad = (x0: number, z0: number, x1: number, z1: number, y: number, c: Color3) => {
        const b = positions.length / 3;
        positions.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
        for (let k = 0; k < 4; k++) colors.push(c.r, c.g, c.b, 1);
        indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
      };
      for (let x = ux; x < Math.min(n, ux + UNIT); x++)
        for (let z = uz; z < Math.min(n, uz + UNIT); z++) {
          const cx = centre(x, n),
            cz = centre(z, n),
            green = greens[Math.floor(hash(x, z) * 4)]!;
          if (mode === 'herbe') quad(cx - HALF, cz - HALF, cx + HALF, cz + HALF, 0, earth);
          else if (!isPath(x, z)) quad(cx - HALF, cz - HALF, cx + HALF, cz + HALF, 0, green);
          else {
            // chemin creusé de 6 cm en 3 × 3 rectangles, comme roadTileRects
            const m = mask(x, z, n),
              b = [-HALF, -kit.pathHalfWidth, kit.pathHalfWidth, HALF];
            for (let i = 0; i < 3; i++)
              for (let j = 0; j < 3; j++) {
                const dug =
                  (i === 1 && j === 1) ||
                  (j === 1 && i !== 1 && Boolean(m & (i === 2 ? 1 : 2))) ||
                  (i === 1 && j !== 1 && Boolean(m & (j === 2 ? 4 : 8)));
                quad(cx + b[i]!, cz + b[j]!, cx + b[i + 1]!, cz + b[j + 1]!, dug ? -0.06 : 0, dug ? side : green);
              }
          }
        }
      const mesh = new Mesh(`sol-${ux}-${uz}`, scene),
        normals: number[] = [];
      VertexData.ComputeNormals(positions, indices, normals);
      Object.assign(new VertexData(), { positions, colors, indices, normals }).applyToMesh(mesh);
      mesh.material = white;
      mesh.freezeWorldMatrix();
      meshes.push(mesh);
    }
  return meshes;
}

/** Gazon : une source par pièce, une matrice par case. */
function turf(n: number): Mesh[] {
  const matrices = new Map<Piece, number[]>(),
    m = new Matrix(),
    variants: Piece[] = ['herbe-ras', 'herbe-dru', 'herbe-fleuri', 'herbe-trefle'];
  for (let x = 0; x < n; x++)
    for (let z = 0; z < n; z++) {
      const [piece, quarter] = isPath(x, z)
        ? shapeFor(mask(x, z, n))
        : [variants[Math.floor(hash(x, z) * 4)]!, Math.floor(hash(z + 31, x + 7) * 4)];
      Matrix.RotationYToRef((quarter * Math.PI) / 2, m);
      m.setTranslationFromFloats(centre(x, n), 0, centre(z, n));
      let list = matrices.get(piece);
      if (!list) matrices.set(piece, (list = []));
      for (const v of m.m) list.push(v);
    }
  return [...matrices].map(([piece, list]) => {
    const mesh = new Mesh(`gazon-${piece}`, scene);
    pieceData(piece).applyToMesh(mesh);
    mesh.material = white;
    mesh.thinInstanceSetBuffer('matrix', new Float32Array(list), 16, true);
    mesh.isPickable = false;
    return mesh;
  });
}

// ---------- caméra du jeu ----------
const camera = new ArcRotateCamera('camera', -Math.PI / 2 - 0.588, 0.877, 300, Vector3.Zero(), scene);
camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
camera.maxZ = 2000;
/** Hauteur visible en mètres : 15,4 m au zoom moyen (villageois de 17 px sur 640 × 400). */
function view(height: number) {
  const ratio = canvas.clientWidth / canvas.clientHeight;
  camera.orthoTop = height / 2;
  camera.orthoBottom = -height / 2;
  camera.orthoLeft = (-height / 2) * ratio;
  camera.orthoRight = (height / 2) * ratio;
}

let onFrame: ((cpu: number, now: number) => void) | null = null;
engine.runRenderLoop(() => {
  const t = performance.now();
  scene.render();
  onFrame?.(performance.now() - t, t);
});
const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

async function measure() {
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
      gpu.push(counter.current * 1e-6);
    }
  };
  await wait(MEASURE_S);
  onFrame = null;
  const calls = sceneStats.drawCallsCounter.current;
  let triangles = 0;
  const active = scene.getActiveMeshes();
  for (let i = 0; i < active.length; i++) {
    const mesh = active.data[i] as Mesh;
    triangles += (mesh.getTotalIndices() / 3) * Math.max(1, mesh.thinInstanceCount ?? 0);
  }
  // salve synchrone : rendu + lecture d'un pixel, temps complet non plafonné par la synchro verticale
  engine.stopRenderLoop();
  const pixel = new Uint8Array(4),
    full: number[] = [];
  for (let k = 0; k < 30; k++) {
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
  full.sort((a, b) => a - b);
  return {
    cpu_ms: +avg(cpu).toFixed(2),
    image_ms: +avg(intervals).toFixed(2),
    gpu_ms: gpu.length ? +avg(gpu).toFixed(2) : null,
    complet_ms: +full[full.length >> 1]!.toFixed(2),
    appels: calls,
    triangles,
  };
}

const voir = params.get('voir') as Mode | null;
const rows: Record<string, unknown>[] = [];
let built: Mesh[] = [];
function build(n: number, mode: Mode) {
  for (const mesh of built) mesh.dispose();
  const t = performance.now();
  built = mode === 'herbe' ? [...ground(n, mode), ...turf(n)] : ground(n, mode);
  return +(performance.now() - t).toFixed(1);
}
if (voir) {
  build(24, voir);
  camera.attachControl(canvas, true);
  view(15.4);
  status.textContent = `Vue libre : ${voir}`;
} else {
  for (const n of [20, 40, 80])
    for (const mode of ['plat', 'herbe'] as Mode[]) {
      const preparation_ms = build(n, mode);
      for (const [vue, height] of [
        ['moyen', 15.4],
        ['tout', n * CELL * 0.85],
      ] as const) {
        view(height);
        status.textContent = `${mode} · ${n} × ${n} cases · vue ${vue}…`;
        rows.push({ mode, n, vue, ...(await measure()), preparation_ms });
        output.textContent = rows.map((r) => JSON.stringify(r)).join('\n');
      }
    }
  status.textContent = `Terminé · ${renderer}`;
  Object.assign(window, { __banc: { renderer, rows } });
}
