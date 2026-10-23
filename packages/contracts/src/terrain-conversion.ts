import type { SpatialDimensions } from './building-footprint.js';
import type { TerrainVertex } from './terrain-vertices.js';

/** Preserve occupied cell centres (the building renderer's support heights).
 * On the fixed 00–11 diagonal, 2 * centre = h00 + h11. Each connected
 * component has one free value; choose the least change to natural corners.
 * Historical terrace corners remain pinned. Inconsistent constraints fail. */
export function preserveTerrainCentres(
  cells: readonly { cellX: number; cellY: number; height: number }[],
  world: SpatialDimensions,
  pinned: readonly TerrainVertex[],
  natural: (vertexX: number, vertexY: number) => number,
) {
  const wrap = (n: number, size: number) => ((n % size) + size) % size;
  const key = (v: Pick<TerrainVertex, 'vertexX' | 'vertexY'>) => `${v.vertexX}:${v.vertexY}`;
  const point = (x: number, y: number) => ({ vertexX: wrap(x, world.widthCells), vertexY: wrap(y, world.heightCells) });
  const fixed = new Map(pinned.map((v) => [key(v), v.height]));
  const vertices = new Map(pinned.map((v) => [key(v), v]));
  const graph = new Map<string, { point: ReturnType<typeof point>; edges: { key: string; sum: number }[] }>();
  const conflicts: string[] = [],
    visited = new Set<string>(),
    tolerance = 2e-6;
  for (const cell of cells) {
    if (!Number.isFinite(cell.height)) throw Error('Invalid foundation height');
    const a = point(cell.cellX, cell.cellY),
      b = point(cell.cellX + 1, cell.cellY + 1);
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const id = key(from),
        entry = graph.get(id) ?? { point: from, edges: [] };
      entry.edges.push({ key: key(to), sum: 2 * cell.height });
      graph.set(id, entry);
    }
  }
  for (const start of graph.keys()) {
    if (visited.has(start)) continue;
    const expressions = new Map<string, { sign: number; offset: number }>([[start, { sign: 1, offset: 0 }]]);
    const queue = [start];
    let root: number | undefined;
    const constrain = (value: number, id: string) => {
      if (root !== undefined && Math.abs(root - value) > tolerance) conflicts.push(id);
      else root = value;
    };
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!,
        expression = expressions.get(id)!,
        entry = graph.get(id)!;
      visited.add(id);
      const height = fixed.get(id);
      if (height !== undefined) constrain((height - expression.offset) / expression.sign, id);
      for (const edge of entry.edges) {
        const next = { sign: -expression.sign, offset: edge.sum - expression.offset },
          prior = expressions.get(edge.key);
        if (!prior) {
          expressions.set(edge.key, next);
          queue.push(edge.key);
        } else if (prior.sign !== next.sign)
          constrain((next.offset - prior.offset) / (prior.sign - next.sign), edge.key);
        else if (Math.abs(prior.offset - next.offset) > tolerance) conflicts.push(edge.key);
      }
    }
    root ??=
      queue.reduce((sum, id) => {
        const p = graph.get(id)!.point,
          e = expressions.get(id)!;
        return sum + e.sign * (natural(p.vertexX, p.vertexY) - e.offset);
      }, 0) / queue.length;
    for (const id of queue) {
      const e = expressions.get(id)!,
        height = fixed.get(id) ?? Math.round((e.sign * root + e.offset) * 1e6) / 1e6;
      vertices.set(id, { ...graph.get(id)!.point, height });
    }
  }
  return {
    vertices: [...vertices.values()].sort((a, b) => a.vertexX - b.vertexX || a.vertexY - b.vertexY),
    conflicts: [...new Set(conflicts)].sort(),
  };
}
