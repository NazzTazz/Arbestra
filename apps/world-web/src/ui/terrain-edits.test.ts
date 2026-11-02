import { describe, expect, it } from 'vitest';
import type { TerrainEditGesture, TerrainEditsRequest, TerrainEditsResult } from '@arbestra/contracts';
import { TerrainEditQueue, terrainEditPages, type TerrainEditsDeps } from './terrain-edits';
import { SyncV2HttpError } from '../api/sync-v2-session';
import type { OraclePage } from './terraform-refusals';

const at = (cellX: number, cellY: number) => ({ cellX, cellY });
const stroke = (x: number): TerrainEditGesture => ({
  buildingType: 'terrain',
  anchor: at(x, 5),
  cells: [at(x, 5)],
  height: 1,
});
const vertices = (x: number) => [{ vertexX: x, vertexY: 5, height: 1 }];
const tick = () => new Promise((r) => setTimeout(r, 0));

function harness() {
  const log: string[] = [],
    sent: TerrainEditsRequest[] = [],
    answers: Array<{ resolve: (r: TerrainEditsResult) => void; reject: (e: unknown) => void }> = [],
    pages: OraclePage[][] = [];
  const deps: TerrainEditsDeps = {
    edit: (request) => {
      sent.push(request);
      log.push(`send ${request.gestures.map((g) => g.anchor.cellX).join(',')}`);
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
  const queue = new TerrainEditQueue(() => deps);
  return { queue, deps, log, sent, answers, pages };
}

describe('immediate terrain edits (docs/SPEC-TERRAFORMATION-OUTIL.md §7)', () => {
  it('predicts a stroke before sending it, at once, and releases the prediction on the answer', async () => {
    const h = harness();
    h.queue.add(stroke(1), vertices(1));
    expect(h.log).toEqual(['predict 1', 'send 1']);
    h.answers[0]!.resolve({ gestures: 1, unchanged: 0, vertices: 4 });
    await tick();
    expect(h.log).toEqual(['predict 1', 'send 1', 'release chunk-1']);
    expect(h.pages).toEqual([]);
  });

  it('sends one command at a time: strokes released meanwhile leave together, in painting order', async () => {
    const h = harness();
    h.queue.add(stroke(1), vertices(1));
    h.queue.add(stroke(2), vertices(2));
    h.queue.add(stroke(3), vertices(3));
    // Predicted at once, but not sent before the first answer.
    expect(h.log).toEqual(['predict 1', 'send 1', 'predict 2', 'predict 3']);
    expect(h.queue.pending).toEqual({ sending: true, queued: 2 });
    h.answers[0]!.resolve({ gestures: 1, unchanged: 0, vertices: 4 });
    await tick();
    expect(h.sent[1]!.gestures.map((g) => g.anchor.cellX)).toEqual([2, 3]);
    expect(h.log.slice(4)).toEqual(['release chunk-1', 'send 2,3']);
    h.answers[1]!.resolve({ gestures: 2, unchanged: 0, vertices: 8 });
    await tick();
    expect(h.log.slice(6)).toEqual(['release chunk-2', 'release chunk-3']);
    expect(h.queue.pending).toEqual({ sending: false, queued: 0 });
  });

  it('tells the refused units of a partly applied batch, one page per error, after releasing', async () => {
    const h = harness();
    h.queue.add(stroke(1), vertices(1));
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

  it('tells a whole refused batch from the 409 body, and only warns on another failure', async () => {
    const h = harness();
    h.queue.add(stroke(1), vertices(1));
    h.answers[0]!.reject(
      new SyncV2HttpError(409, 'INFRASTRUCTURE_OCCUPIED', 'Route.', 1000, false, 0, [
        { gesture: 0, cell: at(1, 5), code: 'INFRASTRUCTURE_OCCUPIED', at: at(1, 6) },
      ]),
    );
    await tick();
    expect(h.log).toContain('release chunk-1');
    expect(h.pages[0]!.map((p) => p.reason)).toEqual(['road']);
    h.queue.add(stroke(2), vertices(2));
    h.answers[1]!.reject(new Error('Réseau indisponible.'));
    await tick();
    expect(h.log.slice(-2)).toEqual(['notice Réseau indisponible.', 'release chunk-2']);
    expect(h.pages).toHaveLength(1);
  });

  it('releases at once a stroke it cannot send, and drops the queue of another village', async () => {
    const h = harness();
    const edit = h.deps.edit;
    h.deps.edit = null;
    h.queue.add(stroke(1), vertices(1));
    expect(h.log).toEqual([
      'predict 1',
      'notice Terraformation non envoyée : synchronisation du village en cours.',
      'release chunk-1',
    ]);
    h.deps.edit = edit;
    h.queue.add(stroke(2), vertices(2));
    h.queue.add(stroke(3), vertices(3));
    h.queue.drop();
    expect(h.log.at(-1)).toBe('release chunk-3');
    h.answers[0]!.resolve({ gestures: 1, unchanged: 0, vertices: 4 });
    await tick();
    expect(h.sent).toHaveLength(1);
  });

  it('names a server refusal at its obstacle cell, the painted cell otherwise', () => {
    const pages = terrainEditPages(
      [{ gesture: 0, cell: at(4, 4), code: 'LEVELING_FOUNDATION', at: at(5, 5) }],
      [{ anchor: at(4, 4) }],
      null,
    );
    expect(pages).toEqual([expect.objectContaining({ reason: 'foundation', inspect: at(5, 5), obstacle: 'building' })]);
  });
});
