import {
  infrastructurePlanSurface,
  infrastructureSidewalkSurface,
  withinBuildReach,
  type VillageState,
} from '@arbestra/contracts';

/**
 * Why a terraforming cell is refused, and how the Oracle says it
 * (docs/SPEC-TERRAFORMATION-OUTIL.md §3.5). The client classifies what its
 * data proves; the server stays the authority and its codes map to the same
 * reasons.
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

/** Priority of the headline when one gesture meets several obstacles: what
 * the player can act on first (a road, a fixture, a building), then the ground. */
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

/** The Oracle's sentence per reason, for one cell and for several. */
const SENTENCES: Record<TerraformRefusalReason, readonly [string, string]> = {
  road: [
    'Une route sur ce terrain empêche de démarrer les travaux.',
    'Des routes sur ce terrain empêchent de démarrer les travaux.',
  ],
  fixture: [
    'Un aménagement de la voirie occupe ce terrain. Les pelles attendront qu’on le déplace.',
    'Des aménagements de la voirie occupent ce terrain. Les pelles attendront qu’on les déplace.',
  ],
  building: [
    'Un bâtiment se dresse ici. Je doute qu’il apprécie d’être soulevé avec le terrain.',
    'Des bâtiments se dressent ici. Je doute qu’ils apprécient d’être soulevés avec le terrain.',
  ],
  foundation: [
    'Une fondation voisine bougerait avec ce terrain. Éloignez un peu les travaux.',
    'Des fondations voisines bougeraient avec ce terrain. Éloignez un peu les travaux.',
  ],
  passage: [
    'Une équipe traverse ce terrain en ce moment. Laissez-la passer, puis recommencez.',
    'Des équipes traversent ce terrain en ce moment. Laissez-les passer, puis recommencez.',
  ],
  water: [
    'À cette hauteur, l’eau s’inviterait sur le terrain. Montez un peu le réglage.',
    'À cette hauteur, l’eau s’inviterait sur le terrain. Montez un peu le réglage.',
  ],
  nature: [
    'La nature tient ce terrain : arbre, rocher ou clairière protégée. Elle a parfois le dernier mot.',
    'La nature tient ce terrain : arbres, rochers ou clairière protégée. Elle a parfois le dernier mot.',
  ],
  reach: [
    'Ce terrain est hors de portée du village. Restez plus près de vos bâtiments.',
    'Ce terrain est hors de portée du village. Restez plus près de vos bâtiments.',
  ],
  unavailable: [
    'Ce monde ne se laisse pas encore modeler de cette façon.',
    'Ce monde ne se laisse pas encore modeler de cette façon.',
  ],
  other: [
    'Le terrain a refusé de bouger. Je n’en sais pas davantage, pour une fois.',
    'Le terrain a refusé de bouger. Je n’en sais pas davantage, pour une fois.',
  ],
};
/** Short names of the other obstacles, quoted after the headline. */
const NAMES: Record<TerraformRefusalReason, string> = {
  road: 'une route',
  fixture: 'un aménagement',
  building: 'un bâtiment',
  foundation: 'une fondation',
  passage: 'une équipe en chemin',
  water: 'l’eau',
  nature: 'la nature',
  reach: 'les limites du village',
  unavailable: 'ce monde',
  other: 'un obstacle',
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

export interface OracleRefusal {
  /** The headline, about the main obstacle. */
  text: string;
  /** The other obstacles of the same gesture, named briefly; null when alone. */
  more: string | null;
  /** The cell the camera visits on « Inspecter »; null when none is known. */
  inspect: Cell | null;
}
const joinNames = (names: string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`;
/**
 * One message for a whole refused gesture (§3.5): the headline names the
 * first obstacle in PRIORITY order, in the plural when it covers several
 * cells; the other reasons follow in one short line; « Inspecter » visits the
 * cell of the headline closest to the gesture's anchor.
 */
export function oracleRefusal(
  refusals: readonly TerraformRefusal[],
  anchor: Cell | null,
  world: { widthCells: number; heightCells: number } = { widthCells: Infinity, heightCells: Infinity },
): OracleRefusal | null {
  if (!refusals.length) return null;
  const byReason = new Map<TerraformRefusalReason, TerraformRefusal[]>();
  for (const r of refusals) byReason.set(r.reason, [...(byReason.get(r.reason) ?? []), r]);
  const reasons = PRIORITY.filter((r) => byReason.has(r)),
    main = reasons[0]!,
    cells = byReason
      .get(main)!
      .map((r) => r.cell)
      .filter((c): c is Cell => c !== null);
  const distinct = new Set(cells.map(key)).size;
  const distance = (c: Cell) => {
    if (!anchor) return 0;
    const dx = Math.abs(c.cellX - anchor.cellX),
      dy = Math.abs(c.cellY - anchor.cellY);
    return Math.max(Math.min(dx, world.widthCells - dx), Math.min(dy, world.heightCells - dy));
  };
  const inspect = cells.length ? cells.reduce((a, b) => (distance(b) < distance(a) ? b : a)) : anchor;
  const others = reasons.slice(1).map((r) => NAMES[r]);
  return {
    text: SENTENCES[main][distinct > 1 ? 1 : 0],
    more: others.length ? `Ailleurs dans ce geste, les travaux butent aussi sur ${joinNames(others)}.` : null,
    inspect,
  };
}
