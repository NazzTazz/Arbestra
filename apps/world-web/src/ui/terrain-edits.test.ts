import { describe, expect, it } from 'vitest';
import type { TerrainEditPaint, TerrainEditsRequest, TerrainEditsResult } from '@arbestra/contracts';
import { TerrainEditQueue, terrainEditPages, type TerrainEditsDeps } from './terrain-edits';
import { SyncV2HttpError } from '../api/sync-v2-session';
import type { OraclePage } from './terraform-refusals';

const at = (cellX: number, cellY: number) => ({ cellX, cellY });
/** One frame of a stroke: painted cells at height 1. */
const frame = (...xs: number[]): TerrainEditPaint[] => xs.map((x) => ({ cell: at(x, 5), height: 1 }));
const vertices = (x: number) => [{ vertexX: x, vertexY: 5, height: 1 }];
const tick = () => new Promise((r) => setTimeout(r, 0));

function harness(options: { intervalMs?: number; now?: () => number } = { intervalMs: 0 }) {
  const log: string[] = [],
    sent: TerrainEditsRequest[] = [],
    answers: Array<{ resolve: (r: TerrainEditsResult) => void; reject: (e: unknown) => void }> = [],
    pages: OraclePage[][] = [];
  const deps: TerrainEditsDeps = {
    edit: (request) => {
      sent.push(request);
      log.push(
        `send ${request.gestures.map((g) => ('cells' in g ? g.cells : [g.anchor]).map((c) => c.cellX).join('+')).join(',')}`,
      );
      return new Promise((resolve, reject) => answers.push({ resolve, reject }));
    },
    predict: (v) => {
      log.push(`predict ${v[0]!.vertexX}`);
      return [`chunk-${v[0]!.vertexX}`];
    },
    release: (keys) => log.push(`release ${keys.join(',')}`),
    obstacles: () => null,
    onRefusals: (p) => pages.push(p),
    onNotice: (message) => log.push(`notice ${message}`),
  };
  const queue = new TerrainEditQueue(() => deps, options);
  return { queue, deps, log, sent, answers, pages };
}

