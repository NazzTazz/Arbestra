import { describe, expect, it } from 'vitest';
import {
  orderedTerrainEditGestures,
  terrainHeightPrecision,
  type TerrainEditStep,
  type TerrainVertex,
  type VillageState,
} from '@arbestra/contracts';
import { LiveStroke, type LiveStrokeResult } from './terraform-live';
import { terraformObstacles } from './terraform-refusals';
import { isUndoKey, TERRAFORM_UNDO_LIMIT, TerraformUndoRecord, TerraformUndoStack } from './terraform-undo';

const world = { widthCells: 64, heightCells: 64 };
const state = (roadCells: Array<{ cellX: number; cellY: number }> = []) =>
  ({
    world,
    village: { anchorCellX: 32, anchorCellY: 32 },
    cells: Array.from({ length: 64 * 64 }, (_, i) => ({ cellX: i % 64, cellY: Math.floor(i / 64), canBuild: true })),
    roadCells: roadCells.map((c) => ({ ...c, id: `${c.cellX},${c.cellY}` })),
    infrastructure: null,
  }) as unknown as VillageState;
const at = (cellX: number, cellY: number) => ({ cellX, cellY });
/** A sloped ground: every vertex at its own height, at the precision of stored heights (1e-6). */
const natural = (x: number, y: number) => terrainHeightPrecision(0.5 + ((x * 7 + y * 3) % 11) * 0.03);

/** The displayed ground, patched by predictions, and the stack that records the strokes on it. */
function harness() {
  const shown = new Map<string, number>(),
    frames: Array<() => void> = [],
    sent: TerrainEditStep[][] = [];
  const heightAt = (x: number, y: number) => shown.get(`${x}:${y}`) ?? natural(x, y);
  const stack = new TerraformUndoStack();
  let s = state();
  /** The App's wrapped `add`: recorded (heights read before the prediction), then predicted. */
  const add = (steps: TerrainEditStep[], vertices: readonly TerrainVertex[]) => {
    stack.current?.record(steps, vertices, heightAt);
    sent.push(steps);
    for (const v of vertices) shown.set(`${v.vertexX}:${v.vertexY}`, v.height);
  };
  const live = () =>
    new LiveStroke({
      world,
      obstacles: () => terraformObstacles(s),
      heightAt,
      apply: add,
      frame: (f) => frames.push(f),
    });
  const drain = () => {
    for (let i = 0; i < 50 && frames.length; i++) for (const f of frames.splice(0)) f();
  };
  /** A stroke painted and released. */
  const paint = (cells: Array<{ cellX: number; cellY: number }>, height: number) => {
    stack.begin();
    const stroke = live();
    stroke.paint(cells, height);
    let result: LiveStrokeResult | null = null;
    stroke.end((r) => (result = r));
    drain();
    stack.end();
    return result!;
  };
  /** Ctrl+Z: the inverse gesture of the last stroke, live, not recorded. */
  const undo = () => {
    const record = stack.pop();
    if (!record) return null;
    const steps = record.restoration(world, heightAt);
    const stroke = live();
    stroke.restore(steps);
    let result: LiveStrokeResult | null = null;
    stroke.end((r) => (result = r));
    drain();
    return { steps, result: result! };
  };
  return { shown, heightAt, stack, sent, paint, undo, setState: (next: VillageState) => (s = next) };
}
const snapshot = (heightAt: (x: number, y: number) => number) =>
  Array.from({ length: 30 * 30 }, (_, i) => heightAt(i % 30, Math.floor(i / 30)));

