import { describe, expect, it, vi } from 'vitest';
import {
  ROAD_ANCHORS_PER_COMMAND,
  type RoadAnchor,
  type RoadAnchorsPreview,
  type RoadAnchorsRequest,
} from '@arbestra/contracts';
import {
  ANCHOR_SNAP_RADIUS,
  HIGHLIGHT_RADIUS,
  MAX_HIGHLIGHTS,
  RoadAnchorGesture,
  RoadAnchorIndex,
  anchorSummary,
  highlightedAnchors,
  snapAnchor,
  type Vertex,
} from './road-anchor-gesture';

const world = { widthCells: 64, heightCells: 32 };
const v = (vertexX: number, vertexY: number): Vertex => ({ vertexX, vertexY });
const cell = (cellX: number, cellY: number) => ({ cellX, cellY });
/** Eighths of a cell of a vertex, plus an offset in eighths. */
const at = (vertex: Vertex, dx = 0, dy = 0) => ({ x: vertex.vertexX * 8 - 4 + dx, y: vertex.vertexY * 8 - 4 + dy });
const row = (vertexX: number, vertexY: number, accessory: RoadAnchor['accessory']) => ({ vertexX, vertexY, accessory });

describe('snapAnchor (magnetic anchors)', () => {
  it('snaps within the radius only, by the nearest vertex', () => {
    expect(ANCHOR_SNAP_RADIUS).toBeLessThan(0.5);
    expect(snapAnchor(at(v(10, 5)), world)).toEqual(v(10, 5));
    // 3/8 of a cell away on one axis: inside 0.4.
    expect(snapAnchor(at(v(10, 5), 3, 0), world)).toEqual(v(10, 5));
    // 3/8 on both axes: 0.53 cell, outside.
    expect(snapAnchor(at(v(10, 5), 3, 3), world)).toBeNull();
    // A cell centre (4/8 from every corner on both axes) snaps to nothing.
    expect(snapAnchor({ x: 10 * 8, y: 5 * 8 }, world)).toBeNull();
    // A wider radius catches it.
    expect(snapAnchor(at(v(10, 5), 3, 3), world, 0.6)).toEqual(v(10, 5));
  });
  it('crosses the toric seams', () => {
    // Vertex 0 lies at eighth -4, i.e. width*8 - 4; a pointer just left of the seam reaches it.
    expect(snapAnchor({ x: 64 * 8 - 5, y: 31 * 8 + 3 }, world)).toEqual(v(0, 0));
    expect(snapAnchor({ x: 64 * 8 - 6, y: 32 * 8 - 3 }, world)).toEqual(v(0, 0));
    expect(snapAnchor({ x: 64 * 8 - 4, y: 32 * 8 - 4 }, world)).toEqual(v(0, 0));
  });
  it('snaps to free or occupied anchors alike; the mode decides what may be designated', () => {
    // An L of three cells: (5,5) (6,5) (5,6) has a re-entrant corner at vertex (6,6).
    const index = new RoadAnchorIndex([cell(5, 5), cell(6, 5), cell(5, 6)], [], world);
    const corner = snapAnchor(at(v(6, 6), 1, -2), world)!;
    expect(corner).toEqual(v(6, 6));
    expect(index.shown.get('6:6')).toEqual({ automatic: true });
    expect(index.designable(corner, 'place')).toBe(false);
    expect(index.designable(corner, 'remove')).toBe(true);
    const free = snapAnchor(at(v(5, 5), -2, 1), world)!;
    expect(index.designable(free, 'place')).toBe(true);
    expect(index.designable(free, 'remove')).toBe(false);
    // Far from the roads: not an anchor.
    expect(index.designable(v(20, 20), 'place')).toBe(false);
  });
});

