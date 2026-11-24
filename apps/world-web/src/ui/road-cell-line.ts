import { wrapCoordinate, wrappedDistance, type RoadCellPosition } from '@arbestra/contracts';

type World = { widthCells: number; heightCells: number };

/**
 * Cells crossed from `from` (excluded) towards `to`, on the torus, in
 * 8-connexity (Bresenham): consecutive cells share a side or a corner, so a
 * pure diagonal move designates only the diagonal cells (no cardinal filler),
 * a cardinal move designates the cells of its row or column, and a shallow
 * slope mixes cardinal and diagonal steps. The line takes the shortest way
 * round each axis of the torus and has max(|dx|, |dy|) cells, so it is O(length)
 * with one array and one object per new cell.
 *
 * The cell on the minor axis rounds half up, which keeps the rule integer-only
 * and deterministic. At most `limit` cells, from the `from` side: the last one
 * is `to` only when it is reached within the limit. Without `from` the line is
 * the cell `to` alone; with `from` equal to `to` it is empty.
 */
export function sweptCells8(
  from: RoadCellPosition | null,
  to: RoadCellPosition,
  world: World,
  limit = Number.POSITIVE_INFINITY,
): RoadCellPosition[] {
  if (!from) return [to];
  const dx = wrappedDistance(to.cellX, from.cellX, world.widthCells),
    dy = wrappedDistance(to.cellY, from.cellY, world.heightCells),
    nx = Math.abs(dx),
    ny = Math.abs(dy),
    n = Math.max(nx, ny),
    sx = Math.sign(dx),
    sy = Math.sign(dy),
    steps = Math.min(limit, n);
  const cells: RoadCellPosition[] = [];
  for (let i = 1; i <= steps; i++) {
    // round(i * nx / n) and round(i * ny / n) in integers: one of them is exactly i.
    const ox = Math.floor((2 * i * nx + n) / (2 * n)),
      oy = Math.floor((2 * i * ny + n) / (2 * n));
    cells.push({
      cellX: wrapCoordinate(from.cellX + ox * sx, world.widthCells),
      cellY: wrapCoordinate(from.cellY + oy * sy, world.heightCells),
    });
  }
  return cells;
}

/**
 * Whether a pointer position (eighths of a cell; a cell is centred on a multiple of 8) lies in the
 * core of its cell: a diamond that stops short of the middles of its four sides. A drag designates a cell only
 * from its core, so a drag at about 45° passes between the cores of the two side cells and lays the
 * diagonal cells alone, while a drag along a row or a column, or through the middle of an elbow cell,
 * lays what it did. Integer arithmetic, O(1).
 */
export function inRoadCellCore(point: { x: number; y: number }): boolean {
  const offset = (v: number) => ((((v + 4) % 8) + 8) % 8) - 4;
  return Math.abs(offset(point.x)) + Math.abs(offset(point.y)) <= 3;
}