describe('undo of a terraforming stroke (docs/SPEC-TERRAFORMATION-OUTIL.md §7.10)', () => {
  it('gives back the ground before the stroke, through a live restoration, corner by corner', () => {
    const h = harness(),
      before = snapshot(h.heightAt);
    h.paint([at(10, 10), at(11, 10), at(12, 11), at(12, 12)], 2);
    expect(h.heightAt(11, 10)).toBe(2);
    const undone = h.undo()!;
    // One restored cell per painted cell; sent as restorations, live like a stroke.
    expect(undone.steps.map((s) => s.cell)).toEqual([at(10, 10), at(11, 10), at(12, 11), at(12, 12)]);
    expect(undone.result).toEqual({ refusals: [], sent: 4, changed: 4, unknown: false });
    expect(orderedTerrainEditGestures(h.sent.at(-1)!)[0]!.buildingType).toBe('terrain-restore');
    expect(snapshot(h.heightAt)).toEqual(before);
    // Not recorded itself: nothing more to undo.
    expect(h.stack.size).toBe(0);
  });

  it('restores a long stroke within the per-frame bound of a live stroke', () => {
    const h = harness(),
      before = snapshot(h.heightAt),
      cells = Array.from({ length: 60 }, (_, i) => at(i % 30, 2 + Math.floor(i / 30) * 3));
    h.paint(cells, 2);
    const painted = h.sent.length;
    h.undo();
    const frames = h.sent.slice(painted);
    expect(frames.map((f) => f.length)).toEqual([16, 16, 16, 12]);
    expect(snapshot(h.heightAt)).toEqual(before);
  });

  it('goes up the stack with repeated undos, stroke by stroke, in reverse order', () => {
    const h = harness(),
      first = snapshot(h.heightAt);
    h.paint([at(5, 5), at(6, 5)], 1.5);
    const second = snapshot(h.heightAt);
    // The second stroke repaints a cell of the first one.
    h.paint([at(6, 5), at(7, 5)], 3);
    h.undo();
    expect(snapshot(h.heightAt)).toEqual(second);
    h.undo();
    expect(snapshot(h.heightAt)).toEqual(first);
    expect(h.undo()).toBeNull();
  });

  it('has nothing to undo where the server refused a cell', () => {
    const record = new TerraformUndoRecord(),
      heights = new Map<string, number>();
    const heightAt = (x: number, y: number) => heights.get(`${x}:${y}`) ?? 1;
    record.record(
      [
        { cell: at(1, 1), height: 2 },
        { cell: at(8, 8), height: 2 },
      ],
      [
        { vertexX: 1, vertexY: 1, height: 2 },
        { vertexX: 8, vertexY: 8, height: 2 },
      ],
      heightAt,
    );
    heights.set('1:1', 2);
    heights.set('8:8', 2);
    record.refused(at(8, 8));
    // The refused cell came back to its height (release); only the accepted one is restored.
    expect(record.restoration(world, heightAt)).toEqual([
      { cell: at(1, 1), corners: [1, 1, 1, 1], expected: [2, 1, 1, 1] },
    ]);
  });

  it('skips a cell already back at its heights, and keeps the current height of corners it did not write', () => {
    const record = new TerraformUndoRecord(),
      heights = new Map<string, number>([['2:2', 5]]);
    const heightAt = (x: number, y: number) => heights.get(`${x}:${y}`) ?? 1;
    record.record([{ cell: at(1, 1), height: 5 }], [{ vertexX: 2, vertexY: 2, height: 5 }], (x, y) =>
      x === 2 && y === 2 ? 1 : heightAt(x, y),
    );
    expect(record.restoration(world, heightAt)).toEqual([
      { cell: at(1, 1), corners: [1, 1, 1, 1], expected: [1, 1, 5, 1] },
    ]);
    heights.delete('2:2');
    expect(record.restoration(world, heightAt)).toEqual([]);
  });

  it('restores only the intact vertices: a vertex changed since the stroke keeps its height (§7.10)', () => {
    const h = harness(),
      before = snapshot(h.heightAt);
    h.paint([at(10, 10), at(11, 10)], 2);
    // Another stroke or player moves vertex (11,10), shared by both cells, and a vertex of cell (12,*) nobody painted.
    h.shown.set('11:10', 3.5);
    const undone = h.undo()!;
    // The steps carry the heights the stroke left, for the server to check against its own terrain.
    expect(undone.steps.find((s) => s.cell.cellX === 10)!.expected).toEqual([2, 2, 2, 2]);
    expect(h.heightAt(11, 10)).toBe(3.5);
    expect(h.heightAt(10, 10)).toBe(natural(10, 10));
    expect(h.heightAt(12, 10)).toBe(natural(12, 10));
    expect(snapshot(h.heightAt).filter((v, i) => v !== before[i])).toEqual([3.5]);
    // Every vertex changed since: nothing is left to undo.
    h.paint([at(20, 20)], 2);
    for (const k of ['20:20', '21:20', '21:21', '20:21']) h.shown.set(k, 4);
    expect(h.undo()!.steps).toEqual([]);
  });

  it('keeps at most TERRAFORM_UNDO_LIMIT strokes, the oldest dropped; an empty stroke is not kept', () => {
    const stack = new TerraformUndoStack();
    stack.begin();
    expect(stack.end()).toBe(false);
    for (let i = 0; i < TERRAFORM_UNDO_LIMIT + 5; i++) {
      stack.begin().record([{ cell: at(i, 0), height: 1 }], [], () => 0);
      expect(stack.end()).toBe(true);
    }
    expect(stack.size).toBe(TERRAFORM_UNDO_LIMIT);
    expect([...stack.pop()!.cells.values()]).toEqual([at(TERRAFORM_UNDO_LIMIT + 4, 0)]);
    stack.clear();
    expect(stack.pop()).toBeNull();
  });

  it('tells the restoration the client refuses itself (a road laid since), with the pages of a stroke', () => {
    const h = harness();
    h.paint([at(20, 20), at(30, 30)], 2);
    h.setState(state([at(21, 21)]));
    const undone = h.undo()!;
    expect(undone.result.refusals).toEqual([{ reason: 'road', cell: at(21, 21) }]);
    expect(h.heightAt(20, 20)).toBe(2);
    expect(h.heightAt(30, 30)).toBe(natural(30, 30));
  });

  it('answers Ctrl+Z and Cmd+Z, not Ctrl+Shift+Z, nor in a text field or a dialog', () => {
    const key = (init: Partial<KeyboardEvent>) =>
      ({
        key: 'z',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        target: null,
        ...init,
      }) as KeyboardEvent;
    expect(isUndoKey(key({ ctrlKey: true }))).toBe(true);
    expect(isUndoKey(key({ metaKey: true, key: 'Z' }))).toBe(true);
    expect(isUndoKey(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isUndoKey(key({ key: 'z' }))).toBe(false);
    expect(isUndoKey(key({ ctrlKey: true, key: 'y' }))).toBe(false);
  });
});
