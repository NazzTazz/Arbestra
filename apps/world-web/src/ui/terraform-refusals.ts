import {
  infrastructurePlanSurface,
  infrastructureSidewalkSurface,
  withinBuildReach,
  type VillageState,
} from '@arbestra/contracts';

/**
 * Why a terraforming cell is refused, and how the Oracle says it
 * (docs/SPEC-TERRAFORMATION-OUTIL.md §3.5 and §7). The client classifies what
 * its data proves, painted cell by painted cell; the server stays the
 * authority and its codes map to the same reasons. One page of the Oracle per
 * error.
 */
export type TerraformRefusalReason =
  | 'road'
  | 'fixture'
  | 'building'
  | 'foundation'
  | 'passage'
  | 'water'
  | 'nature'
  | 'reach'
  | 'unavailable'
  | 'other';
type Cell = { cellX: number; cellY: number };
export interface TerraformRefusal {
  reason: TerraformRefusalReason;
  cell: Cell | null;
}

/** Order of the Oracle's pages: what the player can act on first (a road, a
 * fixture, a building), then the ground. */
const PRIORITY: readonly TerraformRefusalReason[] = [
  'road',
  'fixture',
  'building',
  'foundation',
  'passage',
  'water',
  'nature',
  'reach',
  'unavailable',
  'other',
];

/** The Oracle's sentence per reason (Tristan, 2 November: « parfaits »), in
 * the singular: one page tells one error. */
const SENTENCES: Record<TerraformRefusalReason, string> = {
  road: 'Une route sur ce terrain empêche de démarrer les travaux.',
  fixture: 'Un aménagement de la voirie occupe ce terrain. Les pelles attendront qu’on le déplace.',
  building: 'Un bâtiment se dresse ici. Je doute qu’il apprécie d’être soulevé avec le terrain.',
  foundation: 'Une fondation voisine bougerait avec ce terrain. Éloignez un peu les travaux.',
  passage: 'Une équipe traverse ce terrain en ce moment. Laissez-la passer, puis recommencez.',
  water: 'À cette hauteur, l’eau s’inviterait sur le terrain. Montez un peu le réglage.',
  nature: 'La nature tient ce terrain : arbre, rocher ou clairière protégée. Elle a parfois le dernier mot.',
  reach: 'Ce terrain est hors de portée du village. Restez plus près de vos bâtiments.',
  unavailable: 'Ce monde ne se laisse pas encore modeler de cette façon.',
  other: 'Le terrain a refusé de bouger. Je n’en sais pas davantage, pour une fois.',
};

/** Server refusal codes (terrain-edits, assertBuildableCells, assertNoInfrastructure). */
const SERVER_REASONS: Record<string, TerraformRefusalReason> = {
  INFRASTRUCTURE_OCCUPIED: 'road',
  ENGAGED_PASSAGE: 'passage',
  CELL_OCCUPIED: 'building',
  TERRAIN_NOT_BUILDABLE: 'nature',
  CLEARING_PROTECTED: 'nature',
  OUTSIDE_VILLAGE_REACH: 'reach',
  LEVELING_WATER: 'water',
  LEVELING_FOUNDATION: 'foundation',
  LEVELING_UNAVAILABLE: 'unavailable',
};
export const serverRefusalReason = (code: string): TerraformRefusalReason | null => SERVER_REASONS[code] ?? null;

/** What the client knows about the cells of one village state, indexed once
 * per state (never per hover): every lookup is a set access. */
