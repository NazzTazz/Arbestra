import { GARDEN_CROSSING_COST, travelDuration, type TravelCell, type TravelRoute } from './travel-paths.js';
const key = (p: TravelCell) => `${p.cellX}:${p.cellY}`;

/** Reuses the already-authorized cardinal road graph, without new world navigation. */
export function planGardenTour(
  routes: readonly TravelRoute[],
  home: TravelCell,
  cells: readonly TravelCell[],
  world?: { widthCells: number; heightCells: number },
) {
  const duration = (path: readonly TravelCell[]) =>
    !world && path.every((p) => Number.isInteger(p.cellX) && Number.isInteger(p.cellY))
      ? Math.max(0, path.length - 1) * 1000
      : travelDuration(path, world);
  // The network names each plot route `${gardenId}:${x}:${y}`. A leg chooses its
  // way as the network does: plots of other gardens than the leg's own ends cost
  // GARDEN_CROSSING_COST per step. Durations stay physical.
  const cellOf = (p: TravelCell) => {
    const x = Math.floor(p.cellX + 0.5),
      y = Math.floor(p.cellY + 0.5);
    return world
      ? `${((x % world.widthCells) + world.widthCells) % world.widthCells}:${((y % world.heightCells) + world.heightCells) % world.heightCells}`
      : `${x}:${y}`;
  };
  const gardens = new Map<string, string>();
  for (const route of routes) {
    const suffix = ':' + key(route.destination);
    if (route.kind === 'garden' && route.id.endsWith(suffix) && route.id.length > suffix.length)
      gardens.set(cellOf(route.destination), route.id.slice(0, -suffix.length));
  }
  const graph = new Map<string, Map<string, TravelCell>>();
  const link = (a: TravelCell, b: TravelCell) => {
    const neighbours = graph.get(key(a)) ?? new Map<string, TravelCell>();
    neighbours.set(key(b), b);
    graph.set(key(a), neighbours);
  };
  // Validated selected plots can be crossed directly along a shared side.
  // Do not add shortcuts through unselected buildings, features or empty land.
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i]!,
        b = cells[j]!,
        dx = Math.abs(a.cellX - b.cellX),
        dy = Math.abs(a.cellY - b.cellY);
      const x = world ? Math.min(dx, world.widthCells - dx) : dx,
        y = world ? Math.min(dy, world.heightCells - dy) : dy;
      if (x + y === 1) {
        link(a, b);
        link(b, a);
      }
    }
  for (const route of routes)
    for (let i = 1; i < route.cells.length; i++)
      for (const [a, b] of [
        [route.cells[i - 1]!, route.cells[i]!],
        [route.cells[i]!, route.cells[i - 1]!],
      ]) {
        link(a!, b!);
      }
  const path = (from: TravelCell, to: TravelCell): TravelCell[] | null => {
    const own = new Set([gardens.get(cellOf(from)), gardens.get(cellOf(to))]);
    const weight = (a: TravelCell, b: TravelCell) => {
      const owner = gardens.size ? gardens.get(cellOf(b)) : undefined;
      return duration([a, b]) * (owner !== undefined && !own.has(owner) ? GARDEN_CROSSING_COST : 1);
    };
    const queue = [{ cell: from, distance: 0 }],
      parents = new Map<string, TravelCell | null>([[key(from), null]]),
      distances = new Map([[key(from), 0]]);
    while (queue.length) {
      queue.sort((a, b) => b.distance - a.distance || key(b.cell).localeCompare(key(a.cell)));
      const entry = queue.pop()!,
        current = entry.cell;
      if (entry.distance !== distances.get(key(current))) continue;
      if (key(current) === key(to)) {
        const result: TravelCell[] = [];
        for (let p: TravelCell | null = current; p; p = parents.get(key(p)) ?? null) result.push(p);
        return result.reverse();
      }
      for (const next of graph.get(key(current))?.values() ?? []) {
        const distance = entry.distance + weight(current, next);
        if (distance < (distances.get(key(next)) ?? Infinity)) {
          distances.set(key(next), distance);
          parents.set(key(next), current);
          queue.push({ cell: next, distance });
        }
      }
    }
    return null;
  };
  // Versioned routes begin at the authored door, rather than the occupied anchor cell.
  const origin = routes.find((route) => route.version === 2 && route.cells.length)?.cells[0] ?? home;
  let previous = origin,
    elapsed = 0;
  const stops = [];
  for (const cell of cells) {
    const leg = path(previous, cell);
    if (!leg) return null;
    elapsed += duration(leg);
    const arrivesAfterMs = elapsed;
    elapsed += 60_000;
    stops.push({ ...cell, path: leg, arrivesAfterMs, workEndsAfterMs: elapsed });
    previous = cell;
  }
  const returnPath = path(previous, origin);
  if (!returnPath) return null;
  return { stops, returnPath, durationMs: elapsed + duration(returnPath) };
}
