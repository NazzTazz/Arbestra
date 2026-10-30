import { describe, expect, it, vi } from 'vitest';
import { ROAD_CELLS_PER_COMMAND, type RoadCellsPreview, type RoadCellsRequest } from '@arbestra/contracts';
import { MAX_SWEEP_STEP, RoadCellGesture, sweptCells4, type Cell } from './road-cell-gesture';

const world = { widthCells: 64, heightCells: 32 };
const c = (cellX: number, cellY: number): Cell => ({ cellX, cellY });
const fourConnected = (from: Cell, cells: Cell[]) => {
  let prev = from;
  for (const cell of cells) {
    const dx = Math.min(Math.abs(cell.cellX - prev.cellX), world.widthCells - Math.abs(cell.cellX - prev.cellX)),
      dy = Math.min(Math.abs(cell.cellY - prev.cellY), world.heightCells - Math.abs(cell.cellY - prev.cellY));
    if (dx + dy !== 1) return false;
    prev = cell;
  }
  return true;
};

describe('sweptCells4', () => {
  it('fills a diagonal with side-sharing cells, without holes', () => {
    const cells = sweptCells4(c(2, 2), c(6, 5), world);
    expect(cells).toHaveLength(4 + 3);
    expect(cells.at(-1)).toEqual(c(6, 5));
    expect(fourConnected(c(2, 2), cells)).toBe(true);
  });
  it('follows straight lines and stays close to the segment', () => {
    expect(sweptCells4(c(5, 5), c(5, 2), world)).toEqual([c(5, 4), c(5, 3), c(5, 2)]);
    expect(sweptCells4(c(5, 5), c(8, 5), world)).toEqual([c(6, 5), c(7, 5), c(8, 5)]);
    // A shallow slope alternates its single vertical step near the middle.
    expect(sweptCells4(c(0, 0), c(4, 1), world)).toEqual([c(1, 0), c(2, 0), c(2, 1), c(3, 1), c(4, 1)]);
  });
  it('crosses the toric seams by the shortest way', () => {
    const cells = sweptCells4(c(62, 31), c(1, 0), world);
    expect(cells).toHaveLength(3 + 1);
    expect(cells.at(-1)).toEqual(c(1, 0));
    expect(fourConnected(c(62, 31), cells)).toBe(true);
    expect(cells.every((cell) => cell.cellX >= 0 && cell.cellX < 64 && cell.cellY >= 0 && cell.cellY < 32)).toBe(true);
  });
  it('is bounded per sample', () => {
    const cells = sweptCells4(c(0, 0), c(90, 45), { widthCells: 256, heightCells: 256 });
    expect(cells).toHaveLength(MAX_SWEEP_STEP);
    expect(fourConnected(c(0, 0), cells)).toBe(true);
    expect(sweptCells4(null, c(3, 4), world)).toEqual([c(3, 4)]);
  });
});