export interface TerraformObstacles {
  free: ReadonlySet<string>;
  roads: ReadonlySet<string>;
  fixtures: ReadonlySet<string>;
  buildings: ReadonlySet<string>;
  sources: readonly Cell[];
}
const indexes = new WeakMap<VillageState, TerraformObstacles>();
const fixtureIndexes = new WeakMap<NonNullable<VillageState['infrastructure']>, Set<string>>();
const key = (c: Cell) => `${c.cellX}:${c.cellY}`;
function fixtures(state: VillageState) {
  const plan = state.infrastructure;
  if (!plan) return new Set<string>();
  const cached = fixtureIndexes.get(plan);
  if (cached) return cached;
  const blocked = new Set<string>(),
    world = state.world;
  const at = (x: number, y: number) =>
    `${((Math.floor(x + 0.5) % world.widthCells) + world.widthCells) % world.widthCells}:${((Math.floor(y + 0.5) % world.heightCells) + world.heightCells) % world.heightCells}`;
  for (const e of plan.equipment) blocked.add(at(e.x / 8, e.y / 8));
  const surface = infrastructurePlanSurface(plan, world);
  for (const p of surface.values()) if (p.manual) blocked.add(at((p.x + 0.5) / 16, (p.y + 0.5) / 16));
  for (const p of infrastructureSidewalkSurface(surface, world).values())
    blocked.add(at((p.x + 0.5) / 16, (p.y + 0.5) / 16));
  fixtureIndexes.set(plan, blocked);
  return blocked;
}
export function terraformObstacles(state: VillageState): TerraformObstacles {
  const cached = indexes.get(state);
  if (cached) return cached;
  const index: TerraformObstacles = {
    free: new Set(state.cells.filter((c) => c.canBuild).map(key)),
    roads: new Set((state.roadCells ?? []).map(key)),
    fixtures: fixtures(state),
    buildings: new Set(state.cells.filter((c) => c.footprint || c.building).map(key)),
    // Reach sources: completed footprints, as the server's withinBuildReach.
    sources: state.cells.filter((c) => c.footprint?.state === 'active'),
  };
  indexes.set(state, index);
  return index;
}
/** O(1): whether the server would refuse this cell for what the client sees. */
export const cellRefused = (o: TerraformObstacles, c: Cell) => {
  const k = key(c);
  return !o.free.has(k) || o.roads.has(k) || o.fixtures.has(k);
};
/** Why a refused cell is refused, in the server's order (infrastructure
 * first, then the ground); null when the client sees no obstacle. */
export function cellRefusal(
  o: TerraformObstacles,
  c: Cell,
  world: { widthCells: number; heightCells: number },
): TerraformRefusalReason | null {
  const k = key(c);
  if (o.roads.has(k)) return 'road';
  if (o.fixtures.has(k)) return 'fixture';
  if (o.buildings.has(k)) return 'building';
  if (o.free.has(k)) return null;
  // Not buildable for another reason: out of reach, or the ground itself.
  return withinBuildReach(c, o.sources, world) ? 'nature' : 'reach';
}
/** Infrastructure first, as `assertBuildableCells` throws it for any cell of a set. */
const rank = (reason: TerraformRefusalReason) => (reason === 'road' || reason === 'fixture' ? 0 : 1);
/**
 * Why one painted cell (one unit, docs/SPEC-TERRAFORMATION-OUTIL.md §7) is
 * refused, as the server picks it: the painted cell itself first, then its
 * ring (the 3 × 3 its corners move), infrastructure before the ground, in the
 * canonical order. At most 9 set lookups; null when the client sees nothing.
 */
export function unitRefusal(
  o: TerraformObstacles,
  c: Cell,
  world: { widthCells: number; heightCells: number },
): TerraformRefusal | null {
  const own = cellRefusal(o, c, world);
  if (own) return { reason: own, cell: c };
  let found: TerraformRefusal | null = null;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const cell = {
          cellX: (c.cellX + dx + world.widthCells) % world.widthCells,
          cellY: (c.cellY + dy + world.heightCells) % world.heightCells,
        },
        reason = cellRefusal(o, cell, world);
      if (reason && (!found || rank(reason) < rank(found.reason))) found = { reason, cell };
    }
  return found;
}

/** Why the server refused a unit, refined by what the client sees at the
 * obstacle: INFRASTRUCTURE_OCCUPIED is a road, or a fixture (equipment,
 * lane, sidewalk) when no road is known there. Unknown codes: 'other'. */
export function serverRefusal(code: string, at: Cell | null, obstacles: TerraformObstacles | null): TerraformRefusal {
  let reason = serverRefusalReason(code) ?? 'other';
  if (reason === 'road' && at && obstacles && !obstacles.roads.has(key(at)) && obstacles.fixtures.has(key(at)))
    reason = 'fixture';
  return { reason, cell: at };
}

/** The entity « Inspecter » makes pulse for a reason: a foundation is a
 * building's; the ground (a tree, a rock, a protected clearing) gets a red
 * halo on the ground (Tristan, 2 November, option B); water, reach, a passing
 * team have none. */
export type InspectObstacle = 'road' | 'fixture' | 'building' | 'nature' | null;
const OBSTACLES: Record<TerraformRefusalReason, InspectObstacle> = {
  road: 'road',
  fixture: 'fixture',
  building: 'building',
  foundation: 'building',
  passage: null,
  water: null,
  nature: 'nature',
  reach: null,
  unavailable: null,
  other: null,
};