describe('highlightedAnchors', () => {
  it('shows the free anchors near the pointer, bounded whatever the village size', () => {
    const cells = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) cells.push(cell(x, y));
    // Every vertex of the world is an anchor (no re-entrant corner in a full grid).
    const index = new RoadAnchorIndex(cells, [], world);
    const shown = highlightedAnchors(index, v(30, 15), 'place');
    expect(shown).toHaveLength(Math.min(MAX_HIGHLIGHTS, (2 * HIGHLIGHT_RADIUS + 1) ** 2));
    expect(shown[0]).toEqual(v(30, 15));
    // The closest first: nothing beyond the radius.
    expect(shown.every((p) => Math.abs(p.vertexX - 30) <= HIGHLIGHT_RADIUS)).toBe(true);
    const lookups = vi.spyOn(index, 'designable');
    highlightedAnchors(index, v(3, 3), 'place');
    expect(lookups).toHaveBeenCalledTimes((2 * HIGHLIGHT_RADIUS + 1) ** 2);
  });
  it('highlights a removed automatic brazier as free, and braziers in remove mode', () => {
    const cells = [cell(5, 5), cell(6, 5), cell(5, 6)];
    const removed = new RoadAnchorIndex(cells, [row(6, 6, 'none')], world);
    expect(removed.suppressed.has('6:6')).toBe(true);
    expect(highlightedAnchors(removed, v(6, 6), 'place')).toContainEqual(v(6, 6));
    const manual = new RoadAnchorIndex(cells, [row(5, 5, 'brazier')], world);
    expect(highlightedAnchors(manual, v(6, 6), 'remove')).toEqual(expect.arrayContaining([v(6, 6), v(5, 5)]));
    expect(highlightedAnchors(manual, v(6, 6), 'remove')).toHaveLength(2);
  });
});

