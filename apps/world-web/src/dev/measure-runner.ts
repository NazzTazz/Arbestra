import { cellVertices, RELEASE_NOTES, type ObservationPose, type VillageState } from '@arbestra/contracts';
import type { TerrainHandle } from '../scene/VillageScene';
import type { ActiveWorldMode } from '../ui/world-mode';
import { terraformObstacles, unitRefusal } from '../ui/terraform-refusals';
import { devToolsEnabled } from './dev-tools';
import { resetStatisticsWindow, setStatisticsEnabled, statisticsEnabled, statisticsReport } from './statistics';
import {
  campaignOutput,
  completeStep,
  currentStep,
  findStrokeZone,
  finishRun,
  isValid,
  loadRun,
  MAX_PENDING_STROKES,
  mismatchMessage,
  parseCampaign,
  resumeAction,
  saveRun,
  scenarioLabel,
  snakePath,
  snapshotHeights,
  startRun,
  STROKE_SPEEDS,
  terrainMismatches,
  ValidityMonitor,
  zoneVertices,
  type CampaignRun,
  type Incident,
  type Mismatch,
  type Scenario,
  type ScenarioResult,
} from './measure-campaign';

/**
 * Campagne de mesures dans le navigateur (docs/GUIDE-DEVELOPPEUR.md §6) : joue
 * les scénarios de dev/measure-campaign.ts par de vrais gestes simulés
 * (`PointerEvent` sur le canvas, `KeyboardEvent` sur la page), qui passent par
 * les gestionnaires du jeu. Aucune requête ajoutée ; les seules actions de jeu
 * sont des traits de terraformation, chacun annulé par Ctrl+Z, et la campagne
 * s'arrête si le terrain ne revient pas. Inactif sans les outils de dev ; rien
 * dans la boucle de rendu : ses boucles ne tournent que pendant une campagne.
 */
export interface MeasureHost {
  state(): VillageState | null;
  scene(): TerrainHandle | null;
  /** Village prêt et affiché, sans arrivée ni installation en cours. */
  ready(): boolean;
  mode(): ActiveWorldMode;
  setMode(mode: ActiveWorldMode): void;
  closeDrawer(): void;
  /** File des modifications de terrain vide (ui/terrain-edits.ts). */
  editsIdle(): boolean;
  /** Le dernier trait sur la pile d'annulation (ui/terraform-undo.ts). */
  lastStroke(): object | null;
}

/** Caméra des scénarios : la pose initiale du village (BabylonVillageScene), un peu plus haut. */
const CAMERA = { alpha: -Math.PI / 2 + 0.9 + Math.PI * 2, beta: 0.84, radius: 18 };
const ZONE_RADIUS = 40;
/** Écart de hauteur maximal entre sommets d'une zone de traits, en cases. */
const ZONE_RELIEF = 1.5;
const ZONE_WATER_MARGIN = 0.25;

class Stopped extends Error {}
class Failure extends Error {}

const storage = () => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

export interface MeasureProgress {
  run: CampaignRun | null;
  /** Texte de la bannière ; null hors campagne. */
  label: string | null;
  measuring: boolean;
}
let host: MeasureHost | null = null,
  run: CampaignRun | null = devToolsEnabled() ? loadRun(storage()) : null,
  driving = false,
  stopRequested = false,
  monitor: ValidityMonitor | null = null,
  /** Bilan de la remise en état d'un scénario interrompu par « Arrêter ». */
  cleanupRestored: boolean | null = null,
  progress: MeasureProgress = { run, label: null, measuring: false };