describe('live terrain edits (docs/SPEC-TERRAFORMATION-OUTIL.md §7.9)', () => {
  it('predicts a frame before sending it, at once, and releases the prediction on the answer', async () => {
    const h = harness();
    h.queue.add(frame(1), vertices(1));
    expect(h.log).toEqual(['predict 1', 'send 1']);
    h.answers[0]!.resolve({ gestures: 1, unchanged: 0, vertices: 4 });
    await tick();
    expect(h.log).toEqual(['predict 1', 'send 1', 'release chunk-1']);
    expect(h.pages).toEqual([]);
  });

  it('sends one command at a time: frames painted meanwhile leave together, as gestures in painting order', async () => {
    const h = harness();
    h.queue.add(frame(1), vertices(1));
    h.queue.add(frame(2, 3), vertices(2));
    h.queue.add(frame(5, 4), vertices(5));
    // Predicted at once, but not sent before the first answer.
    expect(h.log).toEqual(['predict 1', 'send 1', 'predict 2', 'predict 5']);
    expect(h.queue.pending).toEqual({ sending: true, queued: 2 });
    h.answers[0]!.resolve({ gestures: 1, unchanged: 0, vertices: 4 });
    await tick();
    // 2, 3, 5 increase: one gesture; 4 after 5 would be applied before it by the server: a new gesture.
    expect(h.sent[1]!.gestures).toEqual([
      { buildingType: 'terrain', anchor: at(2, 5), cells: [at(2, 5), at(3, 5), at(5, 5)], height: 1 },
      { buildingType: 'terrain', anchor: at(4, 5), cells: [at(4, 5)], height: 1 },
    ]);
    expect(h.log.slice(4)).toEqual(['release chunk-1', 'send 2+3+5,4']);
    h.answers[1]!.resolve({ gestures: 2, unchanged: 0, vertices: 8 });
    await tick();
    expect(h.log.slice(6)).toEqual(['release chunk-2', 'release chunk-5']);
    expect(h.queue.pending).toEqual({ sending: false, queued: 0 });
  });

  it('keeps a bounded cadence: at most one command per interval, whatever the pointer', async () => {
    let now = 1000;
    const h = harness({ intervalMs: 40, now: () => now });
    h.queue.add(frame(1), vertices(1));
    h.answers[0]!.resolve({ gestures: 1, unchanged: 0, vertices: 4 });
    await tick();
    h.queue.add(frame(2), vertices(2));
    h.queue.add(frame(3), vertices(3));
    await tick();
    expect(h.sent).toHaveLength(1);
    now = 1040;
    await new Promise((r) => setTimeout(r, 60));
    expect(h.sent).toHaveLength(2);
    expect(h.log.at(-1)).toBe('send 2+3');
  });

  it('tells the refused units of a partly applied batch, one page per error, after releasing', async () => {
    const h = harness();
    h.queue.add(frame(1), vertices(1));
    h.answers[0]!.resolve({
      gestures: 1,
      unchanged: 0,
      vertices: 4,
      refused: [
        { gesture: 0, cell: at(1, 5), code: 'CELL_OCCUPIED', at: at(2, 6) },
        { gesture: 0, cell: at(1, 6), code: 'CELL_OCCUPIED', at: at(2, 6) },
        { gesture: 0, cell: at(1, 7), code: 'OUTSIDE_VILLAGE_REACH', at: at(1, 8) },
      ],
    });
    await tick();
    expect(h.log.at(-1)).toBe('release chunk-1');
    expect(h.pages).toHaveLength(1);
    expect(h.pages[0]!.map((p) => [p.reason, p.inspect, p.obstacle])).toEqual([
      ['building', at(2, 6), 'building'],
      ['reach', at(1, 8), null],
    ]);
  });

  it('holds the server’s refusals while a stroke is drawn, and tells them when it ends', async () => {
    const h = harness();
    h.queue.stroke(true);
    h.queue.add(frame(1), vertices(1));
    h.answers[0]!.resolve({
      gestures: 1,
      unchanged: 0,
      vertices: 0,
      refused: [{ gesture: 0, cell: at(1, 5), code: 'LEVELING_FOUNDATION', at: at(2, 6) }],
    });
    await tick();
    expect(h.log.at(-1)).toBe('release chunk-1');
    expect(h.pages).toEqual([]);
    h.queue.stroke(false);
    expect(h.pages.map((p) => p.map((page) => page.reason))).toEqual([['foundation']]);
    h.queue.stroke(false);
    expect(h.pages).toHaveLength(1);
  });

  it('tells a whole refused batch from the 409 body, and only warns on another failure', async () => {
    const h = harness();
    h.queue.add(frame(1), vertices(1));
    h.answers[0]!.reject(
      new SyncV2HttpError(409, 'INFRASTRUCTURE_OCCUPIED', 'Route.', 1000, false, 0, [
        { gesture: 0, cell: at(1, 5), code: 'INFRASTRUCTURE_OCCUPIED', at: at(1, 6) },
      ]),
    );
    await tick();
    expect(h.log).toContain('release chunk-1');
    expect(h.pages[0]!.map((p) => p.reason)).toEqual(['road']);
    h.queue.add(frame(2), vertices(2));
    h.answers[1]!.reject(new Error('Réseau indisponible.'));
    await tick();
    expect(h.log.slice(-2)).toEqual(['notice Réseau indisponible.', 'release chunk-2']);
    expect(h.pages).toHaveLength(1);
  });

  it('releases at once a frame it cannot send, and drops the queue of another village', async () => {
    const h = harness();
    const edit = h.deps.edit;
    h.deps.edit = null;
    h.queue.add(frame(1), vertices(1));
    expect(h.log).toEqual([
      'predict 1',
      'notice Terraformation non envoyée : synchronisation du village en cours.',
      'release chunk-1',
    ]);
    h.deps.edit = edit;
    h.queue.add(frame(2), vertices(2));
    h.queue.add(frame(3), vertices(3));
    h.queue.drop();
    expect(h.log.at(-1)).toBe('release chunk-3');
    h.answers[0]!.resolve({ gestures: 1, unchanged: 0, vertices: 4 });
    await tick();
    expect(h.sent).toHaveLength(1);
  });

  it('sends restored cells as restoration gestures and tells the owner of a frame its refused cells', async () => {
    const h = harness();
    const refused: string[] = [];
    const owner = { refused: (c: { cellX: number; cellY: number }) => refused.push(`${c.cellX}:${c.cellY}`) };
    h.queue.add(frame(1, 2), vertices(1), owner);
    h.queue.add([{ cell: at(9, 5), corners: [1, 2, 3, 4] }], vertices(9));
    h.answers[0]!.resolve({ gestures: 1, unchanged: 0, vertices: 6 });
    await tick();
    expect(h.sent[1]!.gestures).toEqual([
      { buildingType: 'terrain-restore', cells: [{ cellX: 9, cellY: 5, corners: [1, 2, 3, 4] }] },
    ]);
    h.answers[1]!.resolve({ gestures: 0, unchanged: 1, vertices: 0 });
    await tick();
    // A refused painted cell is forgotten by its stroke's undo record.
    h.queue.add(frame(3, 4), vertices(3), owner);
    h.answers[2]!.resolve({
      gestures: 1,
      unchanged: 0,
      vertices: 4,
      refused: [{ gesture: 0, cell: at(4, 5), code: 'LEVELING_FOUNDATION', at: at(5, 6) }],
    });
    await tick();
    expect(refused).toEqual(['4:5']);
  });

  it('names a server refusal at its obstacle cell, the painted cell otherwise', () => {
    const pages = terrainEditPages(
      [{ gesture: 0, cell: at(4, 4), code: 'LEVELING_FOUNDATION', at: at(5, 5) }],
      [{ buildingType: 'terrain', anchor: at(4, 4), cells: [at(4, 4)], height: 1 }],
      null,
    );
    expect(pages).toEqual([expect.objectContaining({ reason: 'foundation', inspect: at(5, 5), obstacle: 'building' })]);
  });
});
