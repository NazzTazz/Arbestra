/** Where provisioning tries to found the bot villages (pure). `cluster` packs
 * them around one point, as a crowded region; `spread` scatters them over the
 * whole torus, in a reproducible order. The installation plan of the game
 * still decides: a refused point is skipped. */
export type Layout = 'cluster' | 'spread';
export interface Point {
  x: number;
  y: number;
}
export interface WorldSize {
  widthCells: number;
  heightCells: number;
}

/** Deterministic PRNG (mulberry32): same seed, same sequence. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (value: number, size: number) => ((value % size) + size) % size;
/** Chebyshev distance on the torus. */
export function torusDistance(a: Point, b: Point, world: WorldSize): number {
  const dx = Math.abs(wrap(a.x - b.x, world.widthCells)),
    dy = Math.abs(wrap(a.y - b.y, world.heightCells));
  return Math.max(Math.min(dx, world.widthCells - dx), Math.min(dy, world.heightCells - dy));
}
export const farEnough = (point: Point, others: readonly Point[], minimum: number, world: WorldSize) =>
  others.every((other) => torusDistance(point, other, world) >= minimum);

export function* candidatePoints(
  layout: Layout,
  world: WorldSize,
  options: { spacing: number; center?: Point; seed?: number },
): Generator<Point> {
  const spacing = Math.max(1, Math.floor(options.spacing));
  if (layout === 'cluster') {
    const center = options.center ?? { x: Math.floor(world.widthCells / 2), y: Math.floor(world.heightCells / 2) };
    const rings = Math.ceil(Math.max(world.widthCells, world.heightCells) / spacing / 2);
    const seen = new Set<string>();
    for (let ring = 0; ring <= rings; ring++)
      for (let dy = -ring; dy <= ring; dy++)
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const point = {
            x: wrap(center.x + dx * spacing, world.widthCells),
            y: wrap(center.y + dy * spacing, world.heightCells),
          };
          const key = point.x + ':' + point.y;
          if (seen.has(key)) continue;
          seen.add(key);
          yield point;
        }
    return;
  }
  const points: Point[] = [];
  const offset = Math.floor(spacing / 2);
  for (let y = offset; y < world.heightCells; y += spacing)
    for (let x = offset; x < world.widthCells; x += spacing) points.push({ x, y });
  const random = rng(options.seed ?? 1);
  for (let i = points.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [points[i], points[j]] = [points[j]!, points[i]!];
  }
  yield* points;
}
