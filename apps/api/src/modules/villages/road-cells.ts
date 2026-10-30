import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Transaction } from 'kysely';
import {
  roadCellStoneCost,
  wrappedDistance,
  type RoadCellsConfirmationV2,
  type RoadCellsPreview,
  type RoadCellsPreviewRequest,
  type RoadCellsQuote,
  type RoadCellsRequest,
  type RoadCellsResult,
  type RoadCellStyle,
  type SyncV2Batch,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { readRc1Source } from '../worlds/rc1-source.js';
import { naturalFeaturesQuery } from '../worlds/natural-features.js';
import { TERRAIN } from '../worlds/generation.js';
import { beginVillageEconomy, type VillageEconomy } from './reconcile-economy.js';
import { projectVillageResource } from './economy.js';
import { publishPrivateEffects } from './sync-v2-effects.js';
import {
  debit,
  ownedVillage,
  readVillageGround,
  villageCommandResult,
  withVillageProjection,
  type OwnedVillage,
} from './service.js';

/** Historical perimeter of the manual roads (assertInfrastructurePosition). */
const REACH = 32;
type Cell = { cellX: number; cellY: number };
type Gesture = RoadCellsPreviewRequest;
interface Prepared {
  quote: RoadCellsQuote;
  result: RoadCellsResult;
  place: Array<Cell & { insert: boolean }>;
  remove: Cell[];
  style: Required<RoadCellStyle> | null;
}
const cellKey = (c: Cell) => `${c.cellX}:${c.cellY}`;
const unnest = (cells: readonly Cell[]) =>
  sql<boolean>`(cell_x,cell_y) in (select * from unnest(${cells.map((c) => c.cellX)}::int[],${cells.map((c) => c.cellY)}::int[]))`;

/** Shared by the read-only quote and the command, with bounded reads only
 * (the named cells, the village's terrain window): never `state()`. Every
 * refusal is thrown before any write. */
async function prepareRoadCells(
  tx: Transaction<Database>,
  village: OwnedVillage,
  economy: VillageEconomy,
  gesture: Gesture,
): Promise<Prepared> {
  const { worldId, villageId } = village;
  const seen = new Set<string>();
  for (const cell of gesture.cells) {
    if (cell.cellX >= village.widthCells || cell.cellY >= village.heightCells)
      throw new HttpError(400, 'INVALID_COORDINATES', 'Coordonnées non canoniques.');
    if (seen.has(cellKey(cell))) throw new HttpError(400, 'INVALID_CELLS', 'Une case est nommée deux fois.');
    seen.add(cellKey(cell));
    const dx = wrappedDistance(cell.cellX, village.anchorCellX, village.widthCells),
      dy = wrappedDistance(cell.cellY, village.anchorCellY, village.heightCells);
    if (dx < -REACH || dx >= REACH || dy < -REACH || dy >= REACH)
      throw new HttpError(409, 'OUTSIDE_INFRASTRUCTURE_REACH', 'Hors du périmètre historique du village.');
  }
  const style =
    gesture.action === 'place'
      ? { surface: gesture.style.surface, sidewalks: gesture.style.sidewalks, gauge: gesture.style.gauge ?? 'chemin' }
      : null;
  if (style && style.gauge !== 'chemin')
    throw new HttpError(409, 'GAUGE_UNAVAILABLE', 'Les routes charretières ne sont pas encore disponibles.');
  const existing = await tx
    .selectFrom('roadCells')
    .select(['villageId', 'cellX', 'cellY', 'surface', 'sidewalks'])
    .where('worldId', '=', worldId)
    .where(unnest(gesture.cells))
    .execute();
  if (existing.some((row) => row.villageId !== villageId))
    throw new HttpError(409, 'FOREIGN_INFRASTRUCTURE', 'Un aménagement d’un autre village occupe cet emplacement.');
  const own = new Map(existing.map((row) => [cellKey(row), row]));
  const result: RoadCellsResult = { placed: 0, restyled: 0, removed: 0, unchanged: 0, stone: 0 };
  if (!style) {
    const remove = gesture.cells.filter((cell) => own.has(cellKey(cell)));
    result.removed = remove.length;
    result.unchanged = gesture.cells.length - remove.length;
    return { quote: { stone: 0 }, result, place: [], remove, style: null };
  }
  // Same occupancy rules as a manual road: a footprint (any village, any
  // state) or a blocking deposit refuses the cell; then the terrain.
  const buildings = await tx
    .selectFrom('worldCellOccupancies')
    .select(['cellX', 'cellY'])
    .where('worldId', '=', worldId)
    .where('buildingId', 'is not', null)
    .where(unnest(gesture.cells))
    .executeTakeFirst();
  if (buildings) throw new HttpError(409, 'CELL_OCCUPIED', 'L’emprise d’un bâtiment bloque cet emplacement.');
  const features = await naturalFeaturesQuery(
    tx,
    worldId,
    gesture.cells.map((c) => ({ minX: c.cellX, maxX: c.cellX + 1, minY: c.cellY, maxY: c.cellY + 1 })),
  ).execute();
  if (
    features.some(
      (f) => f.initialAmount !== null && f.blocksCell !== false && !f.cleared && f.featureState !== 'depleted',
    )
  )
    throw new HttpError(409, 'CELL_OCCUPIED', 'Un gisement occupe cet emplacement.');
  const ground = await readVillageGround(tx, village);
  for (const { cellX, cellY } of gesture.cells) {
    const surface = { x: cellX, y: cellY, halfWidth: 0.5, halfHeight: 0.5 };
    if (
      ground.terrainAt(cellX, cellY) !== TERRAIN.grassland ||
      (ground.rc1 && (ground.rc1.field.surfaceReason(surface, null, 0.125) || ground.rc1.field.intersectsTree(surface)))
    )
      throw new HttpError(409, 'INCOMPATIBLE_TERRAIN', 'Cette infrastructure nécessite un terrain praticable.');
  }
  const place: Prepared['place'] = [];
  for (const cell of gesture.cells) {
    const current = own.get(cellKey(cell)) ?? null;
    if (current && current.surface === style.surface && current.sidewalks === style.sidewalks) {
      result.unchanged++;
      continue;
    }
    if (current) result.restyled++;
    else result.placed++;
    result.stone += roadCellStoneCost(current, style);
    place.push({ ...cell, insert: !current });
  }
  if (result.stone) {
    const stone = await projectVillageResource(tx, worldId, villageId, 'stone', economy.through);
    if (stone.amount < result.stone) throw new HttpError(409, 'INSUFFICIENT_RESOURCES', 'Ressources insuffisantes.');
  }
  return { quote: { stone: result.stone }, result, place, remove: [], style };
}

/** Read-only quote, in the projection's snapshot: no lock, no write. */
export async function previewRoadCells(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  gesture: RoadCellsPreviewRequest,
): Promise<RoadCellsPreview> {
  const village = await ownedVillage(db, accountId, slug, villageId);
  if (village.generationVersion === 3) await readRc1Source(db, village.worldId);
  return withVillageProjection(db, accountId, slug, villageId, async (tx, economy, current) => {
    try {
      const prepared = await prepareRoadCells(tx, current, economy, gesture);
      return { valid: true, code: null, message: null, quote: prepared.quote, result: prepared.result };
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      return {
        valid: false,
        code: error.code,
        message: error.message,
        quote: { stone: 0 },
        result: { placed: 0, restyled: 0, removed: 0, unchanged: 0, stone: 0 },
      };
    }
  });
}

/** Canonical content of a gesture: what one command identifier names. */
function canonical(request: RoadCellsRequest) {
  return request.action === 'place'
    ? {
        action: request.action,
        cells: request.cells.map(({ cellX, cellY }) => ({ cellX, cellY })),
        style: {
          surface: request.style.surface,
          sidewalks: request.style.sidewalks,
          gauge: request.style.gauge ?? 'chemin',
        },
        expectedQuote: { stone: request.expectedQuote.stone },
      }
    : { action: request.action, cells: request.cells.map(({ cellX, cellY }) => ({ cellX, cellY })) };
}

/** Test seam: runs after the cells and the debit are written, before the
 * receipt and the publication (rollback proof). */
export const roadCellsTestHooks: { afterWrites?: (tx: Transaction<Database>) => Promise<void> } = {};

/** V2-native gesture: village lock (beginVillageEconomy, with the world's
 * exclusive navigation lock, as every infrastructure writer), bounded reads,
 * refusal without writes, debit, cell writes, receipt, then terminal
 * publication of the private effects. Idempotent by `commandId`. */
export async function roadCellsCommandV2(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  request: RoadCellsRequest,
  generation: number,
): Promise<RoadCellsConfirmationV2> {
  if (!Number.isSafeInteger(generation) || generation < 0) throw Error('Invalid synchronization generation');
  const content = canonical(request);
  const replay = async (tx: Kysely<Database>, village: OwnedVillage) => {
    const receipt = await tx
      .selectFrom('roadCellReceipts')
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
    if (village.generationVersion === 3) await readRc1Source(tx, village.worldId);
    const economy = await beginVillageEconomy(tx, village.worldId, villageId, undefined, [], [], true);
    // A concurrent first attempt of the same identifier committed meanwhile.
    const raced = await replay(tx, village);
    if (raced) return raced;
    const prepared = await prepareRoadCells(tx, village, economy, request);
    if (request.action === 'place' && !isDeepStrictEqual(request.expectedQuote, prepared.quote))
      throw new HttpError(409, 'QUOTE_CHANGED', 'Le devis a changé. Aucune route posée.');
    const { worldId } = village;
    if (prepared.quote.stone)
      await debit(tx, worldId, villageId, [{ resourceCode: 'stone', amount: prepared.quote.stone }], economy.through);
    const style = prepared.style;
    if (style && prepared.place.some((cell) => cell.insert))
      await tx
        .insertInto('roadCells')
        .values(
          prepared.place
            .filter((cell) => cell.insert)
            .map((cell) => ({
              worldId,
              villageId,
              cellX: cell.cellX,
              cellY: cell.cellY,
              surface: style.surface,
              sidewalks: style.sidewalks,
              gauge: style.gauge,
              createdAt: economy.through,
              updatedAt: economy.through,
            })),
        )
        .execute();
    const restyle = prepared.place.filter((cell) => !cell.insert);
    if (style && restyle.length)
      await tx
        .updateTable('roadCells')
        .set({
          surface: style.surface,
          sidewalks: style.sidewalks,
          gauge: style.gauge,
          revision: sql`revision + 1`,
          updatedAt: economy.through,
        })
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where(unnest(restyle))
        .execute();
    if (prepared.remove.length)
      await tx
        .deleteFrom('roadCells')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where(unnest(prepared.remove))
        .execute();
    await roadCellsTestHooks.afterWrites?.(tx);
    await tx
      .insertInto('roadCellReceipts')
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