const listeners = new Set<() => void>();
function emit(label: string | null, measuring = label !== null) {
  if (progress.run === run && progress.label === label && progress.measuring === measuring) return;
  progress = { run, label, measuring };
  for (const listener of listeners) listener();
}
export const measureProgress = () => progress;
export function subscribeMeasure(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function save(next: CampaignRun) {
  run = next;
  saveRun(storage(), run);
}

// Images longues (Long Animation Frames si disponibles) et intervalles entre images.
let loaf: Array<{ start: number; duration: number }> = [],
  loafSupported = false,
  loafObserver: PerformanceObserver | null = null,
  rafTimes: number[] = [],
  rafLoop = 0,
  readyAt: number | null = null,
  readyObserver: MutationObserver | null = null;
function startFrameObservers() {
  if (!loafObserver)
    try {
      loafObserver = new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (loaf.length < 20_000) loaf.push({ start: e.startTime, duration: e.duration });
      });
      loafObserver.observe({ type: 'long-animation-frame', buffered: true });
      loafSupported = true;
    } catch {
      loafSupported = false;
    }
  if (!rafLoop) {
    const tick = (t: number) => {
      if (rafTimes.length < 200_000) rafTimes.push(t);
      rafLoop = requestAnimationFrame(tick);
    };
    rafLoop = requestAnimationFrame(tick);
  }
}
function stopFrameObservers() {
  loafObserver?.disconnect();
  loafObserver = null;
  cancelAnimationFrame(rafLoop);
  rafLoop = 0;
  rafTimes = [];
  loaf = [];
}
/** Les images de [from, to] (ms depuis la navigation). */
function frameSummary(from: number, to: number) {
  const intervals: Array<[number, number]> = [];
  for (let i = 1; i < rafTimes.length; i++) {
    const t = rafTimes[i]!;
    if (t >= from && t <= to) intervals.push([rafTimes[i - 1]!, t - rafTimes[i - 1]!]);
  }
  const longest = (rows: Array<[number, number]>) => rows.reduce((m, [, d]) => Math.max(m, d), 0);
  const over = (rows: Array<[number, number]>, ms: number) => rows.filter(([, d]) => d > ms);
  const raf = {
    frames: intervals.length,
    longestMs: round(longest(intervals)),
    over100: over(intervals, 100).length,
    over200: over(intervals, 200).length,
    lastOver200AtMs: over(intervals, 200).at(-1) ? Math.round(over(intervals, 200).at(-1)![0]) : null,
  };
  const entries: Array<[number, number]> = loaf
    .filter((e) => e.start + e.duration >= from && e.start <= to)
    .map((e) => [e.start, e.duration]);
  const longAnimationFrames = loafSupported
    ? {
        count: entries.length,
        longestMs: round(longest(entries)),
        over100: over(entries, 100).length,
        over200: over(entries, 200).length,
        lastOver200AtMs: over(entries, 200).at(-1) ? Math.round(over(entries, 200).at(-1)![0]) : null,
      }
    : null;
  return { raf, longAnimationFrames };
}
function watchReady() {
  if (readyObserver) return;
  const check = () => {
    const canvas = villageCanvas();
    if (readyAt === null && canvas?.dataset.initialLoad === 'ready') {
      readyAt = performance.now();
      readyObserver?.disconnect();
      readyObserver = null;
    }
  };
  readyObserver = new MutationObserver(check);
  readyObserver.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-initial-load'],
  });
  check();
}
function ensureMonitor() {
  monitor ??= new ValidityMonitor({
    window,
    document,
    ignore: (target) => target instanceof Element && !!target.closest('[data-measure-banner]'),
  });
  return monitor;
}
// Une page rechargée par un scénario de chargement : tout s'observe dès l'évaluation du module.
if (run && resumeAction(run) === 'load' && typeof window !== 'undefined') {
  startFrameObservers();
  watchReady();
  ensureMonitor().begin(0);
}

/** Le jeu s'enregistre (App) ; une campagne persistée reprend dès que le village est prêt. */
export function registerMeasureHost(next: MeasureHost) {
  host = next;
  if (run?.status === 'running') void drive();
  return () => {
    if (host === next) host = null;
  };
}

