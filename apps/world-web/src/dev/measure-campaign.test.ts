import { describe, expect, it } from 'vitest';
import {
  campaignOutput,
  completeStep,
  currentStep,
  DEFAULT_CAMPAIGN,
  DEFAULT_CAMPAIGN_TEXT,
  findStrokeZone,
  finishRun,
  isValid,
  loadRun,
  mismatchMessage,
  parseCampaign,
  resumeAction,
  RUN_STORAGE_KEY,
  saveRun,
  scenarioLabel,
  snakePath,
  snapshotHeights,
  startRun,
  terrainMismatches,
  ValidityMonitor,
  zoneVertices,
  type CampaignRun,
  type ScenarioResult,
} from './measure-campaign';
import { TerraformUndoStack } from '../ui/terraform-undo';

const world = { widthCells: 64, heightCells: 32 };
const result = (id: string, kind: ScenarioResult['kind'] = 'load'): ScenarioResult => ({
  id,
  kind,
  valid: true,
  incidents: [],
  startedAt: '2026-11-03T10:00:00.000Z',
  seconds: 1,
  report: { window: {} },
});
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('campaign input', () => {
  it('accepts the default campaign unchanged and fills the defaults', () => {
    expect(parseCampaign(DEFAULT_CAMPAIGN_TEXT)).toEqual({ ok: true, campaign: DEFAULT_CAMPAIGN });
    const parsed = parseCampaign(
      JSON.stringify({
        scenarios: [{ kind: 'load' }, { kind: 'stroke', speed: 'fast' }, { kind: 'undo' }, { kind: 'hover' }],
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      campaign: {
        name: 'campagne',
        scenarios: [
          { id: '1', kind: 'load', repeat: 1, settleSeconds: 20 },
          { id: '2', kind: 'stroke', speed: 'fast', seconds: 30, undo: true },
          { id: '3', kind: 'undo', cells: 60 },
          { id: '4', kind: 'hover', tool: 'terraform', seconds: 60 },
        ],
      },
    });
  });
  it.each([
    ['{', 'JSON illisible.'],
    ['[]', 'La campagne doit être un objet JSON.'],
    ['{"scenarios":[]}', '« scenarios » doit être une liste de 1 à 40 scénarios.'],
    ['{"scenarios":[],"extra":1}', 'Champ inconnu « extra ».'],
    ['{"scenarios":[{"kind":"jump"}]}', 'Scénario 1 : « kind » doit valoir load, idle, hover, stroke, undo.'],
    [
      '{"scenarios":[{"id":"A","kind":"idle"},{"id":"A","kind":"idle"}]}',
      'Scénario 2 : l’identifiant « A » est déjà pris.',
    ],
    [
      '{"scenarios":[{"id":"A","kind":"idle","seconds":2}]}',
      'Scénario 1 (A) : « seconds » doit être un entier de 5 à 600.',
    ],
    [
      '{"scenarios":[{"id":"A","kind":"idle","speed":"slow"}]}',
      'Scénario 1 (A) : champ inconnu « speed » pour « idle ».',
    ],
    [
      '{"scenarios":[{"id":"A","kind":"stroke","speed":"medium"}]}',
      'Scénario 1 (A) : « speed » doit valoir « slow » ou « fast ».',
    ],
    ['{"scenarios":[{"id":"A","kind":"stroke","undo":"yes"}]}', 'Scénario 1 (A) : « undo » doit valoir true ou false.'],
    [
      '{"scenarios":[{"id":"A","kind":"load","repeat":1.5}]}',
      'Scénario 1 (A) : « repeat » doit être un entier de 1 à 10.',
    ],
    [
      '{"scenarios":[{"id":"A","kind":"hover","tool":"road"}]}',
      'Scénario 1 (A) : « tool » ne connaît que « terraform ».',
    ],
    [
      '{"scenarios":[{"id":"a b","kind":"idle"}]}',
      'Scénario 1 : « id » doit être un court identifiant (lettres, chiffres, . _ -).',
    ],
  ])('refuses %s', (text, error) => {
    expect(parseCampaign(text)).toEqual({ ok: false, error });
  });
  it('labels the progress of each kind', () => {
    expect(DEFAULT_CAMPAIGN.scenarios.map((s) => scenarioLabel(s, 2))).toEqual([
      'chargement 2/3',
      'repos',
      'survol',
      'trait lent',
      'trait rapide',
      'annulation de 60 cases',
    ]);
  });
});

describe('campaign state machine', () => {
  it('repeats the loads, advances, and resumes after each reload from storage', () => {
    const storage = memoryStorage();
    let run: CampaignRun = startRun(DEFAULT_CAMPAIGN, false, new Date('2026-11-03T10:00:00Z'));
    expect(currentStep(run)).toMatchObject({ index: 0, repetition: 1, scenario: { id: 'A' } });
    expect(resumeAction(run)).toBe('continue');
    // Avant un rechargement : le chargement est annoncé, puis la page part.
    run = { ...run, loading: { index: 0, repetition: 1 } };
    saveRun(storage, run);
    let reloaded = loadRun(storage)!;
    expect(reloaded).toEqual(run);
    expect(resumeAction(reloaded)).toBe('load');
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const step = currentStep(reloaded)!;
      seen.push(`${step.scenario.id}${step.repetition}`);
      reloaded = completeStep(reloaded, result(step.scenario.id));
      expect(reloaded.loading).toBeNull();
      saveRun(storage, {
        ...reloaded,
        loading: step.repetition < 3 ? { index: 0, repetition: step.repetition + 1 } : null,
      });
      reloaded = loadRun(storage)!;
    }
    expect(seen).toEqual(['A1', 'A2', 'A3']);
    expect(resumeAction(reloaded)).toBe('continue');
    expect(currentStep(reloaded)).toMatchObject({ index: 1, repetition: 1, scenario: { id: 'B' } });
    // Un rechargement pendant un scénario sur la zone l’interrompt.
    reloaded = { ...reloaded, active: { index: 1, repetition: 1 } };
    expect(resumeAction(reloaded)).toBe('interrupted');
    for (const id of ['B', 'C1', 'C2', 'C3', 'C4']) reloaded = completeStep(reloaded, result(id, 'idle'));
    expect(currentStep(reloaded)).toBeNull();
    expect(reloaded.results.map((r) => r.id)).toEqual(['A', 'A', 'A', 'B', 'C1', 'C2', 'C3', 'C4']);
    const done = finishRun(reloaded, 'done', null, new Date('2026-11-03T10:20:00Z'));
    expect(resumeAction(done)).toBe('none');
    expect(currentStep(done)).toBeNull();
    expect(completeStep(done, result('X'))).toBe(done);
  });
  it('ignores a damaged or foreign stored state', () => {
    const storage = memoryStorage();
    expect(loadRun(storage)).toBeNull();
    storage.setItem(RUN_STORAGE_KEY, '{oops');
    expect(loadRun(storage)).toBeNull();
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({ version: 2, results: [], campaign: {} }));
    expect(loadRun(storage)).toBeNull();
    saveRun(storage, null);
    expect(storage.data.size).toBe(0);
    expect(resumeAction(null)).toBe('none');
  });
  it('writes the output format', () => {
    let run = startRun(DEFAULT_CAMPAIGN, true, new Date('2026-11-03T10:00:00Z'));
    run = {
      ...run,
      environment: { renderer: 'ANGLE', userAgent: 'UA', viewport: '1440×900', dpr: 1 },
      zone: { x: 10, y: 4, w: 6, h: 6, distance: 7.5, snapshot: [[10, 4, 1]] },
      camera: { cellX: 12.5 },
    };
    run = completeStep(run, result('A'));
    run = { ...finishRun(run, 'stopped', null, new Date('2026-11-03T10:05:00Z')), terrainRestored: true };
    const output = campaignOutput(run, 'alpha-2026.11.02.1');
    expect(output).toEqual({
      campaign: 'terraformation-v1',
      status: 'stopped',
      startedAt: '2026-11-03T10:00:00.000Z',
      finishedAt: '2026-11-03T10:05:00.000Z',
      release: 'alpha-2026.11.02.1',
      environment: { renderer: 'ANGLE', userAgent: 'UA', viewport: '1440×900', dpr: 1 },
      zone: { x: 10, y: 4, w: 6, h: 6, distance: 7.5 },
      camera: { cellX: 12.5 },
      scenarios: [result('A')],
      terrainRestored: true,
      error: null,
    });
    // Du JSON simple : ni relevé de hauteurs, ni valeur perdue à la relecture.
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
  });
});

