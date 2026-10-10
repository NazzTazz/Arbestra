import { spawnDelta, wrapClimate, type SpawnPoint } from '@arbestra/contracts';

/** Visible portions of a toroidal polyline, in the flat [0,width]×[0,height] map. */
export function periodicMapLines(points: readonly SpawnPoint[], width: number, height: number): SpawnPoint[][] {
  const result: SpawnPoint[][] = [];
  const equal = (a: SpawnPoint, b: SpawnPoint) => Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const start = { x: wrapClimate(a.x, width), y: wrapClimate(a.y, height) };
    const dx = spawnDelta(b.x, a.x, width), dy = spawnDelta(b.y, a.y, height);
    if (Math.abs(dx) + Math.abs(dy) < 1e-8) continue;
    const cuts = new Set([0, 1]);
    for (const [value, delta, size] of [[start.x, dx, width], [start.y, dy, height]]) {
      if (!delta) continue;
      for (const edge of [0, size!]) { const t = (edge - value!) / delta!; if (t > 0 && t < 1) cuts.add(t); }
    }
    const ordered = [...cuts].sort((x, y) => x - y);
    for (let cut = 1; cut < ordered.length; cut++) {
      const t0 = ordered[cut - 1]!, t1 = ordered[cut]!, middle = (t0 + t1) / 2;
      const tileX = Math.floor((start.x + dx * middle) / width) * width, tileY = Math.floor((start.y + dy * middle) / height) * height;
      const from = { x: start.x + dx * t0 - tileX, y: start.y + dy * t0 - tileY };
      const to = { x: start.x + dx * t1 - tileX, y: start.y + dy * t1 - tileY };
      const prior = result.at(-1);
      if (prior && equal(prior.at(-1)!, from)) prior.push(to); else result.push([from, to]);
    }
  }
  // A line lying exactly on a seam is visible at both corresponding borders.
  return result.flatMap(part => {
    const xs = part.every(p => p.x === 0) ? [0, width] : [0];
    const ys = part.every(p => p.y === 0) ? [0, height] : [0];
    return xs.flatMap(x => ys.map(y => part.map(p => ({ x: p.x + x, y: p.y + y }))));
  });
}