/** Lance une campagne ; renvoie l'erreur à afficher, null quand elle démarre. */
export function startCampaign(text: string): string | null {
  if (!devToolsEnabled()) return 'Outils de développement inactifs.';
  if (driving || run?.status === 'running') return 'Une campagne est déjà en cours.';
  const parsed = parseCampaign(text);
  if (!parsed.ok) return parsed.error;
  const scene = host?.scene();
  if (!host || !scene || !host.ready() || !host.state()) return 'Attendez que le village soit prêt et affiché.';
  let next = startRun(parsed.campaign, statisticsEnabled());
  next = { ...next, restore: { mode: host.mode(), pose: scene.observationPose() }, environment: environment() };
  save(next);
  setStatisticsEnabled(true);
  void drive();
  return null;
}
/** « Arrêter » : les traits déjà faits sont annulés avant de rendre la main. */
export function stopCampaign() {
  if (!run || run.status !== 'running') return;
  stopRequested = true;
  if (!driving) void finish('stopped');
  emit('Arrêt demandé · remise en état du terrain', true);
}
/** Oublie les derniers résultats. */
export function clearCampaign() {
  if (driving || run?.status === 'running') return;
  run = null;
  saveRun(storage(), null);
  emit(null);
}
export function campaignResults() {
  return run ? campaignOutput(run, release()) : null;
}

const release = () => RELEASE_NOTES[0]?.id ?? null;
function environment(): Record<string, unknown> {
  const state = host?.state(),
    report = statisticsReport(),
    bundle = [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')]
      .map((s) => new URL(s.src, location.href).pathname.split('/').pop())
      .find((name) => name?.endsWith('.js'));
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    renderer: report.webglRenderer,
    userAgent: navigator.userAgent,
    viewport: `${innerWidth}×${innerHeight}`,
    dpr: devicePixelRatio,
    cpuThreads: nav.hardwareConcurrency ?? null,
    deviceMemoryGiB: nav.deviceMemory ?? null,
    bundle: bundle ?? null,
    build: import.meta.env.DEV ? 'développement' : 'production',
    world: state?.world.slug ?? null,
    village: state?.village.name ?? null,
    ...(host?.scene()?.measureEnvironment() ?? {}),
  };
}

function villageCanvas() {
  return document.querySelector<HTMLCanvasElement>('canvas[data-testid="village-canvas"]');
}
function checkStop() {
  if (stopRequested) throw new Stopped();
}
async function waitFor(test: () => boolean, timeoutMs: number, what: string, stoppable = true) {
  const deadline = performance.now() + timeoutMs;
  while (!test()) {
    if (stoppable) checkStop();
    if (performance.now() > deadline) throw new Failure(`Délai dépassé : ${what}.`);
    await sleep(50);
  }
}
/** Attend `ms` en tenant la bannière à jour ; `label(s)` reçoit les secondes écoulées. */
async function wait(ms: number, label?: (seconds: number) => string) {
  const end = performance.now() + ms;
  for (;;) {
    checkStop();
    const left = end - performance.now();
    if (label) emit(label(Math.floor((ms - Math.max(0, left)) / 1000)));
    if (left <= 0) return;
    await sleep(Math.min(250, left));
  }
}

// Gestes simulés : ceux d'un joueur, par les gestionnaires du jeu.
type Point = { x: number; y: number };
function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', p: Point, buttons: number) {
  const canvas = villageCanvas();
  if (!canvas) throw new Failure('Canvas du village introuvable.');
  canvas.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: p.x,
      clientY: p.y,
      screenX: p.x,
      screenY: p.y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: type === 'pointermove' ? -1 : 0,
      buttons,
      view: window,
    }),
  );
}
function press(key: string, code: string, ctrlKey = false) {
  // La touche part du document, comme au clavier quand aucun champ n'a le focus.
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body)
    document.activeElement.blur();
  for (const type of ['keydown', 'keyup'] as const)
    document.body.dispatchEvent(new KeyboardEvent(type, { key, code, ctrlKey, bubbles: true, cancelable: true }));
}
/** Ferme les boîtes de l'Oracle par « Compris » ; un refus est noté dans les incidents. */
function closeOracle() {
  for (const dialog of document.querySelectorAll<HTMLElement>('[role="alertdialog"], [role="dialog"]')) {
    const button = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Compris');
    if (!button) continue;
    const refusal = dialog.classList.contains('oracle-refusal'),
      text = (dialog.querySelector('p')?.textContent ?? '').trim().slice(0, 160);
    monitor?.add(refusal ? 'refusal' : 'dialog', refusal ? `refus de l’Oracle : ${text}` : 'boîte de l’Oracle fermée');
    button.click();
  }
}