/** Une fenêtre et un document factices : écouteurs appelés avec des événements faits main (de confiance ou non). */
function fakeEnvironment() {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const target = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => listeners.get(type)?.delete(fn),
  };
  let now = 1000;
  const env = {
    window: { ...target, innerWidth: 1440, innerHeight: 900 },
    document: { ...target, hidden: false },
    now: () => now,
    ignore: (t: EventTarget | null) => t === ('banner' as unknown as EventTarget),
  };
  const fire = (type: string, event: Record<string, unknown> = {}) => {
    for (const fn of listeners.get(type) ?? []) fn({ type, isTrusted: true, target: null, ...event });
  };
  return { env, fire, listeners, advance: (ms: number) => (now += ms) };
}

describe('measure validity', () => {
  it('invalidates a window when the tab goes to the background, once per kind', () => {
    const { env, fire, advance } = fakeEnvironment();
    const monitor = new ValidityMonitor(env as never);
    fire('visibilitychange');
    monitor.begin();
    advance(2500);
    fire('visibilitychange'); // Visible : rien.
    env.document.hidden = true;
    fire('visibilitychange');
    fire('visibilitychange');
    const incidents = monitor.end();
    expect(incidents).toEqual([
      { type: 'background', at: 2.5, detail: 'onglet passé en arrière-plan', invalidates: true },
    ]);
    expect(isValid(incidents)).toBe(false);
    // Hors fenêtre, rien n’est noté ; un onglet caché au début l’est.
    fire('visibilitychange');
    expect(monitor.incidents).toHaveLength(1);
    monitor.begin();
    expect(monitor.end()).toMatchObject([{ type: 'background', at: 0 }]);
  });
  it('ignores simulated gestures, a still mouse and the banner; notes the player and a resize', () => {
    const { env, fire, listeners } = fakeEnvironment();
    const monitor = new ValidityMonitor(env as never);
    monitor.begin();
    fire('pointermove', { isTrusted: false, movementX: 5 });
    fire('keydown', { isTrusted: false });
    fire('pointermove', { movementX: 0, movementY: 0 });
    fire('pointerdown', { target: 'banner' });
    fire('resize'); // Même taille.
    expect(monitor.incidents).toEqual([]);
    monitor.add('refusal', 'refus de l’Oracle : eau');
    expect(isValid(monitor.incidents)).toBe(true);
    fire('pointermove', { movementX: 3 });
    fire('wheel');
    env.window.innerWidth = 1200;
    fire('resize');
    const incidents = monitor.end();
    expect(incidents.map((i) => [i.type, i.invalidates])).toEqual([
      ['refusal', false],
      ['input', true],
      ['resize', true],
    ]);
    expect(incidents[2]!.detail).toBe('fenêtre 1440×900 → 1200×900');
    monitor.dispose();
    expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
  });
});