function harness(previewResult: Partial<RoadCellsPreview> = {}) {
  const timers: Array<() => void> = [];
  const preview = vi.fn(async () => ({
    valid: true,
    code: null,
    message: null,
    quote: { stone: 8 },
    result: { placed: 2, restyled: 0, removed: 0, unchanged: 0, stone: 8 },
    ...previewResult,
  }));
  const command = vi.fn(async (request: RoadCellsRequest) => ({
    placed: request.cells.length,
    restyled: 0,
    removed: 0,
    unchanged: 0,
    stone: 8,
  }));
  const added = vi.fn();
  const cleared = vi.fn();
  let n = 0;
  const gesture = new RoadCellGesture({
    world,
    preview,
    command,
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    added,
    cleared,
    setTimer: (run) => timers.push(run),
    clearTimer: () => {},
  });
  const flush = async () => {
    while (timers.length) timers.shift()!();
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  return { gesture, preview, command, added, cleared, flush, timers };
}

describe('RoadCellGesture', () => {
  it('poses one cell on a press without drag, with the quote shown', async () => {
    const h = harness();
    h.gesture.down(c(4, 4));
    h.gesture.up(c(4, 4));
    await h.flush();
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(h.command).toHaveBeenCalledTimes(1);
    expect(h.command.mock.calls[0]![0]).toMatchObject({
      action: 'place',
      cells: [c(4, 4)],
      style: { surface: 'earth', sidewalks: false },
      expectedQuote: { stone: 8 },
    });
    expect(h.gesture.cells.size).toBe(0);
    expect(h.gesture.notice).toBe('1 case posée · −8 ◆');
  });
  it('coalesces quotes and bounds the work of each pointer sample', async () => {
    const h = harness();
    h.gesture.down(c(0, 0));
    let maxAdded = 0;
    for (let x = 1; x <= 40; x++) {
      const before = h.gesture.cells.size;
      h.gesture.move(c(x, Math.floor(x / 3)));
      maxAdded = Math.max(maxAdded, h.gesture.cells.size - before);
    }
    // A sample far away is caught up MAX_SWEEP_STEP cells at a time.
    const before = h.gesture.cells.size;
    h.gesture.move(c(40, 31));
    expect(h.gesture.cells.size - before).toBeLessThanOrEqual(MAX_SWEEP_STEP);
    expect(maxAdded).toBeLessThanOrEqual(2);
    expect(h.added.mock.calls.every(([cells]) => cells.length <= MAX_SWEEP_STEP)).toBe(true);
    // One pending timer for the whole drag: no request per sample.
    expect(h.timers).toHaveLength(1);
    await h.flush();
    expect(h.preview).toHaveBeenCalledTimes(1);
    h.gesture.up(c(40, 20));
    await h.flush();
    expect(h.preview).toHaveBeenCalledTimes(2);
    const sent = h.command.mock.calls[0]![0];
    expect(new Set(sent.cells.map((cell) => `${cell.cellX}:${cell.cellY}`)).size).toBe(sent.cells.length);
    expect(fourConnected(c(0, 0), sent.cells.slice(1))).toBe(true);
  });
  it('stops at the command bound', () => {
    const h = harness();
    h.gesture.down(c(0, 0));
    for (let y = 0; y < 32; y += 2) {
      h.gesture.move(c(30, y));
      h.gesture.move(c(30, y + 1));
      h.gesture.move(c(0, y + 1));
      h.gesture.move(c(0, y + 2));
    }
    expect(h.gesture.cells.size).toBe(ROAD_CELLS_PER_COMMAND);
    expect(h.gesture.limited).toBe(true);
  });
  it('cancels the gesture in progress without sending anything', async () => {
    const h = harness();
    h.gesture.down(c(1, 1));
    h.gesture.move(c(5, 1));
    h.gesture.cancel();
    expect(h.cleared).toHaveBeenCalledTimes(1);
    h.gesture.up(c(5, 1));
    await h.flush();
    expect(h.command).not.toHaveBeenCalled();
  });
  it('shows a refusal and poses nothing when a cell is refused', async () => {
    const h = harness({ valid: false, code: 'CELL_OCCUPIED', message: 'Une case est occupée.' });
    h.gesture.down(c(1, 1));
    h.gesture.move(c(3, 1));
    h.gesture.up(c(3, 1));
    await h.flush();
    expect(h.command).not.toHaveBeenCalled();
    expect(h.gesture.error).toBe('Une case est occupée.');
    expect(h.gesture.cells.size).toBe(0);
  });
  it('removes without a quote and keeps an uncertain outcome for an identical retry', async () => {
    const h = harness();
    h.command.mockRejectedValueOnce(new Error('Réseau coupé'));
    h.gesture.setMode({ action: 'remove' });
    h.gesture.down(c(2, 2));
    h.gesture.up(c(2, 3));
    await h.flush();
    const first = h.command.mock.calls[0]![0];
    expect(first).toMatchObject({ action: 'remove', cells: [c(2, 2), c(2, 3)] });
    expect(h.gesture.uncertain).toBe(first);
    h.gesture.retry();
    await h.flush();
    expect(h.command.mock.calls[1]![0]).toBe(first);
    expect(h.gesture.uncertain).toBeNull();
  });
  it('sends a gesture released while the previous command is in flight, after it', async () => {
    const h = harness();
    let finish!: () => void;
    h.command.mockImplementationOnce(
      (request) =>
        new Promise((resolve) => {
          finish = () => resolve({ placed: request.cells.length, restyled: 0, removed: 0, unchanged: 0, stone: 8 });
        }),
    );
    h.gesture.down(c(1, 1));
    h.gesture.up(c(1, 1));
    await h.flush();
    expect(h.gesture.busy).toBe(true);
    h.gesture.down(c(5, 5));
    h.gesture.up(c(5, 6));
    await h.flush();
    expect(h.command).toHaveBeenCalledTimes(1);
    expect(h.gesture.cells.size).toBe(2);
    finish();
    await h.flush();
    expect(h.command).toHaveBeenCalledTimes(2);
    expect(h.command.mock.calls[1]![0].cells).toEqual([c(5, 5), c(5, 6)]);
    expect(h.gesture.cells.size).toBe(0);
  });
  it('drops a business refusal without retry', async () => {
    const h = harness();
    h.command.mockRejectedValueOnce(Object.assign(new Error('Devis périmé.'), { status: 409 }));
    h.gesture.down(c(2, 2));
    h.gesture.up(c(2, 2));
    await h.flush();
    expect(h.gesture.error).toBe('Devis périmé.');
    expect(h.gesture.uncertain).toBeNull();
  });
});
