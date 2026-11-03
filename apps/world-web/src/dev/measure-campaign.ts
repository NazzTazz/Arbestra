import { cellVertices, vertexKey } from '@arbestra/contracts';

/**
 * Campagne de mesures (outil de développement, dev/measure-runner.ts) : la
 * partie sans navigateur. Un JSON décrit des scénarios ; l'état d'une
 * campagne est persisté pour survivre aux rechargements des scénarios de
 * chargement ; la sortie est un JSON de résultats. Diagnostic seulement :
 * les seules actions de jeu sont des traits de terraformation, tous annulés.
 */
type Cell = { cellX: number; cellY: number };
type World = { widthCells: number; heightCells: number };

export type ScenarioKind = 'load' | 'idle' | 'hover' | 'stroke' | 'undo';
export type StrokeSpeed = 'slow' | 'fast';
export type Scenario =
  | { id: string; kind: 'load'; repeat: number; settleSeconds: number }
  | { id: string; kind: 'idle'; seconds: number }
  | { id: string; kind: 'hover'; tool: 'terraform'; seconds: number }
  | { id: string; kind: 'stroke'; speed: StrokeSpeed; seconds: number; undo: boolean }
  | { id: string; kind: 'undo'; cells: number };
export interface Campaign {
  name: string;
  scenarios: Scenario[];
}

/** Cases par seconde d'un trait simulé. */
export const STROKE_SPEEDS: Record<StrokeSpeed, number> = { slow: 4, fast: 20 };
/** La pile d'annulation du jeu garde 20 traits (ui/terraform-undo.ts) : pas plus de traits en attente. */
export const MAX_PENDING_STROKES = 20;

export const DEFAULT_CAMPAIGN: Campaign = {
  name: 'terraformation-v1',
  scenarios: [
    { id: 'A', kind: 'load', repeat: 3, settleSeconds: 20 },
    { id: 'B', kind: 'idle', seconds: 60 },
    { id: 'C1', kind: 'hover', tool: 'terraform', seconds: 60 },
    { id: 'C2', kind: 'stroke', speed: 'slow', seconds: 30, undo: true },
    { id: 'C3', kind: 'stroke', speed: 'fast', seconds: 30, undo: true },
    { id: 'C4', kind: 'undo', cells: 60 },
  ],
};
export const DEFAULT_CAMPAIGN_TEXT = JSON.stringify(DEFAULT_CAMPAIGN, null, 2);

const FIELDS: Record<ScenarioKind, readonly string[]> = {
  load: ['repeat', 'settleSeconds'],
  idle: ['seconds'],
  hover: ['tool', 'seconds'],
  stroke: ['speed', 'seconds', 'undo'],
  undo: ['cells'],
};
const KINDS = Object.keys(FIELDS) as ScenarioKind[];
export type CampaignParse = { ok: true; campaign: Campaign } | { ok: false; error: string };

