import { sql, type Kysely } from 'kysely';
import {
  automaticBraziers,
  coarseTravelPath,
  desireCellsFromEdges,
  desireEdges,
  desireRoutes,
  type DesireEdge,
  type InfrastructurePlan,
  type ResolvedVillagePresentation,
  type TravelRoute,
  type VillageState,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';

/**
 * Starting state of the desire paths (slice T3d, docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §17,
 * decisions 9 and 21): every edge the villages show today becomes a path, at the visibility
 * threshold. Missions before migration 085 are not replayed; only what is displayed is kept.
 */

type World = { widthCells: number; heightCells: number };

/** Canonical edges of the routes a village shows (`travelRoutes` of its presentation): the cells
 * the decorative topology draws (`coarseTravelPath`), cardinal steps only. A route is drawn from
 * its cells rounded point by point and never along a diagonal, so neither the local-detour rule
 * nor the diagonal edges of `desireEdges` (R2a) apply: the start state stays what is displayed,
 * exactly as before them. */
export function displayedDesireEdges(routes: readonly TravelRoute[], world: World): DesireEdge[] {
  return desireEdges(
    routes.map((route) =>
      coarseTravelPath(
        route.cells.filter((p) => Number.isFinite(p.cellX) && Number.isFinite(p.cellY)),
        world,
      ),
    ),
    world,
  ).filter((edge) => edge.direction < 2);
}

const edgeKey = (edge: DesireEdge) => `${edge.cellX}:${edge.cellY}:${edge.direction}`;

/** Union of edge lists, in the order of the table's primary key. */
export function unionDesireEdges(lists: Iterable<readonly DesireEdge[]>): DesireEdge[] {
  const found = new Map<string, DesireEdge>();
  for (const list of lists) for (const edge of list) found.set(edgeKey(edge), edge);
  return [...found.values()].sort((a, b) => a.cellX - b.cellX || a.cellY - b.cellY || a.direction - b.direction);
}

export interface BrazierComparison {
  legacy: number;
  desire: number;
  /** Lit today, not on the desire paths (id). */
  missing: string[];
  /** Lit on the desire paths, not today (id): a neighbour's path met there. */
  extra: string[];
  /** Same id, other position. */
  moved: string[];
}

/**
 * The automatic braziers of a village from its network, against those from the desire edges of the
 * whole world (the village sees its neighbours' paths too). Same plan on both sides: suppressions
 * and manual lighting act on ids, so equal ids and positions without them stay equal with them.
 */
export function compareBraziers(
  presentation: Pick<ResolvedVillagePresentation, 'cells' | 'region' | 'travelRoutes'>,
  world: VillageState['world'],
  infrastructure: InfrastructurePlan,
  edges: readonly DesireEdge[],
): BrazierComparison {
  const state = (travelRoutes: TravelRoute[]) =>
    ({
      world,
      // A displayed building masks its cell as a footprint does (the client's `building`).
      cells: presentation.cells.map((cell) => ({ ...cell, building: cell.displaysBuilding ? {} : null })),
      region: presentation.region,
      infrastructure,
      travelRoutes,
    }) as unknown as Pick<VillageState, 'world' | 'cells' | 'region' | 'travelRoutes' | 'infrastructure'>;
  const legacy = new Map(automaticBraziers(state(presentation.travelRoutes)).map((b) => [b.id, b])),
    desire = new Map(
      automaticBraziers(state(desireRoutes(desireCellsFromEdges([...edges]), world))).map((b) => [b.id, b]),
    );
  const missing: string[] = [],
    moved: string[] = [];
  for (const [id, brazier] of legacy) {
    const other = desire.get(id);
    if (!other) missing.push(id);
    else if (other.position.x !== brazier.position.x || other.position.y !== brazier.position.y) moved.push(id);
  }
  return {
    legacy: legacy.size,
    desire: desire.size,
    missing,
    extra: [...desire.keys()].filter((id) => !legacy.has(id)),
    moved,
  };
}

/** Rows per statement, as the desire task (statement-level triggers publish once per statement). */
const ROWS_PER_STATEMENT = 1_000;

/**
 * Raises every edge to the visibility threshold (`world_desire_visible_passages()`), never lowers
 * one, keeps `last_passage_at` of an existing edge. Idempotent: a second run changes no row and
 * publishes nothing (the update is skipped when the edge is already visible). One transaction.
 */
export async function applyDesireStart(
  db: Kysely<Database>,
  worldId: string,
  edges: readonly DesireEdge[],
): Promise<{ inserted: number; raised: number; unchanged: number }> {
  return db.transaction().execute(async (tx) => {
    let inserted = 0,
      raised = 0;
    for (let i = 0; i < edges.length; i += ROWS_PER_STATEMENT) {
      const rows = await tx
        .insertInto('worldDesireEdges')
        .values(
          edges.slice(i, i + ROWS_PER_STATEMENT).map((edge) => ({
            worldId,
            cellX: edge.cellX,
            cellY: edge.cellY,
            direction: edge.direction,
            passages: sql<number>`world_desire_visible_passages()`,
            lastPassageAt: sql<Date>`statement_timestamp()`,
          })),
        )
        .onConflict((conflict) =>
          conflict
            .columns(['worldId', 'cellX', 'cellY', 'direction'])
            .doUpdateSet({ passages: sql`excluded.passages` })
            .where('worldDesireEdges.passages', '<', sql<number>`excluded.passages`),
        )
        .returning(sql<boolean>`xmax = 0`.as('inserted'))
        .execute();
      for (const row of rows)
        if (row.inserted) inserted++;
        else raised++;
    }
    return { inserted, raised, unchanged: edges.length - inserted - raised };
  });
}
