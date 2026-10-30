import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Transaction } from 'kysely';
import {
  ROAD_ACCESSORY_PRICES,
  pathPassageIntersectsBox,
  roadAnchorCells,
  roadCellAnchors,
  type RoadAccessoryKind,
  type RoadAnchorAccessory,
  type RoadAnchorPosition,
  type RoadAnchorSkip,
  type RoadAnchorSkipCode,
  type RoadAnchorsConfirmationV2,
  type RoadAnchorsPreview,
  type RoadAnchorsPreviewRequest,
  type RoadAnchorsQuote,
  type RoadAnchorsRequest,
  type RoadAnchorsResult,
  type SyncV2Batch,
  type TravelCell,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { beginVillageEconomy, type VillageEconomy } from './reconcile-economy.js';
import { projectVillageResource } from './economy.js';
import { publishPrivateEffects } from './sync-v2-effects.js';
import { worldActivePaths } from './infrastructure.js';
import { debit, ownedVillage, villageCommandResult, withVillageProjection, type OwnedVillage } from './service.js';

type World = { widthCells: number; heightCells: number };
type Cell = { cellX: number; cellY: number };
type Vertex = RoadAnchorPosition;
const vertexKey = (v: Vertex) => `${v.vertexX}:${v.vertexY}`;
const cellKey = (c: Cell) => `${c.cellX}:${c.cellY}`;
/** Unique anchors of a gesture, in first-seen order (as road cells). */
const uniqueAnchors = (anchors: readonly Vertex[]) => {
  const seen = new Set<string>();
  return anchors
    .map(({ vertexX, vertexY }) => ({ vertexX, vertexY }))
    .filter((v) => !seen.has(vertexKey(v)) && Boolean(seen.add(vertexKey(v))));
};
const SKIP_MESSAGES: Record<RoadAnchorSkipCode, string> = {
  ANCHOR_MISSING: 'Aucune route du village ne touche ce coin.',
  FOREIGN_INFRASTRUCTURE: 'Un aménagement d’un autre village occupe cet emplacement.',
  ANCHOR_OCCUPIED: 'Un autre accessoire occupe ce coin.',
  ENGAGED_PASSAGE: 'Une équipe utilise encore ce passage.',
};
class RoadAnchorsRefused extends HttpError {
  constructor(
    code: RoadAnchorSkipCode,
    readonly skipped: RoadAnchorSkip[],
  ) {
    super(409, code, SKIP_MESSAGES[code]);
  }
}
const unnestCells = (cells: readonly Cell[]) =>
  sql<boolean>`(cell_x,cell_y) in (select * from unnest(${cells.map((c) => c.cellX)}::int[],${cells.map((c) => c.cellY)}::int[]))`;
const unnestVertices = (vertices: readonly Vertex[]) =>
  sql<boolean>`(vertex_x,vertex_y) in (select * from unnest(${vertices.map((v) => v.vertexX)}::int[],${vertices.map((v) => v.vertexY)}::int[]))`;

/** Footprint of an accessory: the ±1/8 cell box of a legacy equipment,
 * centred on the vertex. */
export function anchorBlocksPath(path: readonly TravelCell[], vertex: Vertex, world: World): boolean {
  return pathPassageIntersectsBox(
    path,
    { cellX: vertex.vertexX - 0.5, cellY: vertex.vertexY - 0.5 },
    0.125,
    0.125,
    world,
  );
}

/** Road cells (any village) around the given vertices, one bounded read. */
async function cellsAround(tx: Kysely<Database>, worldId: string, vertices: readonly Vertex[], world: World) {
  const cells = new Map<string, Cell>();
  for (const v of vertices) for (const c of roadAnchorCells(v, world)) cells.set(cellKey(c), c);
  if (!cells.size) return new Map<string, string>();
  const rows = await tx
    .selectFrom('roadCells')
    .select(['villageId', 'cellX', 'cellY'])
    .where('worldId', '=', worldId)
    .where(unnestCells([...cells.values()]))
    .execute();
  return new Map(rows.map((row) => [cellKey(row), row.villageId]));
}
/** Road cells around a vertex, by owner. */
function owners(vertex: Vertex, roads: ReadonlyMap<string, string>, world: World) {
  const count = new Map<string, number>();
  for (const c of roadAnchorCells(vertex, world)) {
    const owner = roads.get(cellKey(c));
    if (owner) count.set(owner, (count.get(owner) ?? 0) + 1);
  }
  return count;
}

interface Prepared {
  quote: RoadAnchorsQuote;
  result: RoadAnchorsResult;
  /** Rows to insert or overwrite with this state. */
  write: Array<Vertex & { accessory: RoadAnchorAccessory; insert: boolean }>;
  /** Own rows to delete. */
  remove: Vertex[];
}

/** Shared by the read-only quote and the command. Bounded reads only: the
 * named vertices, their four cells, and the trips in progress of the world
 * (persisted paths, only when an obstacle appears); never `state()`. Every
 * refusal is thrown before any write. */
async function prepareRoadAnchors(
  tx: Transaction<Database>,
  village: OwnedVillage,
  economy: VillageEconomy,
  named: RoadAnchorsPreviewRequest,
): Promise<Prepared> {
  const { worldId, villageId } = village;
  const world = { widthCells: village.widthCells, heightCells: village.heightCells };
  const anchors = uniqueAnchors(named.anchors);
  for (const v of anchors)
    if (v.vertexX >= world.widthCells || v.vertexY >= world.heightCells)
      throw new HttpError(400, 'INVALID_COORDINATES', 'Coordonnées non canoniques.');
  const roads = await cellsAround(tx, worldId, anchors, world);
  const rows = new Map(
    (
      await tx
        .selectFrom('roadAnchors')
        .select(['villageId', 'vertexX', 'vertexY', 'accessory'])
        .where('worldId', '=', worldId)
        .where(unnestVertices(anchors))
        .execute()
    ).map((row) => [vertexKey(row), row]),
  );
  const result: RoadAnchorsResult = { placed: 0, restored: 0, removed: 0, unchanged: 0, stone: 0, wood: 0 };
  const write: Prepared['write'] = [];
  const remove: Vertex[] = [];
  /** Per vertex: own cells, a foreign holder, the own stored row. */
  const inspect = (v: Vertex) => {
    const counts = owners(v, roads, world);
    const row = rows.get(vertexKey(v));
    const foreignRow = row !== undefined && row.villageId !== villageId;
    // Another village's automatic brazier: three of its cells, nothing stored.
    const foreignAuto = [...counts].some(([owner, n]) => owner !== villageId && n === 3) && !row;
    const own = counts.get(villageId) ?? 0;
    return { own, automatic: own === 3, foreign: foreignRow || foreignAuto, row: foreignRow ? undefined : row };
  };
  if (named.action === 'remove') {
    // Mirrors road cells: a foreign anchor refuses the whole removal; an
    // anchor showing nothing is unchanged.
    for (const v of anchors) if (inspect(v).foreign) throw new RoadAnchorsRefused('FOREIGN_INFRASTRUCTURE', []);
    for (const v of anchors) {
      const { own, automatic, row } = inspect(v);
      if (own === 0 && row) {
        // Orphan row (should not exist: cleaned with the last road cell).
        remove.push(v);
        result.removed++;
      } else if (row && row.accessory !== 'none') {
        // A manual accessory: on a re-entrant corner the vertex must stay
        // empty, so the row becomes `none`; elsewhere it disappears.
        if (automatic) write.push({ ...v, accessory: 'none', insert: false });
        else remove.push(v);
        result.removed++;
      } else if (!row && automatic) {
        write.push({ ...v, accessory: 'none', insert: true });
        result.removed++;
      } else result.unchanged++;
    }
    return { quote: { stone: 0, wood: 0 }, result, write, remove };
  }
  const accessory: RoadAccessoryKind = named.accessory;
  const refused = new Map<string, RoadAnchorSkipCode>();
  const appears: Vertex[] = [];
  const planned: Array<{ v: Vertex; kind: 'placed' | 'restored'; insert: boolean }> = [];
  for (const v of anchors) {
    const { own, automatic, foreign, row } = inspect(v);
    if (own === 0) refused.set(vertexKey(v), 'ANCHOR_MISSING');
    else if (foreign) refused.set(vertexKey(v), 'FOREIGN_INFRASTRUCTURE');
    else {
      const shown: RoadAnchorAccessory = row ? row.accessory : automatic ? 'brazier' : 'none';
      if (shown === accessory) result.unchanged++;
      else if (shown !== 'none') refused.set(vertexKey(v), 'ANCHOR_OCCUPIED');
      else {
        // Restoring a suppressed automatic brazier is free (its `none` row goes).
        planned.push({ v, kind: row && automatic && accessory === 'brazier' ? 'restored' : 'placed', insert: !row });
        appears.push(v);
      }
    }
  }
  // An accessory blocks passage: a trip in progress whose persisted path
  // crosses the anchor keeps its anchor free (policy of the legacy blocking
  // equipment). Persisted paths of the world, read without `state()`.
  if (appears.length) {
    const paths = await worldActivePaths(tx, worldId);
    for (const v of appears)
      if (paths.some((path) => anchorBlocksPath(path, v, world))) refused.set(vertexKey(v), 'ENGAGED_PASSAGE');
  }
  const skipped: RoadAnchorSkip[] = [];
  for (const v of anchors) {
    const code = refused.get(vertexKey(v));
    if (code) skipped.push({ ...v, code });
  }
  if (skipped.length === anchors.length) throw new RoadAnchorsRefused(skipped[0]!.code, skipped);
  if (skipped.length) result.skipped = skipped;
  const price = ROAD_ACCESSORY_PRICES[accessory];
  for (const { v, kind, insert } of planned) {
    if (refused.has(vertexKey(v))) continue;
    if (kind === 'restored') {
      remove.push(v);
      result.restored++;
    } else {
      write.push({ ...v, accessory, insert });
      result.placed++;
      result.stone += price.stone;
      result.wood += price.wood;
    }
  }
  for (const code of ['stone', 'wood'] as const)
    if (result[code]) {
      const stock = await projectVillageResource(tx, worldId, villageId, code, economy.through);
      if (stock.amount < result[code]) throw new HttpError(409, 'INSUFFICIENT_RESOURCES', 'Ressources insuffisantes.');
    }
  return { quote: { stone: result.stone, wood: result.wood }, result, write, remove };
}

/** Read-only quote, in the projection's snapshot: no lock, no write. */
export async function previewRoadAnchors(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  gesture: RoadAnchorsPreviewRequest,
): Promise<RoadAnchorsPreview> {
  return withVillageProjection(db, accountId, slug, villageId, async (tx, economy, current) => {
    try {
      const prepared = await prepareRoadAnchors(tx, current, economy, gesture);
      return { valid: true, code: null, message: null, quote: prepared.quote, result: prepared.result };
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      return {
        valid: false,
        code: error.code,
        message: error.message,
        quote: { stone: 0, wood: 0 },
        result: {
          placed: 0,
          restored: 0,
          removed: 0,
          unchanged: 0,
          stone: 0,
          wood: 0,
          ...(error instanceof RoadAnchorsRefused && error.skipped.length ? { skipped: error.skipped } : {}),
        },
      };
    }
  });
}

/** Canonical content of a gesture: what one command identifier names. */
function canonical(request: RoadAnchorsRequest) {
  const anchors = uniqueAnchors(request.anchors);
  return request.action === 'place'
    ? {
        action: request.action,
        accessory: request.accessory,
        anchors,
        expectedQuote: { stone: request.expectedQuote.stone, wood: request.expectedQuote.wood },
      }
    : { action: request.action, anchors };
}

/** Test seams: `afterWrites` runs after the anchors and the debit are written,
 * before the receipt and the publication (rollback proof); `afterLock` runs
 * once the village and the world navigation lock are held, before any read. */
export const roadAnchorsTestHooks: {
  afterLock?: () => Promise<void>;
  afterWrites?: (tx: Transaction<Database>) => Promise<void>;
} = {};

/** Rows of `villageId` at the vertices of `cells` that no longer have a reason
 * to exist after a road cell change: every row whose vertex no road cell of
 * the village touches (an accessory leaves with its last road cell), and every
 * `none` row whose vertex is no longer a re-entrant corner (nothing left to
 * suppress). Called by the road cells command after its cell writes. */
export async function cleanRoadAnchors(
  tx: Transaction<Database>,
  worldId: string,
  villageId: string,
  cells: readonly Cell[],
  world: World,
): Promise<number> {
  if (!cells.length) return 0;
  const vertices = new Map<string, Vertex>();
  for (const c of cells) for (const v of roadCellAnchors(c, world)) vertices.set(vertexKey(v), v);
  const rows = await tx
    .selectFrom('roadAnchors')
    .select(['vertexX', 'vertexY', 'accessory'])
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .where(unnestVertices([...vertices.values()]))
    .execute();
  if (!rows.length) return 0;
  const roads = await cellsAround(tx, worldId, rows, world);
  const stale = rows.filter((row) => {
    const own = owners(row, roads, world).get(villageId) ?? 0;
    return own === 0 || (row.accessory === 'none' && own !== 3);
  });
  if (stale.length)
    await tx
      .deleteFrom('roadAnchors')
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where(unnestVertices(stale))
      .execute();
  return stale.length;
}

/** V2-native gesture: village lock (beginVillageEconomy, with the world's
 * exclusive navigation lock: an accessory is an obstacle), bounded reads,
 * refusal without writes, debit, anchor writes, receipt, then terminal
 * publication of the private effects. Idempotent by `commandId`. */
export async function roadAnchorsCommandV2(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  request: RoadAnchorsRequest,
  generation: number,
): Promise<RoadAnchorsConfirmationV2> {
  if (!Number.isSafeInteger(generation) || generation < 0) throw Error('Invalid synchronization generation');
  const content = canonical(request);
  const replay = async (tx: Kysely<Database>, village: OwnedVillage) => {
    const receipt = await tx
      .selectFrom('roadAnchorReceipts')
      .selectAll()
      .where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId)
      .where('commandId', '=', request.commandId)
      .executeTakeFirst();
    if (!receipt) return null;
    if (!isDeepStrictEqual(receipt.request, content))
      throw new HttpError(409, 'COMMAND_REUSED', 'Identifiant de commande déjà utilisé.');
    return {
      protocol: 2 as const,
      worldId: village.worldId,
      villageId: village.villageId,
      commandId: request.commandId,
      status: 'applied' as const,
      commandTime: new Date(receipt.createdAt).toISOString(),
      result: receipt.result,
    };
  };
  // An exact replay answers from its receipt, without lock or reconciliation.
  const known = await replay(db, await ownedVillage(db, accountId, slug, villageId));
  if (known) return known;
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, slug, villageId);
    const economy = await beginVillageEconomy(tx, village.worldId, villageId, undefined, [], [], true);
    await roadAnchorsTestHooks.afterLock?.();
    // A concurrent first attempt of the same identifier committed meanwhile.
    const raced = await replay(tx, village);
    if (raced) return raced;
    const prepared = await prepareRoadAnchors(tx, village, economy, request);
    if (request.action === 'place' && !isDeepStrictEqual(request.expectedQuote, prepared.quote))
      throw new HttpError(409, 'QUOTE_CHANGED', 'Le devis a changé. Aucun accessoire posé.');
    const { worldId } = village;
    const costs = (['stone', 'wood'] as const)
      .filter((code) => prepared.quote[code] > 0)
      .map((code) => ({ resourceCode: code, amount: prepared.quote[code] }));
    if (costs.length) await debit(tx, worldId, villageId, costs, economy.through);
    const inserts = prepared.write.filter((w) => w.insert);
    if (inserts.length)
      await tx
        .insertInto('roadAnchors')
        .values(
          inserts.map((w) => ({
            worldId,
            villageId,
            vertexX: w.vertexX,
            vertexY: w.vertexY,
            accessory: w.accessory,
            createdAt: economy.through,
            updatedAt: economy.through,
          })),
        )
        .execute();
    for (const accessory of ['brazier', 'none'] as const) {
      const updates = prepared.write.filter((w) => !w.insert && w.accessory === accessory);
      if (updates.length)
        await tx
          .updateTable('roadAnchors')
          .set({ accessory, revision: sql`revision + 1`, updatedAt: economy.through })
          .where('worldId', '=', worldId)
          .where('villageId', '=', villageId)
          .where(unnestVertices(updates))
          .execute();
    }
    if (prepared.remove.length)
      await tx
        .deleteFrom('roadAnchors')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where(unnestVertices(prepared.remove))
        .execute();
    await roadAnchorsTestHooks.afterWrites?.(tx);
    await tx
      .insertInto('roadAnchorReceipts')
      .values({
        worldId,
        villageId,
        commandId: request.commandId,
        request: JSON.stringify(content),
        result: JSON.stringify(prepared.result),
        createdAt: economy.through,
      })
      .execute();
    let effects: SyncV2Batch | undefined;
    await villageCommandResult(tx, accountId, slug, village, economy, 'commit', request.commandId, async (t, e) => {
      effects = await publishPrivateEffects(t, e, generation);
    });
    return {
      protocol: 2,
      worldId,
      villageId,
      commandId: request.commandId,
      status: 'applied',
      commandTime: economy.through.toISOString(),
      result: prepared.result,
      ...(effects ? { effects } : {}),
    };
  });
}
