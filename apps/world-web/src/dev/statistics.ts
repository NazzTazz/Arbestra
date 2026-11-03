import { DEV_TIMING_HEADER, parseDevServerTiming, type DevTimingMetric } from '@arbestra/contracts';
import { devToolsEnabled } from './dev-tools';

const storageKey = 'arbestra.dev.statistics';
let enabled: boolean | undefined,
  generation = 0;
const listeners = new Set<() => void>();
export function statisticsEnabled(): boolean {
  if (!devToolsEnabled()) return false;
  if (enabled === undefined) {
    try {
      enabled = localStorage.getItem(storageKey) === '1';
    } catch {
      enabled = false;
    }
  }
  return enabled;
}
export function subscribeStatistics(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function setStatisticsEnabled(value: boolean) {
  enabled = devToolsEnabled() && value;
  generation++;
  requests.clear();
  clientCosts.clear();
  frames.length = 0;
  resetStatisticsWindow();
  renderSamples.length = 0;
  gpuSamples.length = 0;
  gpuSupported = null;
  try {
    localStorage.setItem(storageKey, enabled ? '1' : '0');
  } catch {
    /* Storage is optional. */
  }
  for (const listener of listeners) listener();
}

export const REQUEST_KINDS = {
  village: 'Village',
  terrain: 'Terrain',
  updates: 'Terrain · mises à jour',
  starter: 'Starter',
  preparation: 'Terrain · préparation',
  overview: 'Vue régionale',
  vegetation: 'Végétation régionale',
  settlements: 'Villages régionaux',
} as const;
export type RequestKind = keyof typeof REQUEST_KINDS;
export interface RequestStatistics {
  kind: RequestKind;
  started: number;
  at: number;
  generation: number;
  requestId: string | null;
  status: number | null;
  state: 'pending' | 'headers' | 'complete' | 'error';
  waitMs: number | null;
  bodyMs: number | null;
  parseMs: number | null;
  totalMs: number | null;
  server: DevTimingMetric[];
}
const requests = new Map<RequestKind, { first: RequestStatistics; latest: RequestStatistics }>();
const responses = new WeakMap<Response, RequestStatistics>();

export function requestKind(input: string): RequestKind | null {
  const path = input.split('?')[0];
  const match =
    /^\/api\/worlds\/[^/]+\/(village|starter(?:\/terrain)?|terrain(?:\/updates|\/overview(?:\/vegetation|\/villages)?)?)$/.exec(
      path ?? '',
    );
  if (!match) return null;
  const kinds: Record<string, RequestKind> = {
    village: 'village',
    starter: 'starter',
    'starter/terrain': 'preparation',
    terrain: 'terrain',
    'terrain/updates': 'updates',
    'terrain/overview': 'overview',
    'terrain/overview/vegetation': 'vegetation',
    'terrain/overview/villages': 'settlements',
  };
  return kinds[match[1]!] ?? null;
}
export function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const kind = typeof input === 'string' ? requestKind(input) : null;
  if (!statisticsEnabled() || !kind || (init?.method ?? 'GET').toUpperCase() !== 'GET')
    return globalThis.fetch(input, init);
  const row: RequestStatistics = {
    kind,
    generation,
    started: performance.now(),
    at: Date.now(),
    requestId: null,
    status: null,
    state: 'pending',
    waitMs: null,
    bodyMs: null,
    parseMs: null,
    totalMs: null,
    server: [],
  };
  requests.set(kind, { first: requests.get(kind)?.first ?? row, latest: row });
  const headers = new Headers(init?.headers);
  headers.set(DEV_TIMING_HEADER, '1');
  return globalThis.fetch(input, { ...init, headers }).then(
    (response) => {
      row.waitMs = performance.now() - row.started;
      row.status = response.status;
      row.state = 'headers';
      row.server = parseDevServerTiming(response.headers.get('server-timing'));
      const id = response.headers.get('x-request-id');
      row.requestId = id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
      responses.set(response, row);
      return response;
    },
    (error) => {
      row.state = 'error';
      row.totalMs = performance.now() - row.started;
      throw error;
    },
  );
}
export async function timedJson<T>(response: Response): Promise<T> {
  const row = responses.get(response);
  if (!row || !statisticsEnabled() || row.generation !== generation) return response.json() as Promise<T>;
  try {
    const bodyStart = performance.now(),
      text = await response.text();
    row.bodyMs = performance.now() - bodyStart;
    const parseStart = performance.now();
    try {
      return JSON.parse(text) as T;
    } finally {
      row.parseMs = performance.now() - parseStart;
    }
  } catch (error) {
    row.state = 'error';
    throw error;
  } finally {
    row.totalMs = performance.now() - row.started;
    if (row.state !== 'error') row.state = response.ok ? 'complete' : 'error';
    responses.delete(response);
  }
}

