import { describe, expect, it } from 'vitest';
import {
  orderedTerrainEditGestures,
  predictTerrainEdits,
  vertexLeveling,
  type TerrainEditPaint,
  type TerrainVertex,
  type VillageState,
} from '@arbestra/contracts';
import { LIVE_CELLS_PER_FRAME, LiveStroke, type LiveStrokeResult } from './terraform-live';
import { terraformObstacles } from './terraform-refusals';

const world = { widthCells: 64, heightCells: 64 };
const state = (roadCells: Array<{ cellX: number; cellY: number }> = []) =>
  ({
    world,
    village: { anchorCellX: 32, anchorCellY: 32 },
    cells: Array.from({ length: 64 * 64 }, (_, i) => ({
      cellX: i % 64,
      cellY: Math.floor(i / 64),
      canBuild: true,
    })),
    roadCells: roadCells.map((c) => ({ ...c, id: `${c.cellX},${c.cellY}` })),
  }) as unknown as VillageState;
const at = (cellX: number, cellY: number) => ({ cellX, cellY });
const byVertex = (a: { vertexX: number; vertexY: number }, b: { vertexX: number; vertexY: number }) =>
  a.vertexX - b.vertexX || a.vertexY - b.vertexY;

/** A live stroke over a displayed ground the predictions patch, frame by frame. */
function harness(s = state(), ground: (x: number, y: number) => number = () => 0.25) {
  const shown = new Map<string, number>(),
    frames: Array<() => void> = [],
    applied: Array<{ paints: TerrainEditPaint[]; vertices: TerrainVertex[]; frame: number }> = [];
  let frame = 0,
    result: LiveStrokeResult | null = null;
  const heightAt = (x: number, y: number) => shown.get(`${x}:${y}`) ?? ground(x, y);
  const live = new LiveStroke({
    world,
    obstacles: () => terraformObstacles(s),
    heightAt,
    apply: (paints, vertices) => {
      applied.push({ paints, vertices, frame });
      // The store's prediction: the displayed ground changes at once.
      for (const v of vertices) shown.set(`${v.vertexX}:${v.vertexY}`, v.height);
    },
    frame: (callback) => frames.push(callback),
  });
  const next = () => {
    frame++;
    for (const callback of frames.splice(0)) callback();
  };
  const end = () => live.end((r) => (result = r));
  const drain = () => {
    for (let i = 0; i < 20 && !result; i++) next();
  };
  return { live, shown, applied, next, end, drain, heightAt, result: () => result, frames };
}