/** One page of the Oracle: one error, its sentence and where to look. */
export interface OraclePage {
  reason: TerraformRefusalReason;
  text: string;
  /** The cell the camera visits on « Inspecter »; null when none is known. */
  inspect: Cell | null;
  /** What pulses there. */
  obstacle: InspectObstacle;
  /** A merged page of water (`mergeWaterPages`): every cell of its group. */
  cells?: Cell[];
}
/**
 * The Oracle's pages for refusals (Tristan, 2 November: « un message par
 * erreur, avec un simple sélecteur 1/X »): one page per error, an error being
 * one reason at one cell (several refused cells blocked by the same road cell
 * are one error); in PRIORITY order (what the player can act on first), then
 * in order of appearance. Sentences in the singular: a page is one error.
 * A refusal without a cell falls back on `anchor`.
 */
export function oraclePages(refusals: readonly TerraformRefusal[], anchor: Cell | null = null): OraclePage[] {
  const seen = new Set<string>(),
    pages: OraclePage[] = [];
  for (const reason of PRIORITY)
    for (const r of refusals) {
      if (r.reason !== reason) continue;
      const cell = r.cell ?? anchor,
        id = `${reason}@${cell ? key(cell) : ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      pages.push({ reason, text: SENTENCES[reason], inspect: cell, obstacle: cell ? OBSTACLES[reason] : null });
    }
  return pages;
}

/**
 * One page for the water of contiguous cells (Tristan, 2 November: «
 * Fusionne les erreurs d'eau », docs/SPEC-TERRAFORMATION-OUTIL.md §7.5): a
 * stroke plunged into a lake gives one wet cell per refused unit, which is
 * one error for the player. Water pages whose cells touch on the torus,
 * diagonals included (8-neighbourhood: a diagonal stroke along a shore is one
 * shore), become one page at the place of the first; the others keep their
 * order. « Inspecter » visits the group's cell nearest to its centre (on the
 * torus, from the first cell): an actual wet cell, in the middle of the
 * water the stroke met, rather than its first or a point of dry land in a
 * curved group. Indexed by cell: O(cells × 9), once per delivery of pages.
 */
export function mergeWaterPages(pages: readonly OraclePage[], world: { widthCells: number; heightCells: number }) {
  const { widthCells: w, heightCells: h } = world;
  const members = (p: OraclePage) => p.cells ?? (p.inspect ? [p.inspect] : []);
  const water = pages.flatMap((p, i) => (p.reason === 'water' && members(p).length ? [i] : []));
  if (water.length < 2) return [...pages];
  // Union of the pages whose cells are neighbours.
  const parent = new Map(water.map((i) => [i, i]));
  const find = (i: number): number => {
    let root = i;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(i, root);
    return root;
  };
  const owner = new Map<string, number>();
  for (const i of water) for (const c of members(pages[i]!)) if (!owner.has(key(c))) owner.set(key(c), i);
  for (const i of water)
    for (const c of members(pages[i]!))
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const other = owner.get(`${(c.cellX + dx + w) % w}:${(c.cellY + dy + h) % h}`);
          if (other === undefined) continue;
          const a = find(i),
            b = find(other);
          if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
        }
  const groups = new Map<number, Cell[]>();
  for (const i of water) {
    const root = find(i),
      cells = groups.get(root) ?? [];
    for (const c of members(pages[i]!))
      if (!cells.some((d) => d.cellX === c.cellX && d.cellY === c.cellY)) cells.push(c);
    groups.set(root, cells);
  }
  /** Shortest signed offset on a ring of `size` cells. */
  const delta = (d: number, size: number) => {
    const m = ((d % size) + size) % size;
    return m > size / 2 ? m - size : m;
  };
  const merged: OraclePage[] = [];
  for (const [i, page] of pages.entries()) {
    if (!parent.has(i)) {
      merged.push(page);
      continue;
    }
    if (find(i) !== i) continue;
    const cells = groups.get(i)!;
    if (cells.length === 1) {
      merged.push(page);
      continue;
    }
    const origin = cells[0]!,
      offsets = cells.map((c) => ({ x: delta(c.cellX - origin.cellX, w), y: delta(c.cellY - origin.cellY, h) })),
      cx = offsets.reduce((s, o) => s + o.x, 0) / cells.length,
      cy = offsets.reduce((s, o) => s + o.y, 0) / cells.length;
    let best = 0;
    offsets.forEach((o, k) => {
      const b = offsets[best]!;
      if ((o.x - cx) ** 2 + (o.y - cy) ** 2 < (b.x - cx) ** 2 + (b.y - cy) ** 2 - 1e-9) best = k;
    });
    merged.push({ ...page, inspect: cells[best]!, cells });
  }
  return merged;
}