function sceneOrFail() {
  const scene = host?.scene();
  if (!host || !scene || !host.state()) throw new Failure('Le village n’est plus affiché.');
  return { host, scene, state: host.state()! };
}
const heightAt = (scene: TerrainHandle) => (x: number, y: number) => scene.terrainVertexHeight(x, y);

/** La zone des traits, repérée une fois par campagne, et les hauteurs de ses sommets. */
function chooseZone(current: CampaignRun): CampaignRun {
  const { scene, state } = sceneOrFail(),
    world = state.world,
    obstacles = terraformObstacles(state),
    height = heightAt(scene);
  const paintable = (cell: { cellX: number; cellY: number }) =>
    !unitRefusal(obstacles, cell, world) &&
    cellVertices(cell, world).every((v) => {
      const h = height(v.vertexX, v.vertexY);
      return h !== null && Number.isFinite(h) && h > ZONE_WATER_MARGIN;
    });
  const accept = (zone: { x: number; y: number; w: number; h: number }) => {
    const heights = snapshotHeights(zoneVertices(zone, world), height)?.map(([, , h]) => h);
    return !!heights && Math.max(...heights) - Math.min(...heights) <= ZONE_RELIEF;
  };
  const undoCells = Math.max(0, ...current.campaign.scenarios.map((s) => (s.kind === 'undo' ? s.cells : 0)));
  const query = {
    world,
    anchor: { cellX: state.village.anchorCellX, cellY: state.village.anchorCellY },
    radius: ZONE_RADIUS,
    paintable,
    accept,
  };
  const zone = findStrokeZone({ ...query, cells: Math.max(36, undoCells) }) ?? findStrokeZone({ ...query, cells: 36 });
  if (!zone) throw new Failure(`Aucune zone libre de 8 × 8 cases à moins de ${ZONE_RADIUS} cases du village.`);
  const snapshot = snapshotHeights(zoneVertices(zone, world), height);
  if (!snapshot) throw new Failure('Le terrain de la zone de traits n’est pas chargé.');
  return { ...current, zone: { ...zone, snapshot } };
}
/** Caméra placée de façon déterministe au-dessus de la zone ; renvoie la pose obtenue. */
async function placeCamera() {
  const { scene } = sceneOrFail(),
    zone = run!.zone!;
  const cellX = zone.x + (zone.w - 1) / 2,
    cellY = zone.y + (zone.h - 1) / 2,
    ground = scene.terrainVertexHeight(Math.round(cellX), Math.round(cellY)) ?? 0,
    current = scene.observationPose();
  const pose: ObservationPose = {
    mode: 'village',
    cellX,
    cellY,
    altitude: ground * 2.5 + 0.35,
    alpha: CAMERA.alpha % (Math.PI * 2),
    beta: CAMERA.beta,
    radius: CAMERA.radius,
    fov: current && 'fov' in current ? current.fov : 0.8,
  };
  // Un quart du chemin par appel : 40 images suffisent à l'atteindre.
  for (let i = 0; i < 40; i++) {
    scene.applyObservationPose(pose);
    await nextFrame();
  }
  const reached = scene.observationPose();
  return reached && 'cellX' in reached
    ? {
        cellX: round(reached.cellX, 2),
        cellY: round(reached.cellY, 2),
        alpha: round(reached.alpha, 3),
        beta: round(reached.beta, 3),
        radius: round(reached.radius, 2),
      }
    : null;
}
/** Points écran des cases (sur le sol affiché) ; échec si une case sort de l'écran. */
function screenPoints(cells: readonly { cellX: number; cellY: number }[]) {
  const { scene } = sceneOrFail();
  return cells.map((cell) => {
    const p = scene.projectCell(cell);
    if (!p) throw new Failure(`La case ${cell.cellX}, ${cell.cellY} de la zone est hors de l’écran.`);
    return p;
  });
}

