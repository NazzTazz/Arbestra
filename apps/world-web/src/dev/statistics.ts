import { DEV_TIMING_HEADER, parseDevServerTiming, type DevTimingMetric } from '@arbestra/contracts';

const storageKey = 'arbestra.dev.statistics';
let enabled: boolean | undefined, generation = 0;
const listeners = new Set<() => void>();
export function statisticsEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (enabled === undefined) { try { enabled = localStorage.getItem(storageKey) === '1'; } catch { enabled = false; } }
  return enabled;
}
export function subscribeStatistics(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setStatisticsEnabled(value: boolean) {
  enabled = import.meta.env.DEV && value; generation++;
  requests.clear(); clientCosts.clear(); frames.length = 0; renderSamples.length = 0; gpuSamples.length = 0; gpuSupported = null;
  try { localStorage.setItem(storageKey, enabled ? '1' : '0'); } catch { /* Storage is optional. */ }
  for (const listener of listeners) listener();
}

export const REQUEST_KINDS = {
  village: 'Village', terrain: 'Terrain', updates: 'Terrain · mises à jour', starter: 'Starter', preparation: 'Terrain · préparation',
  overview: 'Vue régionale', vegetation: 'Végétation régionale', settlements: 'Villages régionaux',
} as const;
export type RequestKind = keyof typeof REQUEST_KINDS;
export interface RequestStatistics {
  kind: RequestKind; started: number; at: number; generation: number; requestId: string | null;
  status: number | null; state: 'pending' | 'headers' | 'complete' | 'error';
  waitMs: number | null; bodyMs: number | null; parseMs: number | null; totalMs: number | null;
  server: DevTimingMetric[];
}
const requests = new Map<RequestKind, { first: RequestStatistics; latest: RequestStatistics }>();
const responses = new WeakMap<Response, RequestStatistics>();

export function requestKind(input: string): RequestKind | null {
  const path = input.split('?')[0];
  const match = /^\/api\/worlds\/[^/]+\/(village|starter(?:\/terrain)?|terrain(?:\/updates|\/overview(?:\/vegetation|\/villages)?)?)$/.exec(path ?? '');
  if (!match) return null;
  const kinds: Record<string, RequestKind> = { village: 'village', starter: 'starter', 'starter/terrain': 'preparation', terrain: 'terrain',
    'terrain/updates': 'updates', 'terrain/overview': 'overview', 'terrain/overview/vegetation': 'vegetation', 'terrain/overview/villages': 'settlements' };
  return kinds[match[1]!] ?? null;
}
export function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const kind = typeof input === 'string' ? requestKind(input) : null;
  if (!statisticsEnabled() || !kind || (init?.method ?? 'GET').toUpperCase() !== 'GET') return globalThis.fetch(input, init);
  const row: RequestStatistics = { kind, generation, started: performance.now(), at: Date.now(), requestId: null,
    status: null, state: 'pending', waitMs: null, bodyMs: null, parseMs: null, totalMs: null, server: [] };
  requests.set(kind, { first: requests.get(kind)?.first ?? row, latest: row });
  const headers = new Headers(init?.headers); headers.set(DEV_TIMING_HEADER, '1');
  return globalThis.fetch(input, { ...init, headers }).then(response => {
    row.waitMs = performance.now() - row.started; row.status = response.status; row.state = 'headers';
    row.server = parseDevServerTiming(response.headers.get('server-timing'));
    const id = response.headers.get('x-request-id'); row.requestId = id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
    responses.set(response, row); return response;
  }, error => { row.state = 'error'; row.totalMs = performance.now() - row.started; throw error; });
}
export async function timedJson<T>(response: Response): Promise<T> {
  const row = responses.get(response);
  if (!row || !statisticsEnabled() || row.generation !== generation) return response.json() as Promise<T>;
  try {
    const bodyStart = performance.now(), text = await response.text();
    row.bodyMs = performance.now() - bodyStart;
    const parseStart = performance.now();
    try { return JSON.parse(text) as T; }
    finally { row.parseMs = performance.now() - parseStart; }
  } catch (error) { row.state = 'error'; throw error; }
  finally {
    row.totalMs = performance.now() - row.started;
    if (row.state !== 'error') row.state = response.ok ? 'complete' : 'error';
    responses.delete(response);
  }
}