/** Le JSON d'une campagne, validé et complété des valeurs par défaut ; erreurs en français, la première seulement. */
export function parseCampaign(text: string): CampaignParse {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON illisible.' };
  }
  return normalizeCampaign(input);
}
export function normalizeCampaign(input: unknown): CampaignParse {
  const fail = (error: string): CampaignParse => ({ ok: false, error });
  if (!isRecord(input)) return fail('La campagne doit être un objet JSON.');
  const unknown = Object.keys(input).find((k) => k !== 'name' && k !== 'scenarios');
  if (unknown) return fail(`Champ inconnu « ${unknown} ».`);
  const name = input.name ?? 'campagne';
  if (typeof name !== 'string' || !name.trim() || name.length > 80)
    return fail('« name » doit être un texte de 1 à 80 caractères.');
  if (!Array.isArray(input.scenarios) || !input.scenarios.length || input.scenarios.length > 40)
    return fail('« scenarios » doit être une liste de 1 à 40 scénarios.');
  const scenarios: Scenario[] = [],
    ids = new Set<string>();
  for (const [index, raw] of input.scenarios.entries()) {
    const where = `Scénario ${index + 1}`;
    if (!isRecord(raw)) return fail(`${where} : un objet est attendu.`);
    const kind = raw.kind;
    if (typeof kind !== 'string' || !KINDS.includes(kind as ScenarioKind))
      return fail(`${where} : « kind » doit valoir ${KINDS.join(', ')}.`);
    const id = raw.id ?? String(index + 1);
    if (typeof id !== 'string' || !/^[\w.-]{1,32}$/.test(id))
      return fail(`${where} : « id » doit être un court identifiant (lettres, chiffres, . _ -).`);
    if (ids.has(id)) return fail(`${where} : l’identifiant « ${id} » est déjà pris.`);
    ids.add(id);
    const extra = Object.keys(raw).find((k) => k !== 'id' && k !== 'kind' && !FIELDS[kind as ScenarioKind].includes(k));
    if (extra) return fail(`${where} (${id}) : champ inconnu « ${extra} » pour « ${kind} ».`);
    const int = (field: string, fallback: number, min: number, max: number) => {
      const value = raw[field] ?? fallback;
      return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
    };
    const bad = (field: string, rule: string) => fail(`${where} (${id}) : « ${field} » ${rule}.`);
    if (kind === 'load') {
      const repeat = int('repeat', 1, 1, 10),
        settleSeconds = int('settleSeconds', 20, 0, 120);
      if (repeat === null) return bad('repeat', 'doit être un entier de 1 à 10');
      if (settleSeconds === null) return bad('settleSeconds', 'doit être un entier de 0 à 120');
      scenarios.push({ id, kind, repeat, settleSeconds });
    } else if (kind === 'undo') {
      const cells = int('cells', 60, 4, 144);
      if (cells === null) return bad('cells', 'doit être un entier de 4 à 144');
      scenarios.push({ id, kind, cells });
    } else {
      const seconds = int('seconds', kind === 'stroke' ? 30 : 60, 5, 600);
      if (seconds === null) return bad('seconds', 'doit être un entier de 5 à 600');
      if (kind === 'idle') scenarios.push({ id, kind, seconds });
      else if (kind === 'hover') {
        if ((raw.tool ?? 'terraform') !== 'terraform') return bad('tool', 'ne connaît que « terraform »');
        scenarios.push({ id, kind, tool: 'terraform', seconds });
      } else {
        const speed = raw.speed ?? 'slow',
          undo = raw.undo ?? true;
        if (speed !== 'slow' && speed !== 'fast') return bad('speed', 'doit valoir « slow » ou « fast »');
        if (typeof undo !== 'boolean') return bad('undo', 'doit valoir true ou false');
        scenarios.push({ id, kind: 'stroke', speed, seconds, undo });
      }
    }
  }
  return { ok: true, campaign: { name: name.trim(), scenarios } };
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Une anomalie d'une fenêtre de mesure ; `invalidates` : le scénario n'est plus valide. */
export interface Incident {
  type: 'background' | 'resize' | 'input' | 'reload' | 'refusal' | 'dialog' | 'undo' | 'zone' | 'error';
  /** Secondes depuis le début du scénario. */
  at: number;
  detail: string;
  invalidates: boolean;
}
export interface Mismatch {
  vertexX: number;
  vertexY: number;
  expected: number;
  actual: number | null;
}
export interface ScenarioResult {
  id: string;
  kind: ScenarioKind;
  valid: boolean;
  incidents: Incident[];
  startedAt: string;
  seconds: number;
  report: unknown;
  [measure: string]: unknown;
}
/** La zone des traits : les cases peintes. */
export interface StrokeZone {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Distance en cases du centre de la zone à l'ancre du village. */
  distance: number;
}
export interface CampaignRun {
  version: 1;
  status: 'running' | 'done' | 'stopped' | 'failed';
  campaign: Campaign;
  startedAt: string;
  finishedAt: string | null;
  /** L'état des statistiques avant la campagne, rétabli à la fin. */
  statisticsBefore: boolean;
  /** Prochaine étape : scénario et répétition (1 à `repeat` pour un chargement). */
  cursor: { index: number; repetition: number };
  /** Un chargement attend la page rechargée. */
  loading: { index: number; repetition: number } | null;
  /** Un scénario hors chargement en cours : un rechargement l'interrompt. */
  active: { index: number; repetition: number } | null;
  zone: (StrokeZone & { snapshot: [number, number, number][] }) | null;
  camera: unknown;
  /** Mode et pose caméra du joueur, rétablis à la fin. */
  restore: { mode: string; pose: unknown } | null;
  environment: Record<string, unknown> | null;
  results: ScenarioResult[];
  error: string | null;
  terrainRestored: boolean | null;
}

export function startRun(campaign: Campaign, statisticsBefore: boolean, now = new Date()): CampaignRun {
  return {
    version: 1,
    status: 'running',
    campaign,
    startedAt: now.toISOString(),
    finishedAt: null,
    statisticsBefore,
    cursor: { index: 0, repetition: 1 },
    loading: null,
    active: null,
    zone: null,
    camera: null,
    restore: null,
    environment: null,
    results: [],
    error: null,
    terrainRestored: null,
  };
}
/** L'étape à jouer, null quand la campagne est épuisée. */
export function currentStep(run: CampaignRun): { scenario: Scenario; index: number; repetition: number } | null {
  if (run.status !== 'running') return null;
  const scenario = run.campaign.scenarios[run.cursor.index];
  return scenario ? { scenario, index: run.cursor.index, repetition: run.cursor.repetition } : null;
}
/** Le résultat de l'étape courante est noté ; le curseur passe à la suivante. */
export function completeStep(run: CampaignRun, result: ScenarioResult): CampaignRun {
  const step = currentStep(run);
  if (!step) return run;
  const more = step.scenario.kind === 'load' && step.repetition < step.scenario.repeat;
  return {
    ...run,
    results: [...run.results, result],
    cursor: more ? { index: step.index, repetition: step.repetition + 1 } : { index: step.index + 1, repetition: 1 },
    loading: null,
    active: null,
  };
}
export function finishRun(
  run: CampaignRun,
  status: Exclude<CampaignRun['status'], 'running'>,
  error: string | null = null,
  now = new Date(),
): CampaignRun {
  return { ...run, status, error: error ?? run.error, finishedAt: now.toISOString(), loading: null, active: null };
}
/**
 * Ce qu'une page (re)chargée doit faire d'une campagne persistée : rien, mesurer
 * le chargement attendu, constater l'interruption d'un scénario par un
 * rechargement imprévu, ou poursuivre.
 */
export function resumeAction(run: CampaignRun | null): 'none' | 'load' | 'interrupted' | 'continue' {
  if (!run || run.status !== 'running') return 'none';
  if (run.loading) return 'load';
  if (run.active) return 'interrupted';
  return 'continue';
}

export const RUN_STORAGE_KEY = 'arbestra.dev.measure-campaign';
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function loadRun(storage: StorageLike | null): CampaignRun | null {
  try {
    const raw = storage?.getItem(RUN_STORAGE_KEY);
    if (!raw) return null;
    const run = JSON.parse(raw) as CampaignRun;
    return run?.version === 1 && Array.isArray(run.results) && run.campaign ? run : null;
  } catch {
    return null;
  }
}
export function saveRun(storage: StorageLike | null, run: CampaignRun | null) {
  try {
    if (run) storage?.setItem(RUN_STORAGE_KEY, JSON.stringify(run));
    else storage?.removeItem(RUN_STORAGE_KEY);
  } catch {
    /* Stockage facultatif : la campagne continue sans reprise. */
  }
}

/** Le JSON de résultats. */
export function campaignOutput(run: CampaignRun, release: string | null) {
  return {
    campaign: run.campaign.name,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    release,
    environment: run.environment,
    zone: run.zone && { x: run.zone.x, y: run.zone.y, w: run.zone.w, h: run.zone.h, distance: run.zone.distance },
    camera: run.camera,
    scenarios: run.results,
    terrainRestored: run.terrainRestored,
    error: run.error,
  };
}

/** Un scénario reste valide sans incident qui l'invalide. */
export const isValid = (incidents: readonly Incident[]) => !incidents.some((i) => i.invalidates);

/**
 * Surveille une fenêtre de mesure : onglet en arrière-plan, fenêtre
 * redimensionnée, souris ou clavier du joueur. Les gestes simulés ne sont pas
 * « de confiance » (`isTrusted` faux) et sont ignorés ; un déplacement de
 * souris sans mouvement (souris immobile sous un contenu qui change) aussi.
 * `ignore` écarte les gestes sur la bannière de la campagne (« Arrêter »).
 */
export class ValidityMonitor {
  #incidents: Incident[] = [];
  #started = 0;
  #armed = false;
  #size: { w: number; h: number };
  #detach: () => void;
  constructor(
    private readonly env: {
      window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'innerWidth' | 'innerHeight'>;
      document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'hidden'>;
      now?: () => number;
      ignore?: (target: EventTarget | null) => boolean;
    },
  ) {
    this.#size = { w: env.window.innerWidth, h: env.window.innerHeight };
    const input = (event: Event) => {
      if (!event.isTrusted || env.ignore?.(event.target)) return;
      if (event.type === 'pointermove') {
        const e = event as PointerEvent;
        if (!e.movementX && !e.movementY) return;
      }
      this.add('input', `geste du joueur (${event.type})`);
    };
    const visibility = () => {
      if (env.document.hidden) this.add('background', 'onglet passé en arrière-plan');
    };
    const resize = () => {
      const w = env.window.innerWidth,
        h = env.window.innerHeight;
      if (w === this.#size.w && h === this.#size.h) return;
      this.add('resize', `fenêtre ${this.#size.w}×${this.#size.h} → ${w}×${h}`);
      this.#size = { w, h };
    };
    const types = ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const;
    for (const type of types) env.window.addEventListener(type, input, { capture: true, passive: true });
    env.window.addEventListener('resize', resize);
    env.document.addEventListener('visibilitychange', visibility);
    this.#detach = () => {
      for (const type of types) env.window.removeEventListener(type, input, { capture: true });
      env.window.removeEventListener('resize', resize);
      env.document.removeEventListener('visibilitychange', visibility);
    };
  }
  #now() {
    return (this.env.now ?? (() => performance.now()))();
  }
  /** Une nouvelle fenêtre de mesure : incidents remis à zéro. `startedAt` : son origine (performance.now). */
  begin(startedAt = this.#now()) {
    this.#incidents = [];
    this.#started = startedAt;
    this.#armed = true;
    this.#size = { w: this.env.window.innerWidth, h: this.env.window.innerHeight };
    if (this.env.document.hidden) this.add('background', 'onglet en arrière-plan au début de la mesure');
  }
  /** Fin de la fenêtre : ses incidents. */
  end(): Incident[] {
    this.#armed = false;
    return this.#incidents;
  }
  get incidents(): readonly Incident[] {
    return this.#incidents;
  }
  /** Un incident ; un même type invalidant n'est noté qu'une fois par fenêtre. */
  add(type: Incident['type'], detail: string, invalidates = type !== 'refusal' && type !== 'dialog') {
    if (!this.#armed) return;
    if (invalidates && this.#incidents.some((i) => i.type === type && i.invalidates)) return;
    const at = Math.round(this.#now() - this.#started) / 1000;
    this.#incidents.push({ type, at, detail, invalidates });
  }
  dispose() {
    this.#detach();
  }
}

const wrap = (value: number, size: number) => ((value % size) + size) % size;
/** Les cases d'un rectangle (coordonnées ramenées sur le tore), ligne par ligne. */
export function zoneCells(zone: Pick<StrokeZone, 'x' | 'y' | 'w' | 'h'>, world: World): Cell[] {
  const cells: Cell[] = [];
  for (let j = 0; j < zone.h; j++)
    for (let i = 0; i < zone.w; i++)
      cells.push({ cellX: wrap(zone.x + i, world.widthCells), cellY: wrap(zone.y + j, world.heightCells) });
  return cells;
}
/** Le parcours d'un trait : les cases en serpentin, ligne après ligne ; `reverse` le prend à rebours. */
export function snakePath(zone: Pick<StrokeZone, 'x' | 'y' | 'w' | 'h'>, world: World, reverse = false): Cell[] {
  const path: Cell[] = [];
  for (let j = 0; j < zone.h; j++)
    for (let k = 0; k < zone.w; k++) {
      const i = j % 2 ? zone.w - 1 - k : k;
      path.push({ cellX: wrap(zone.x + i, world.widthCells), cellY: wrap(zone.y + j, world.heightCells) });
    }
  return reverse ? path.reverse() : path;
}

/**
 * La zone des traits, par lecture de l'état : le rectangle de cases peintes le
 * plus proche de l'ancre dont chaque case est « peignable » (aucun refus
 * prévisible, pour elle et l'anneau de 3 × 3 qu'elle déforme : voir le
 * runner). Les côtés valent au moins `minSide` (6 : zone libre d'au moins
 * 8 × 8 avec l'anneau) et la surface au moins `cells`. Recherche dans un carré
 * de `radius` cases autour de l'ancre, par sommes cumulées : O(radius²) par
 * forme. `accept` écarte une candidate (relief trop accidenté) ; la suivante
 * est essayée.
 */
export function findStrokeZone(query: {
  world: World;
  anchor: Cell;
  radius: number;
  paintable: (cell: Cell) => boolean;
  cells: number;
  minSide?: number;
  maxSide?: number;
  accept?: (zone: StrokeZone) => boolean;
}): StrokeZone | null {
  const { world, anchor, radius } = query,
    minSide = query.minSide ?? 6,
    maxSide = query.maxSide ?? 16,
    size = radius * 2 + 1,
    x0 = anchor.cellX - radius,
    y0 = anchor.cellY - radius;
  // sum[(j + 1) * (size + 1) + i + 1] : cases peignables du coin (0, 0) à (i, j) inclus.
  const sum = new Int32Array((size + 1) * (size + 1));
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const ok = query.paintable({ cellX: wrap(x0 + i, world.widthCells), cellY: wrap(y0 + j, world.heightCells) });
      sum[(j + 1) * (size + 1) + i + 1] =
        (ok ? 1 : 0) + sum[j * (size + 1) + i + 1]! + sum[(j + 1) * (size + 1) + i]! - sum[j * (size + 1) + i]!;
    }
  const count = (i: number, j: number, w: number, h: number) =>
    sum[(j + h) * (size + 1) + i + w]! -
    sum[j * (size + 1) + i + w]! -
    sum[(j + h) * (size + 1) + i]! +
    sum[j * (size + 1) + i]!;
  const shapes = new Map<string, [number, number]>();
  for (let w = minSide; w <= maxSide; w++) {
    const h = Math.max(minSide, Math.ceil(query.cells / w));
    if (h <= maxSide) shapes.set(`${w}x${h}`, [w, h]);
  }
  const found: StrokeZone[] = [];
  for (const [w, h] of shapes.values())
    for (let j = 0; j + h <= size; j++)
      for (let i = 0; i + w <= size; i++) {
        if (count(i, j, w, h) !== w * h) continue;
        const x = x0 + i,
          y = y0 + j;
        found.push({
          x: wrap(x, world.widthCells),
          y: wrap(y, world.heightCells),
          w,
          h,
          distance: Math.round(Math.hypot(x + (w - 1) / 2 - anchor.cellX, y + (h - 1) / 2 - anchor.cellY) * 10) / 10,
        });
      }
  found.sort((a, b) => a.distance - b.distance || a.w * a.h - b.w * b.h || a.y - b.y || a.x - b.x);
  return found.find((zone) => query.accept?.(zone) ?? true) ?? null;
}

/** Les sommets que peuvent toucher les traits d'une zone : les coins de ses cases et, par prudence
 * (un pointeur qui déborderait d'une case), ceux de leur pourtour. */
export function zoneVertices(zone: Pick<StrokeZone, 'x' | 'y' | 'w' | 'h'>, world: World) {
  const seen = new Map<string, { vertexX: number; vertexY: number }>();
  for (const cell of zoneCells({ x: zone.x - 1, y: zone.y - 1, w: zone.w + 2, h: zone.h + 2 }, world))
    for (const v of cellVertices(cell, world)) seen.set(vertexKey(v), v);
  return [...seen.values()];
}
/** Hauteurs des sommets, [x, y, hauteur] ; null quand un sommet n'est pas chargé. */
export function snapshotHeights(
  vertices: readonly { vertexX: number; vertexY: number }[],
  heightAt: (x: number, y: number) => number | null,
): [number, number, number][] | null {
  const out: [number, number, number][] = [];
  for (const v of vertices) {
    const h = heightAt(v.vertexX, v.vertexY);
    if (h === null || !Number.isFinite(h)) return null;
    out.push([v.vertexX, v.vertexY, h]);
  }
  return out;
}
/** Les sommets qui ne sont pas revenus à leur hauteur initiale (tolérance d'un millième de case). */
export function terrainMismatches(
  snapshot: readonly [number, number, number][],
  heightAt: (x: number, y: number) => number | null,
  tolerance = 1e-3,
): Mismatch[] {
  const out: Mismatch[] = [];
  for (const [vertexX, vertexY, expected] of snapshot) {
    const actual = heightAt(vertexX, vertexY);
    if (actual === null || !Number.isFinite(actual) || Math.abs(actual - expected) > tolerance)
      out.push({ vertexX, vertexY, expected, actual: actual === null || !Number.isFinite(actual) ? null : actual });
  }
  return out;
}
/** Le texte d'un échec de remise en état : les premiers sommets concernés. */
export function mismatchMessage(mismatches: readonly Mismatch[]) {
  const shown = mismatches
    .slice(0, 8)
    .map((m) => `(${m.vertexX}, ${m.vertexY}) ${m.actual === null ? '?' : m.actual} au lieu de ${m.expected}`);
  return `Terrain non rétabli : ${mismatches.length} sommet${mismatches.length > 1 ? 's' : ''} — ${shown.join(' ; ')}${mismatches.length > 8 ? ' …' : ''}`;
}

/** Libellé de la progression : « C2 · trait lent · 18 s / 30 s · ne touchez à rien ». */
export function scenarioLabel(scenario: Scenario, repetition = 1) {
  switch (scenario.kind) {
    case 'load':
      return `chargement ${repetition}/${scenario.repeat}`;
    case 'idle':
      return 'repos';
    case 'hover':
      return 'survol';
    case 'stroke':
      return `trait ${scenario.speed === 'slow' ? 'lent' : 'rapide'}${scenario.undo ? '' : ' sans annulation'}`;
    case 'undo':
      return `annulation de ${scenario.cells} cases`;
  }
}