describe('stroke zone', () => {
  it('finds the nearest free rectangle, its snake and its vertices', () => {
    // Libre partout sauf une colonne de route en x = 20 et un bâtiment près de l’ancre.
    const blocked = (c: { cellX: number; cellY: number }) =>
      c.cellX === 20 || (c.cellX >= 22 && c.cellX <= 27 && c.cellY >= 8 && c.cellY <= 13);
    const zone = findStrokeZone({
      world,
      anchor: { cellX: 24, cellY: 10 },
      radius: 12,
      paintable: (c) => !blocked(c),
      cells: 36,
    })!;
    expect(zone).toMatchObject({ w: 6, h: 6 });
    for (let i = 0; i < zone.w; i++)
      for (let j = 0; j < zone.h; j++) expect(blocked({ cellX: zone.x + i, cellY: zone.y + j })).toBe(false);
    expect(zone.distance).toBeLessThanOrEqual(6);
    // Déterministe.
    expect(
      findStrokeZone({ world, anchor: { cellX: 24, cellY: 10 }, radius: 12, paintable: (c) => !blocked(c), cells: 36 }),
    ).toEqual(zone);
    const path = snakePath({ x: 1, y: 2, w: 3, h: 2 }, world);
    expect(path.map((c) => `${c.cellX},${c.cellY}`)).toEqual(['1,2', '2,2', '3,2', '3,3', '2,3', '1,3']);
    expect(snakePath({ x: 1, y: 2, w: 3, h: 2 }, world, true)[0]).toEqual({ cellX: 1, cellY: 3 });
    expect(zoneVertices({ x: 1, y: 2, w: 3, h: 2 }, world)).toHaveLength(6 * 5);
  });
  it('wraps around the torus, honours the area, the filter, and returns null without room', () => {
    const anchor = { cellX: 0, cellY: 0 };
    const zone = findStrokeZone({ world, anchor, radius: 6, paintable: () => true, cells: 60 })!;
    expect(zone.w * zone.h).toBeGreaterThanOrEqual(60);
    expect(Math.min(zone.w, zone.h)).toBeGreaterThanOrEqual(6);
    expect(zone.x).toBeGreaterThanOrEqual(0);
    expect(zone.y).toBeGreaterThanOrEqual(0);
    expect(snakePath(zone, world).every((c) => c.cellX < world.widthCells && c.cellY < world.heightCells)).toBe(true);
    const rejected = findStrokeZone({
      world,
      anchor,
      radius: 6,
      paintable: () => true,
      cells: 36,
      accept: (z) => z.x === 1,
    });
    expect(rejected?.x).toBe(1);
    expect(findStrokeZone({ world, anchor, radius: 6, paintable: (c) => c.cellX % 5 !== 0, cells: 36 })).toBeNull();
  });
});