export const CLIENT_COSTS = {
  apply: 'Application état / dispatch React', sse: 'Réception SSE / validation / application',
  scene: 'Mise à jour de la scène', terrain: 'Intégration des chunks',
} as const;
type ClientCost = keyof typeof CLIENT_COSTS;
const clientCosts = new Map<ClientCost, { lastMs: number; maxMs: number; count: number; at: number }>();
export function clientTime<T>(key: ClientCost, run: () => T): T {
  if (!statisticsEnabled()) return run();
  const start = performance.now();
  try { return run(); } finally {
    const ms = performance.now() - start, previous = clientCosts.get(key);
    clientCosts.set(key, { lastMs: ms, maxMs: Math.max(ms, previous?.maxMs ?? 0), count: (previous?.count ?? 0) + 1, at: Date.now() });
  }
}
export const FRAME_PHASES = {
  camera: 'Caméra / transitions', demand: 'Terrain · sélection / requêtes', integration: 'Terrain · création des meshes',
  projection: 'Reprojection bâtiments / personnages', roadsPlan: 'Voirie · préparation du réseau',
  roadsManual: 'Voirie · routes manuelles / trottoirs', braziers: 'Voirie · braseros', roadsAutomatic: 'Voirie · chemins automatiques',
  roadsDebug: 'Voirie · tracés de diagnostic', streamingStats: 'Terrain · statistiques',
  visibility: 'Visibilité / vue régionale', environment: 'Météo / lumière / effets', population: 'Personnages / eau',
  render: 'Rendu principal CPU', clouds: 'Rendu des nuages CPU', diagnostics: 'Diagnostics / fin d’image', buildings: 'Construction visuelle progressive',
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
  drawCalls: ['Appels de dessin', 'n'], activeMeshes: ['Meshes actifs', 'n'], residentMeshes: ['Meshes résidents', 'n'],
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
  frames.push({ at: start, ended: end, updateMs: Math.max(0, end - start - renderMs), renderMs, totalMs: end - start, phases });
  if (frames.length > 120) frames.shift();
}
export function statisticsSnapshot() {
  // Keep a long completed frame visible, even when it started over two seconds ago.
  const current = performance.now(), visibleFrames = frames.filter(f => current - f.ended <= 2000);
  const mean = (key: 'updateMs' | 'renderMs' | 'totalMs') => visibleFrames.length ? visibleFrames.reduce((n, f) => n + f[key], 0) / visibleFrames.length : null;
  const elapsed = visibleFrames.length > 1 ? visibleFrames.at(-1)!.at - visibleFrames[0]!.at : 0;
  const scene = renderSamples.at(-1)?.scene ?? null;
  const rendering = renderSamples.filter(s => current - s.at <= 2000 && s.scene === scene);
  const gpu = gpuSamples.filter(s => current - s.at <= 2000);
  return { requests: new Map(requests), clientCosts: new Map(clientCosts), rendering: {
    scene, count: rendering.length,
    metrics: Object.entries(RENDER_METRICS).map(([key, [label, unit]]) => {
      const values = rendering.map(s => s.values[key as keyof RenderMetrics]);
      return { key, label, unit, mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
        max: values.length ? Math.max(...values) : null };
    }),
    gpu: { supported: gpuSupported, count: gpu.length, meanMs: gpu.length ? gpu.reduce((sum, s) => sum + s.ms, 0) / gpu.length : null,
      maxMs: gpu.length ? Math.max(...gpu.map(s => s.ms)) : null },
  }, frame: {
    count: visibleFrames.length, fps: elapsed > 0 ? (visibleFrames.length - 1) * 1000 / elapsed : null,
    updateMs: mean('updateMs'), renderMs: mean('renderMs'), totalMs: mean('totalMs'),
    maxMs: visibleFrames.length ? Math.max(...visibleFrames.map(f => f.totalMs)) : null,
    phases: Object.entries(FRAME_PHASES).flatMap(([key, label]) => {
      const phase = key as FramePhase;
      if (!visibleFrames.some(f => f.phases[phase] !== undefined)) return [];
      const values = visibleFrames.map(f => f.phases[phase] ?? 0);
      return [{ phase, label, meanMs: values.reduce((sum, ms) => sum + ms, 0) / values.length, maxMs: Math.max(...values) }];
    }),
  } };
}