export const CLIENT_COSTS = {
  apply: 'Application état / dispatch React',
  sse: 'Réception SSE / validation / application',
  scene: 'Mise à jour de la scène',
  terrain: 'Intégration des chunks',
  hover: 'Survol · recherche de case',
  terraform: 'Terraformation · prédiction / pinceau',
} as const;
type ClientCost = keyof typeof CLIENT_COSTS;
const clientCosts = new Map<
  ClientCost,
  { lastMs: number; maxMs: number; totalMs: number; count: number; at: number }
>();
export function clientTime<T>(key: ClientCost, run: () => T): T {
  if (!statisticsEnabled()) return run();
  const start = performance.now();
  try {
    return run();
  } finally {
    const ms = performance.now() - start,
      previous = clientCosts.get(key);
    clientCosts.set(key, {
      lastMs: ms,
      maxMs: Math.max(ms, previous?.maxMs ?? 0),
      totalMs: (previous?.totalMs ?? 0) + ms,
      count: (previous?.count ?? 0) + 1,
      at: Date.now(),
    });
  }
}
export const FRAME_PHASES = {
  camera: 'Caméra / transitions',
  demand: 'Terrain · sélection / requêtes',
  integration: 'Terrain · création des meshes',
  projection: 'Reprojection bâtiments / personnages',
  roadsPlan: 'Voirie · préparation du réseau',
  roadsManual: 'Voirie · routes manuelles / trottoirs',
  braziers: 'Voirie · braseros',
  roadsAutomatic: 'Voirie · chemins automatiques',
  roadsDebug: 'Voirie · tracés de diagnostic',
  streamingStats: 'Terrain · statistiques',
  visibility: 'Visibilité / vue régionale',
  environment: 'Météo / lumière / effets',
  population: 'Personnages / eau',
  render: 'Rendu principal CPU',
  clouds: 'Rendu des nuages CPU',
  diagnostics: 'Diagnostics / fin d’image',
  buildings: 'Construction visuelle progressive',
  overlayEffects: 'Halos de récolte / surcouches',
  terraform: 'Terraformation · pinceau / trait',
  overviewGround: 'Vue régionale · relief',
} as const;
type FramePhase = keyof typeof FRAME_PHASES;
type FrameCosts = Partial<Record<FramePhase, number>>;
/** Sequential checkpoints partition a callback; no nested or overlapping durations. */
export class FrameTimings {
  readonly costs: FrameCosts = {};
  constructor(private last: number) {}
  mark(phase: FramePhase) {
    const now = performance.now();
    this.costs[phase] = (this.costs[phase] ?? 0) + Math.max(0, now - this.last);
    this.last = now;
  }
}
type Frame = { at: number; ended: number; updateMs: number; renderMs: number; totalMs: number; phases: FrameCosts };
const frames: Frame[] = [];
export const RENDER_METRICS = {
  activeMeshesMs: ['Sélection des meshes / matrices CPU', 'ms'],
  submissionMs: ['Dessin Babylon CPU', 'ms'],
  particlesMs: ['Particules CPU', 'ms'],
  renderTargetsMs: ['Textures de rendu CPU', 'ms'],
  shaderMs: ['Compilations de shaders CPU', 'ms'],
  drawCalls: ['Appels de dessin', 'n'],
  activeMeshes: ['Meshes actifs', 'n'],
  residentMeshes: ['Meshes résidents', 'n'],
} as const;
export type RenderMetrics = Record<keyof typeof RENDER_METRICS, number>;
const renderSamples: Array<{ at: number; scene: 'village' | 'world'; values: RenderMetrics }> = [];
const gpuSamples: Array<{ at: number; ms: number }> = [];
let gpuSupported: boolean | null = null;
export function recordRenderMetrics(scene: 'village' | 'world', values: RenderMetrics) {
  if (!statisticsEnabled() || document.hidden) return;
  renderSamples.push({ at: performance.now(), scene, values });
  if (renderSamples.length > 120) renderSamples.shift();
}
export function recordGpuTiming(supported: boolean, nanoseconds?: number) {
  if (!statisticsEnabled() || document.hidden) return;
  gpuSupported = supported;
  if (!supported || nanoseconds === undefined || !Number.isFinite(nanoseconds) || nanoseconds < 0) return;
  gpuSamples.push({ at: performance.now(), ms: nanoseconds / 1_000_000 });
  if (gpuSamples.length > 120) gpuSamples.shift();
}
export function recordFrame(start: number, renderMs: number, end: number, phases: FrameCosts = {}) {
  if (!statisticsEnabled() || document.hidden) return;
  frames.push({
    at: start,
    ended: end,
    updateMs: Math.max(0, end - start - renderMs),
    renderMs,
    totalMs: end - start,
    phases,
  });
  if (frames.length > 120) frames.shift();
  recordWindowFrame(start, end, phases);
}