describe('terrain restoration check', () => {
  it('compares every touched vertex with its initial height', () => {
    const heights = new Map<string, number>();
    const at = (x: number, y: number) => heights.get(`${x}:${y}`) ?? 1;
    const vertices = zoneVertices({ x: 4, y: 4, w: 2, h: 2 }, world);
    const snapshot = snapshotHeights(vertices, at)!;
    // 2 × 2 cases et leur pourtour : 4 × 4 cases, 5 × 5 sommets.
    expect(snapshot).toHaveLength(25);
    expect(snapshotHeights(vertices, (x) => (x === 5 ? null : 1))).toBeNull();
    expect(terrainMismatches(snapshot, at)).toEqual([]);
    heights.set('5:5', 1.25);
    heights.set('4:4', 1.0004); // Dans la tolérance.
    expect(terrainMismatches(snapshot, at)).toEqual([{ vertexX: 5, vertexY: 5, expected: 1, actual: 1.25 }]);
    expect(terrainMismatches(snapshot, (x, y) => (x === 6 && y === 6 ? null : at(x, y)))).toContainEqual({
      vertexX: 6,
      vertexY: 6,
      expected: 1,
      actual: null,
    });
    expect(mismatchMessage(terrainMismatches(snapshot, at))).toBe(
      'Terrain non rétabli : 1 sommet — (5, 5) 1.25 au lieu de 1',
    );
  });
  it('lets the campaign recognise its own stroke on the undo stack', () => {
    const stack = new TerraformUndoStack(2);
    expect(stack.last).toBeNull();
    stack.begin().record([{ cell: { cellX: 1, cellY: 1 }, height: 1 }], [], () => 0);
    stack.end();
    const first = stack.last;
    expect(first).not.toBeNull();
    stack.begin();
    stack.end(); // Rien de peint : non gardé, le sommet de la pile ne change pas.
    expect(stack.last).toBe(first);
    expect(stack.pop()).toBe(first);
    expect(stack.last).toBeNull();
  });
});