/** Un trait : appui sur la première case, ↑ (un quart de case au-dessus), glissé à `speed` cases/s, relâché. */
async function stroke(points: readonly Point[], cellsPerSecond: number, deadline: number, onFrame?: () => void) {
  press('Escape', 'Escape'); // La hauteur est reprise de la première case.
  await nextFrame();
  pointer('pointermove', points[0]!, 0);
  await nextFrame();
  pointer('pointerdown', points[0]!, 1);
  await nextFrame();
  press('ArrowUp', 'ArrowUp');
  let position = 0,
    last = performance.now(),
    moves = 0;
  try {
    while (position < points.length - 1 && performance.now() < deadline && !stopRequested) {
      await nextFrame();
      // L'horloge du moment, pas l'horodatage de l'image (antérieur au début du trait pour la première).
      const now = performance.now();
      position = Math.min(points.length - 1, position + (Math.max(0, now - last) / 1000) * cellsPerSecond);
      last = now;
      const i = Math.floor(position),
        f = position - i,
        a = points[i]!,
        b = points[Math.min(points.length - 1, i + 1)]!;
      pointer('pointermove', { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, 1);
      moves++;
      onFrame?.();
    }
  } finally {
    const end = points[Math.min(points.length - 1, Math.round(position))]!;
    pointer('pointerup', end, 0);
  }
  return { moves, cells: Math.round(position) + 1 };
}
/** Les modifications parties et confirmées, puis les boîtes de l'Oracle fermées. */
async function settle(stoppable = true) {
  await waitFor(() => host?.editsIdle() ?? true, 30_000, 'confirmation du serveur', stoppable);
  await sleep(200);
  closeOracle();
}
/** Ctrl+Z du trait `record` s'il est encore le dernier de la pile (jamais un trait du joueur) ; true s'il est parti. */
function undo(record: object) {
  closeOracle();
  if (host?.lastStroke() !== record) {
    monitor?.add('undo', 'trait déjà retiré de la pile : rien à annuler', false);
    return false;
  }
  press('z', 'KeyZ', true);
  if (host?.lastStroke() === record) throw new Failure('Ctrl+Z sans effet sur le dernier trait.');
  return true;
}
/** Le terrain de la zone revenu à ses hauteurs initiales, stable une seconde après confirmation. */
async function terrainBack(timeoutMs = 20_000): Promise<Mismatch[]> {
  const { scene } = sceneOrFail(),
    snapshot = run!.zone!.snapshot,
    height = heightAt(scene),
    deadline = performance.now() + timeoutMs;
  let since: number | null = null,
    mismatches: Mismatch[] = [];
  for (;;) {
    const now = performance.now();
    mismatches = terrainMismatches(snapshot, height);
    if (host?.editsIdle() && !mismatches.length) {
      since ??= now;
      if (now - since >= 1000) return [];
    } else since = null;
    if (now > deadline) return mismatches;
    await sleep(100);
  }
}

async function drive() {
  if (driving || !run || run.status !== 'running' || !host) return;
  driving = true;
  stopRequested = false;
  ensureMonitor();
  startFrameObservers();
  try {
    emit('Campagne · attente du village');
    await waitFor(() => host?.ready() ?? false, 180_000, 'village prêt');
    host?.closeDrawer();
    if (resumeAction(run) === 'interrupted') await interrupted();
    if (!run.zone && run.campaign.scenarios.some((s) => s.kind !== 'load')) save(chooseZone(run));
    for (;;) {
      checkStop();
      const step = currentStep(run);
      if (!step) break;
      if (step.scenario.kind === 'load') {
        if (run.loading?.index === step.index && run.loading.repetition === step.repetition) {
          save(completeStep(run, await measureLoad(step.scenario, step.repetition)));
          continue;
        }
        save({ ...run, loading: { index: step.index, repetition: step.repetition } });
        emit(`${step.scenario.id} · ${scenarioLabel(step.scenario, step.repetition)} · rechargement`);
        await sleep(300);
        location.reload();
        return;
      }
      save({ ...run, active: { index: step.index, repetition: 1 } });
      const result = await measure(step.scenario);
      save(completeStep(run, result));
      if (result.restored === false)
        throw new Failure(mismatchMessage((result.mismatches as Mismatch[] | undefined) ?? []));
    }
    await finish('done');
  } catch (error) {
    await finish(
      error instanceof Stopped ? 'stopped' : 'failed',
      error instanceof Stopped ? null : error instanceof Error ? error.message : String(error),
    );
  } finally {
    driving = false;
  }
}
/** Un scénario coupé par un rechargement imprévu : invalide ; la campagne s'arrête si le terrain a bougé. */
async function interrupted() {
  const step = currentStep(run!)!;
  const mismatches = run!.zone ? await terrainBack(10_000) : [];
  save(
    completeStep(run!, {
      id: step.scenario.id,
      kind: step.scenario.kind,
      valid: false,
      incidents: [{ type: 'reload', at: 0, detail: 'page rechargée pendant le scénario', invalidates: true }],
      startedAt: new Date().toISOString(),
      seconds: 0,
      report: null,
      ...(mismatches.length ? { restored: false, mismatches: mismatches.slice(0, 50) } : {}),
    }),
  );
  if (mismatches.length) throw new Failure(mismatchMessage(mismatches));
}
async function finish(status: 'done' | 'stopped' | 'failed', error: string | null = null) {
  if (!run) return;
  const checks = [...run.results.filter((r) => 'restored' in r).map((r) => r.restored === true)];
  if (cleanupRestored !== null) checks.push(cleanupRestored);
  if ((error ?? run.error)?.startsWith('Terrain non rétabli')) checks.push(false);
  const terrainRestored = checks.length ? checks.every(Boolean) : null;
  cleanupRestored = null;
  const restore = run.restore,
    scene = host?.scene();
  if (restore && scene && host) {
    host.setMode(restore.mode as ActiveWorldMode);
    const pose = restore.pose as ObservationPose | null;
    if (pose && 'cellX' in pose) for (let i = 0; i < 40; i++) scene.applyObservationPose(pose);
  }
  setStatisticsEnabled(run.statisticsBefore);
  save({ ...finishRun(run, status, error), terrainRestored });
  stopFrameObservers();
  monitor?.dispose();
  monitor = null;
  emit(null);
}

/** Un chargement : du début de la navigation à « prêt », puis `settleSeconds` d'observation. */
async function measureLoad(scenario: Extract<Scenario, { kind: 'load' }>, repetition: number): Promise<ScenarioResult> {
  const ready = readyAt ?? performance.now();
  const label = `${scenario.id} · ${scenarioLabel(scenario, repetition)}`;
  // L'observation part de « prêt » ; l'arrivée de la caméra peut en avoir déjà consommé une partie.
  const settleMs = scenario.settleSeconds * 1000,
    elapsed = Math.min(settleMs, performance.now() - ready);
  await wait(
    settleMs - elapsed,
    (s) => `${label} · ${Math.floor(elapsed / 1000) + s} s / ${scenario.settleSeconds} s · ne touchez à rien`,
  );
  const end = performance.now(),
    frames = frameSummary(0, end),
    incidents = ensureMonitor().end(),
    nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined,
    source = frames.longAnimationFrames ?? frames.raf;
  return {
    id: scenario.id,
    kind: 'load',
    repetition,
    of: scenario.repeat,
    valid: isValid(incidents),
    incidents,
    startedAt: new Date(performance.timeOrigin).toISOString(),
    seconds: round(end / 1000),
    readyMs: Math.round(ready),
    settleSeconds: scenario.settleSeconds,
    longestFrameMs: source.longestMs,
    lastFrameOver200Ms: source.lastOver200AtMs,
    frameSource: frames.longAnimationFrames ? 'long-animation-frame' : 'requestAnimationFrame',
    navigationType: nav?.type ?? null,
    transferKiB: nav ? Math.round(nav.transferSize / 1024) : null,
    frames,
    report: statisticsReport(),
  };
}

/** Un scénario sur la zone : préparation, fenêtre de mesure, remise en état. */
async function measure(scenario: Exclude<Scenario, { kind: 'load' }>): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString(),
    label = `${scenario.id} · ${scenarioLabel(scenario)}`,
    watch = ensureMonitor();
  watch.begin();
  emit(`${label} · préparation`);
  const { host: game } = sceneOrFail();
  game.setMode(scenario.kind === 'idle' ? 'exploration' : 'terraform');
  await wait(800);
  closeOracle();
  const camera = await placeCamera();
  save({ ...run!, camera });
  await wait(1500);
  const zone = run!.zone!,
    world = sceneOrFail().state.world;
  const extra: Record<string, unknown> = { camera };
  /** Les traits de ce scénario encore sur la pile d'annulation, et le sommet de la pile avant le trait en cours. */
  const pending: object[] = [];
  let drawing: { before: object | null } | null = null;
  /** Le trait en cours, une fois confirmé, rejoint `pending` s'il a laissé un enregistrement. */
  const keep = () => {
    const record = game.lastStroke(),
      fresh = !!drawing && !!record && record !== drawing.before && !pending.includes(record);
    if (fresh) pending.push(record!);
    drawing = null;
    return fresh ? record : null;
  };
  let windowStart = 0,
    windowEnd = 0,
    report: unknown = null;
  const open = () => {
    resetStatisticsWindow();
    windowStart = performance.now();
  };
  const close = () => {
    windowEnd = performance.now();
    report = statisticsReport();
  };
  try {
    if (scenario.kind === 'idle') {
      open();
      await wait(scenario.seconds * 1000, (s) => `${label} · ${s} s / ${scenario.seconds} s · ne touchez à rien`);
      close();
    } else if (scenario.kind === 'hover') {
      const corners = screenPoints([
          { cellX: zone.x, cellY: zone.y },
          { cellX: zone.x + zone.w - 1, cellY: zone.y + zone.h - 1 },
        ]),
        center = { x: (corners[0]!.x + corners[1]!.x) / 2, y: (corners[0]!.y + corners[1]!.y) / 2 },
        rx = Math.max(12, Math.abs(corners[1]!.x - corners[0]!.x) * 0.35),
        ry = Math.max(12, Math.abs(corners[1]!.y - corners[0]!.y) * 0.35);
      open();
      let moves = 0;
      for (;;) {
        checkStop();
        const now = await nextFrame(),
          s = (now - windowStart) / 1000;
        if (s >= scenario.seconds) break;
        // Petits mouvements continus : une courbe de Lissajous sur la zone, un déplacement par image.
        pointer('pointermove', { x: center.x + rx * Math.cos(s * 1.7), y: center.y + ry * Math.sin(s * 2.3) }, 0);
        moves++;
        emit(`${label} · ${Math.floor(s)} s / ${scenario.seconds} s · ne touchez à rien`);
      }
      close();
      extra.moves = moves;
    } else if (scenario.kind === 'stroke') {
      const speed = STROKE_SPEEDS[scenario.speed],
        forward = snakePath(zone, world),
        paths = [screenPoints(forward), screenPoints([...forward].reverse())];
      let strokes = 0,
        cells = 0,
        undone = 0,
        limited = false;
      open();
      const deadline = windowStart + scenario.seconds * 1000;
      while (performance.now() < deadline) {
        checkStop();
        if (!scenario.undo && pending.length >= MAX_PENDING_STROKES) {
          if (!limited) watch.add('undo', `pile d’annulation pleine : ${MAX_PENDING_STROKES} traits au plus`, false);
          limited = true;
          await wait(Math.min(250, deadline - performance.now()));
          continue;
        }
        // La bannière suit les secondes pendant le trait (emit ignore un libellé inchangé).
        const tick = () =>
          emit(
            `${label} · ${Math.floor((performance.now() - windowStart) / 1000)} s / ${scenario.seconds} s · ne touchez à rien`,
          );
        tick();
        drawing = { before: game.lastStroke() };
        const drawn = await stroke(paths[strokes % 2]!, speed, deadline, tick);
        strokes++;
        cells += drawn.cells;
        await settle();
        const record = keep();
        if (scenario.undo && record && undo(record)) {
          pending.pop();
          undone++;
          await settle();
        }
      }
      close();
      Object.assign(extra, { cellsPerSecond: speed, strokes, cells, undone, zoneCells: zone.w * zone.h });
    } else {
      const count = Math.min(scenario.cells, zone.w * zone.h);
      if (count < scenario.cells)
        watch.add(
          'zone',
          `zone de ${zone.w * zone.h} cases : ${count} cases peintes au lieu de ${scenario.cells}`,
          false,
        );
      const points = screenPoints(snakePath(zone, world).slice(0, count));
      emit(`${label} · trait préalable`);
      drawing = { before: game.lastStroke() };
      await stroke(points, STROKE_SPEEDS.fast, Infinity);
      await settle();
      const record = keep();
      if (!record) throw new Failure('Le trait préalable n’a rien laissé à annuler.');
      await wait(1000);
      const { scene } = sceneOrFail(),
        height = heightAt(scene),
        snapshot = zone.snapshot;
      emit(`${label} · Ctrl+Z · ne touchez à rien`);
      closeOracle();
      open();
      if (undo(record)) pending.pop();
      let shownMs: number | null = null,
        confirmedMs: number | null = null;
      const limit = windowStart + 20_000;
      while (performance.now() < limit) {
        checkStop();
        await nextFrame();
        const now = performance.now(),
          back = !terrainMismatches(snapshot, height).length;
        if (back) shownMs ??= now - windowStart;
        if (back && game.editsIdle()) {
          confirmedMs = now - windowStart;
          break;
        }
      }
      await wait(1000);
      close();
      Object.assign(extra, {
        cells: count,
        undoShownMs: shownMs === null ? null : Math.round(shownMs),
        undoMs: confirmedMs === null ? null : Math.round(confirmedMs),
      });
      if (confirmedMs === null) watch.add('undo', 'le terrain n’est pas revenu dans les 20 s', true);
    }
  } finally {
    if (scenario.kind === 'stroke' || scenario.kind === 'undo') {
      // Les traits restés sur la pile, du dernier au premier ; puis la vérification du terrain.
      emit(`${label} · remise en état du terrain`, true);
      const quiet = () => settle(false).catch(() => undefined);
      await quiet();
      keep();
      for (const record of pending.reverse()) {
        let gone = false;
        try {
          gone = undo(record);
        } catch {
          /* Constaté par la vérification du terrain. */
        }
        if (gone) await quiet();
      }
      const mismatches = await terrainBack();
      extra.restored = !mismatches.length;
      if (mismatches.length) extra.mismatches = mismatches.slice(0, 50);
      // Un arrêt en plein scénario ne laisse pas de résultat : son bilan va dans la campagne.
      cleanupRestored = (cleanupRestored ?? true) && !mismatches.length;
      if (mismatches.length) save({ ...run!, error: mismatchMessage(mismatches) });
    }
  }
  const incidents: Incident[] = watch.end();
  return {
    id: scenario.id,
    kind: scenario.kind,
    ...(scenario.kind === 'stroke' ? { speed: scenario.speed, undo: scenario.undo } : {}),
    valid: isValid(incidents),
    incidents,
    startedAt,
    seconds: round((windowEnd - windowStart) / 1000),
    report,
    frames: frameSummary(windowStart, windowEnd),
    ...extra,
  };
}