function harness(designable: (vertex: Vertex) => boolean, previewResult: Partial<RoadAnchorsPreview> = {}) {
  const timers: Array<() => void> = [];
  const preview = vi.fn(async () => ({
    valid: true,
    code: null,
    message: null,
    quote: { stone: 2, wood: 1 },
    result: { placed: 1, restored: 0, removed: 0, unchanged: 0, stone: 2, wood: 1 },
    ...previewResult,
  }));
  const command = vi.fn(async (request: RoadAnchorsRequest) => ({
    placed: request.action === 'place' ? request.anchors.length : 0,
    restored: 0,
    removed: request.action === 'remove' ? request.anchors.length : 0,
    unchanged: 0,
    stone: 0,
    wood: 0,
  }));
  const added = vi.fn(),
    refused = vi.fn(),
    cleared = vi.fn(),
    designations = vi.fn(designable);
  let n = 0;
  const gesture = new RoadAnchorGesture({
    world,
    preview,
    command,
    designable: designations,
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    added,
    refused,
    cleared,
    setTimer: (run) => timers.push(run),
    clearTimer: () => {},
  });
  const flush = async () => {
    while (timers.length) timers.shift()!();
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  return { gesture, preview, command, added, refused, cleared, designations, flush };
}

describe('RoadAnchorGesture', () => {
  it('places a brazier on a click, with the quote shown', async () => {
    const h = harness(() => true);
    h.gesture.down(v(4, 4));
    h.gesture.up(v(4, 4));
    await h.flush();
    expect(h.preview).toHaveBeenCalledWith({ action: 'place', accessory: 'brazier', anchors: [v(4, 4)] });
    expect(h.command).toHaveBeenCalledTimes(1);
    expect(h.command.mock.calls[0]![0]).toMatchObject({
      action: 'place',
      accessory: 'brazier',
      anchors: [v(4, 4)],
      expectedQuote: { stone: 2, wood: 1 },
    });
    expect(h.gesture.notice).toBe('1 brasero posé');
    expect(h.cleared).toHaveBeenCalled();
  });
  it('sweeps the anchors crossed by a drag, keeps the designable ones, bounded per sample and per gesture', async () => {
    // Anchors only on row 4, every other one free.
    const h = harness((p) => p.vertexY === 4 && p.vertexX % 2 === 0);
    h.gesture.down(v(0, 4));
    h.gesture.move(null); // between anchors: ignored
    h.gesture.move(v(10, 4));
    expect([...h.gesture.vertices.values()]).toEqual([0, 2, 4, 6, 8, 10].map((x) => v(x, 4)));
    expect(h.added).toHaveBeenCalledTimes(2);
    // A long swipe: one lookup per vertex crossed, at most 64 anchors per gesture.
    const g = harness(() => true);
    g.gesture.down(v(0, 0));
    g.designations.mockClear();
    g.gesture.move(v(20, 0));
    expect(g.designations).toHaveBeenCalledTimes(20);
    g.gesture.move(v(20, 15));
    g.gesture.move(v(0, 15));
    g.gesture.up(v(0, 1));
    expect(g.gesture.limited).toBe(true);
    await g.flush();
    expect(g.command.mock.calls[0]![0].anchors).toHaveLength(ROAD_ANCHORS_PER_COMMAND);
  });
  it('shows the skipped anchors in red once, sends the gesture, and names the motive', async () => {
    const skipped = [{ vertexX: 2, vertexY: 4, code: 'ENGAGED_PASSAGE' as const }];
    const h = harness(() => true, {
      quote: { stone: 2, wood: 1 },
      result: { placed: 1, restored: 0, removed: 0, unchanged: 0, stone: 2, wood: 1, skipped },
    });
    h.gesture.down(v(0, 4));
    h.gesture.move(v(2, 4));
    await h.flush();
    expect(h.refused).toHaveBeenCalledTimes(1);
    expect(h.refused).toHaveBeenCalledWith([v(2, 4)]);
    h.gesture.up(v(2, 4));
    await h.flush();
    expect(h.refused).toHaveBeenCalledTimes(1);
    expect(h.command.mock.calls[0]![0]).toMatchObject({
      anchors: [v(0, 4), v(1, 4), v(2, 4)],
      expectedQuote: { stone: 2, wood: 1 },
    });
    expect(anchorSummary({ placed: 2, restored: 0, removed: 0, unchanged: 0, stone: 4, wood: 2, skipped })).toBe(
      '2 braseros posés · 1 sauté (trajet en cours) · −4 ◆ · −2 ▰',
    );
  });
  it('restores a removed automatic brazier for free through the same gesture', async () => {
    const index = new RoadAnchorIndex([cell(5, 5), cell(6, 5), cell(5, 6)], [row(6, 6, 'none')], world);
    const h = harness((p) => index.designable(p, 'place'), {
      quote: { stone: 0, wood: 0 },
      result: { placed: 0, restored: 1, removed: 0, unchanged: 0, stone: 0, wood: 0 },
    });
    h.command.mockResolvedValueOnce({ placed: 0, restored: 1, removed: 0, unchanged: 0, stone: 0, wood: 0 });
    h.gesture.down(v(6, 6));
    h.gesture.up(v(6, 6));
    await h.flush();
    expect(h.command.mock.calls[0]![0]).toMatchObject({ anchors: [v(6, 6)], expectedQuote: { stone: 0, wood: 0 } });
    expect(h.gesture.notice).toBe('1 brasero rétabli');
  });
  it('removes without a quote; a click away from any brazier sends nothing', async () => {
    const h = harness((p) => p.vertexX === 3);
    h.gesture.setMode('remove');
    h.gesture.down(v(9, 9));
    h.gesture.up(v(9, 9));
    expect(h.gesture.notice).toBe('Aucun brasero ici');
    h.gesture.down(v(3, 1));
    h.gesture.up(v(3, 1));
    await h.flush();
    expect(h.preview).not.toHaveBeenCalled();
    expect(h.command.mock.calls[0]![0]).toEqual({
      commandId: expect.any(String),
      action: 'remove',
      anchors: [v(3, 1)],
    });
    expect(h.gesture.notice).toBe('1 brasero retiré');
  });
  it('aborts a placement whose every anchor is refused, and keeps an uncertain outcome for an identical retry', async () => {
    const refusedAll = harness(() => true, { valid: false, message: 'Aucune route ici.' });
    refusedAll.gesture.down(v(1, 1));
    refusedAll.gesture.up(v(1, 1));
    await refusedAll.flush();
    expect(refusedAll.command).not.toHaveBeenCalled();
    expect(refusedAll.gesture.error).toBe('Aucune route ici.');
    const h = harness(() => true);
    h.command.mockRejectedValueOnce(Error('Réseau indisponible'));
    h.gesture.down(v(1, 1));
    h.gesture.up(v(1, 1));
    await h.flush();
    expect(h.gesture.uncertain).not.toBeNull();
    const first = h.command.mock.calls[0]![0];
    h.gesture.retry();
    await h.flush();
    expect(h.command.mock.calls[1]![0]).toBe(first);
    expect(h.gesture.uncertain).toBeNull();
  });
});