/** Sliding window of compact frame records, to check the budgets over a real play session. */
export const WINDOW_MS = 60_000;
type WindowFrame = { at: number; ended: number; totalMs: number; phases: FrameCosts };
let windowFrames: WindowFrame[] = [],
  windowHead = 0;
// Counters since the last reset; they outlive the 60 s window.
let sinceReset = { startedAt: null as number | null, frames: 0, over100: 0, over200: 0, worstMs: 0 };
export function resetStatisticsWindow() {
  windowFrames = [];
  windowHead = 0;
  sinceReset = { startedAt: null, frames: 0, over100: 0, over200: 0, worstMs: 0 };
}
function recordWindowFrame(start: number, end: number, phases: FrameCosts) {
  const totalMs = end - start;
  windowFrames.push({ at: start, ended: end, totalMs, phases });
  while (windowHead < windowFrames.length && end - windowFrames[windowHead]!.ended > WINDOW_MS) windowHead++;
  // Compact in bulk so the trim stays O(1) amortised.
  if (windowHead > 1024) {
    windowFrames = windowFrames.slice(windowHead);
    windowHead = 0;
  }
  sinceReset.startedAt ??= start;
  sinceReset.frames++;
  if (totalMs > 100) sinceReset.over100++;
  if (totalMs > 200) sinceReset.over200++;
  if (totalMs > sinceReset.worstMs) sinceReset.worstMs = totalMs;
}
/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}
const ascending = (values: number[]) => values.sort((a, b) => a - b);
/** Cheap summary for the panel: one sort of the totals. */
export function statisticsWindowSummary() {
  const totals = ascending(windowFrames.slice(windowHead).map((f) => f.totalMs));
  return {
    frames: totals.length,
    p95Ms: percentile(totals, 95),
    over100: sinceReset.over100,
    over200: sinceReset.over200,
    worstMs: sinceReset.frames ? sinceReset.worstMs : null,
  };
}
function webglRenderer(): string | null {
  try {
    const canvas = document.createElement('canvas'),
      gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
  } catch {
    return null;
  }
}
const rounded = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);
/** A plain JSON report of the last 60 s, ready to be pasted into a ticket. */
export function statisticsReport() {
  const live = windowFrames.slice(windowHead),
    first = live[0],
    last = live.at(-1),
    totals = ascending(live.map((f) => f.totalMs)),
    coveredMs = first && last ? last.ended - first.at : 0,
    elapsed = first && last ? last.at - first.at : 0;
  return {
    at: new Date().toISOString(),
    userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
    webglRenderer: webglRenderer(),
    window: {
      coveredSeconds: rounded(coveredMs / 1000),
      frames: live.length,
      fps: live.length > 1 && elapsed > 0 ? rounded(((live.length - 1) * 1000) / elapsed) : null,
      totalMs: {
        p50: rounded(percentile(totals, 50)),
        p95: rounded(percentile(totals, 95)),
        p99: rounded(percentile(totals, 99)),
        max: rounded(totals.at(-1) ?? null),
      },
    },
    sinceReset: {
      seconds: rounded(sinceReset.startedAt === null || !last ? 0 : (last.ended - sinceReset.startedAt) / 1000),
      frames: sinceReset.frames,
      over100Ms: sinceReset.over100,
      over200Ms: sinceReset.over200,
      worstMs: rounded(sinceReset.frames ? sinceReset.worstMs : null),
    },
    phases: Object.entries(FRAME_PHASES)
      .flatMap(([key, label]) => {
        const phase = key as FramePhase;
        if (!live.some((f) => f.phases[phase] !== undefined)) return [];
        const values = ascending(live.map((f) => f.phases[phase] ?? 0));
        return [{ phase, label, p95Ms: rounded(percentile(values, 95)), maxMs: rounded(values.at(-1) ?? null) }];
      })
      .sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0)),
    clientCosts: [...clientCosts].map(([key, cost]) => ({
      key,
      label: CLIENT_COSTS[key],
      count: cost.count,
      lastMs: rounded(cost.lastMs),
      maxMs: rounded(cost.maxMs),
      totalMs: rounded(cost.totalMs),
    })),
  };
}
export function statisticsSnapshot() {
  // Keep a long completed frame visible, even when it started over two seconds ago.
  const current = performance.now(),
    visibleFrames = frames.filter((f) => current - f.ended <= 2000);
  const mean = (key: 'updateMs' | 'renderMs' | 'totalMs') =>
    visibleFrames.length ? visibleFrames.reduce((n, f) => n + f[key], 0) / visibleFrames.length : null;
  const elapsed = visibleFrames.length > 1 ? visibleFrames.at(-1)!.at - visibleFrames[0]!.at : 0;
  const scene = renderSamples.at(-1)?.scene ?? null;
  const rendering = renderSamples.filter((s) => current - s.at <= 2000 && s.scene === scene);
  const gpu = gpuSamples.filter((s) => current - s.at <= 2000);
  return {
    requests: new Map(requests),
    clientCosts: new Map(clientCosts),
    rendering: {
      scene,
      count: rendering.length,
      metrics: Object.entries(RENDER_METRICS).map(([key, [label, unit]]) => {
        const values = rendering.map((s) => s.values[key as keyof RenderMetrics]);
        return {
          key,
          label,
          unit,
          mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
          max: values.length ? Math.max(...values) : null,
        };
      }),
      gpu: {
        supported: gpuSupported,
        count: gpu.length,
        meanMs: gpu.length ? gpu.reduce((sum, s) => sum + s.ms, 0) / gpu.length : null,
        maxMs: gpu.length ? Math.max(...gpu.map((s) => s.ms)) : null,
      },
    },
    frame: {
      count: visibleFrames.length,
      fps: elapsed > 0 ? ((visibleFrames.length - 1) * 1000) / elapsed : null,
      updateMs: mean('updateMs'),
      renderMs: mean('renderMs'),
      totalMs: mean('totalMs'),
      maxMs: visibleFrames.length ? Math.max(...visibleFrames.map((f) => f.totalMs)) : null,
      phases: Object.entries(FRAME_PHASES).flatMap(([key, label]) => {
        const phase = key as FramePhase;
        if (!visibleFrames.some((f) => f.phases[phase] !== undefined)) return [];
        const values = visibleFrames.map((f) => f.phases[phase] ?? 0);
        return [
          { phase, label, meanMs: values.reduce((sum, ms) => sum + ms, 0) / values.length, maxMs: Math.max(...values) },
        ];
      }),
    },
  };
}