describe('a stroke drawn live (docs/SPEC-TERRAFORMATION-OUTIL.md §7.9)', () => {
  it('changes the ground at each painted cell, before the pointer is released, as the server levels it', () => {
    const h = harness();
    h.live.paint([at(14, 14)], 1);
    // Applied at once, in the frame of the gesture.
    expect(h.applied).toHaveLength(1);
    expect(h.shown.get('14:14')).toBe(1);
    h.next();
    h.live.paint([at(15, 14), at(15, 15)], 1);
    expect(h.applied).toHaveLength(2);
    const cells = [at(14, 14), at(15, 14), at(15, 15)];
    const predicted = [...h.shown].map(([k, height]) => {
      const [vertexX, vertexY] = k.split(':').map(Number) as [number, number];
      return { vertexX, vertexY, height };
    });
    expect(predicted.sort(byVertex)).toEqual(vertexLeveling(cells, world, () => 0.25, 1, 1).vertices);
    expect(h.result()).toBeNull();
    h.end();
    h.drain();
    expect(h.result()).toEqual({ refusals: [], sent: 3, changed: 3, unknown: false });
  });

  it('skips the cell whose 3 × 3 holds a road, keeps painting, and names the road only at the end', () => {
    const h = harness(state([at(15, 15)]));
    h.live.paint([at(14, 14)], 1);
    h.next();
    h.live.paint([at(12, 12)], 1);
    expect(h.applied.flatMap((a) => a.paints.map((p) => p.cell))).toEqual([at(12, 12)]);
    expect(h.shown.has('14:14')).toBe(false);
    expect(h.result()).toBeNull();
    h.end();
    h.drain();
    expect(h.result()!.refusals).toEqual([{ reason: 'road', cell: at(15, 15) }]);
  });

  it('refuses a stroke at or under the water line as one error', () => {
    const h = harness();
    h.live.paint([at(14, 14)], 0);
    h.live.paint([at(15, 14)], 0);
    h.next();
    h.live.paint([at(16, 14)], 0);
    h.end();
    h.drain();
    expect(h.applied).toEqual([]);
    expect(h.result()!.refusals).toEqual([{ reason: 'water', cell: at(14, 14) }]);
  });

  it('sends a cell already at the height but changes nothing', () => {
    const h = harness();
    h.live.paint([at(14, 14)], 0.25);
    h.end();
    h.drain();
    expect(h.applied[0]!.vertices).toEqual([]);
    expect(h.result()).toMatchObject({ sent: 1, changed: 0 });
  });

  it('sends nothing on unloaded ground rather than predicting from nothing', () => {
    const h = harness(state(), () => NaN);
    h.live.paint([at(14, 14)], 1);
    h.end();
    h.drain();
    expect(h.applied).toEqual([]);
    expect(h.result()).toMatchObject({ sent: 0, unknown: true });
  });

  it('repaints a cell at a new height, never twice at the same one', () => {
    const h = harness();
    h.live.paint([at(14, 14)], 1);
    h.next();
    h.live.paint([at(14, 14)], 1);
    h.next();
    h.live.paint([at(14, 14)], 1.25);
    expect(h.applied.map((a) => a.paints)).toEqual([
      [{ cell: at(14, 14), height: 1 }],
      [{ cell: at(14, 14), height: 1.25 }],
    ]);
    expect(h.shown.get('15:15')).toBe(1.25);
  });

  it('bounds a fast stroke to one prediction of at most 16 cells per frame, in painting order, same result', () => {
    const ground = (x: number, y: number) => 0.25 + x * 0.01 + y * 0.02;
    const h = harness(state(), ground);
    // A flick: 60 cells crossed in one frame, then the height changes, then a back stroke.
    const flick = [
      ...Array.from({ length: 30 }, (_, i) => at(6 + i, 10 + (i % 3))),
      ...Array.from({ length: 30 }, (_, i) => at(34 - i, 14)),
    ];
    const paints: TerrainEditPaint[] = flick.map((cell) => ({ cell, height: 1 }));
    h.live.paint(flick, 1);
    expect(h.applied).toHaveLength(1);
    let frames = 0;
    for (; h.live.pending && frames < 100; frames++) {
      const before = h.applied.length;
      h.next();
      expect(h.applied.length - before).toBeLessThanOrEqual(1);
    }
    paints.push({ cell: at(20, 14), height: 1.5 });
    h.live.paint([at(20, 14)], 1.5);
    h.end();
    for (let i = 0; i < 10 && !h.result(); i++) h.next();
    // One application per frame, never more than the per-frame budget of cells.
    const perFrame = new Map<number, number>();
    for (const a of h.applied) {
      expect(a.paints.length).toBeLessThanOrEqual(LIVE_CELLS_PER_FRAME);
      perFrame.set(a.frame, (perFrame.get(a.frame) ?? 0) + 1);
    }
    expect(Math.max(...perFrame.values())).toBe(1);
    expect(frames).toBe(Math.ceil(60 / LIVE_CELLS_PER_FRAME) - 1);
    // Applied in painting order; the ground shown is the server's result for the gestures sent.
    expect(h.applied.flatMap((a) => a.paints)).toEqual(paints);
    const server = predictTerrainEdits(orderedTerrainEditGestures(paints), world, ground);
    for (const [key, v] of server) expect(h.shown.get(key)).toBe(v.height);
    expect(h.result()).toMatchObject({ sent: 61, refusals: [] });
  });
});
