import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Transaction } from 'kysely';
import {
  roadCellStoneCost,
  uniqueRoadCells,
  wrappedDistance,
  type RoadCellsConfirmationV2,
  type RoadCellsPreview,
  type RoadCellsPreviewRequest,
  type RoadCellsQuote,
  type RoadCellsRequest,
  type RoadCellsResult,
  type RoadCellSkip,
  type RoadCellSkipCode,
  type RoadCellStyle,
  type RoadCellSurface,
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
import { cleanRoadAnchors } from './road-anchors.js';
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
const SKIP_MESSAGES: Record<RoadCellSkipCode, string> = {
  OUTSIDE_INFRASTRUCTURE_REACH: 'Hors du périmètre historique du village.',
  FOREIGN_INFRASTRUCTURE: 'Un aménagement d’un autre village occupe cet emplacement.',
  CELL_OCCUPIED: 'Un bâtiment ou un gisement occupe cet emplacement.',
  INCOMPATIBLE_TERRAIN: 'Cette infrastructure nécessite un terrain praticable.',
};
/** A gesture whose every cell is refused; the quote still names them. */
class RoadCellsRefused extends HttpError {
  constructor(
    code: RoadCellSkipCode,
    readonly skipped: RoadCellSkip[],
  ) {
    super(409, code, SKIP_MESSAGES[code]);
  }
}
const skipError = (code: RoadCellSkipCode, skipped: RoadCellSkip[] = []) => new RoadCellsRefused(code, skipped);
const unnest = (cells: readonly Cell[]) =>
  sql<boolean>`(cell_x,cell_y) in (select * from unnest(${cells.map((c) => c.cellX)}::int[],${cells.map((c) => c.cellY)}::int[]))`;

/** Per-cell refusals of road cells, first rule wins (S2d), with the village's
 * own existing cells. Reach and foreign cells always; with `placement`, also
 * footprints (any village), blocking deposits and terrain. Bounded reads: the
 * named cells and the village's terrain window. Shared with the conversion of
 * the legacy plan (S3). Coordinates must be canonical. */
export async function roadCellRefusals(
  tx: Transaction<Database>,
  village: OwnedVillage,
  cells: readonly Cell[],
  placement: boolean,
): Promise<{
  refused: Map<string, RoadCellSkipCode>;
  own: Map<string, { villageId: string; cellX: number; cellY: number; surface: RoadCellSurface; sidewalks: boolean }>;
}> {
  const { worldId, villageId } = village;
  const refused = new Map<string, RoadCellSkipCode>();
  const refuse = (cell: Cell, code: RoadCellSkipCode) => {
    if (!refused.has(cellKey(cell))) refused.set(cellKey(cell), code);
  };
  if (!cells.length) return { refused, own: new Map() };
  for (const cell of cells) {
    const dx = wrappedDistance(cell.cellX, village.anchorCellX, village.widthCells),
      dy = wrappedDistance(cell.cellY, village.anchorCellY, village.heightCells);
    if (dx < -REACH || dx >= REACH || dy < -REACH || dy >= REACH) refuse(cell, 'OUTSIDE_INFRASTRUCTURE_REACH');
  }
  const existing = await tx
    .selectFrom('roadCells')
    .select(['villageId', 'cellX', 'cellY', 'surface', 'sidewalks'])
    .where('worldId', '=', worldId)
    .where(unnest(cells))
    .execute();
  for (const row of existing) if (row.villageId !== villageId) refuse(row, 'FOREIGN_INFRASTRUCTURE');
  const own = new Map(existing.filter((row) => row.villageId === villageId).map((row) => [cellKey(row), row]));
  if (!placement) return { refused, own };
  // Same occupancy rules as a manual road: a footprint (any village, any
  // state) or a blocking deposit refuses the cell; then the terrain. Reads
  // stay bounded by the named cells.
  const buildings = await tx
    .selectFrom('worldCellOccupancies')
    .select(['cellX', 'cellY'])
    .where('worldId', '=', worldId)
    .where('buildingId', 'is not', null)
    .where(unnest(cells))
    .execute();
  for (const cell of buildings) refuse(cell, 'CELL_OCCUPIED');
  const features = await naturalFeaturesQuery(
    tx,
    worldId,
    cells.map((c) => ({ minX: c.cellX, maxX: c.cellX + 1, minY: c.cellY, maxY: c.cellY + 1 })),
  ).execute();
  for (const f of features)
    if (f.initialAmount !== null && f.blocksCell !== false && !f.cleared && f.featureState !== 'depleted')
      refuse(f, 'CELL_OCCUPIED');
  const ground = await readVillageGround(tx, village);
  for (const cell of cells) {
    if (refused.has(cellKey(cell))) continue;
    const { cellX, cellY } = cell;
    const surface = { x: cellX, y: cellY, halfWidth: 0.5, halfHeight: 0.5 };
    if (
      ground.terrainAt(cellX, cellY) !== TERRAIN.grassland ||
      (ground.rc1 && (ground.rc1.field.surfaceReason(surface, null, 0.125) || ground.rc1.field.intersectsTree(surface)))
    )
      refuse(cell, 'INCOMPATIBLE_TERRAIN');
  }
  return { refused, own };
}

/** Shared by the read-only quote and the command, with bounded reads only
 * (the named cells, the village's terrain window): never `state()`. Every
 * refusal is thrown before any write. */
async function prepareRoadCells(
  tx: Transaction<Database>,
  village: OwnedVillage,
  economy: VillageEconomy,
  named: Gesture,
): Promise<Prepared> {
  const { worldId, villageId } = village;
  // A cell named twice in one gesture counts once (Tristan, 30 October).
  const gesture = { ...named, cells: uniqueRoadCells(named.cells) };
  for (const cell of gesture.cells)
    if (cell.cellX >= village.widthCells || cell.cellY >= village.heightCells)
      throw new HttpError(400, 'INVALID_COORDINATES', 'Coordonnées non canoniques.');
  const style =
    gesture.action === 'place'
      ? { surface: gesture.style.surface, sidewalks: gesture.style.sidewalks, gauge: gesture.style.gauge ?? 'chemin' }
      : null;
  if (style && style.gauge !== 'chemin')
    throw new HttpError(409, 'GAUGE_UNAVAILABLE', 'Les routes charretières ne sont pas encore disponibles.');
  // Per-cell refusals, first rule wins; a placement skips these cells
  // (Tristan, 30 October), a removal keeps refusing the whole gesture.
  const { refused, own } = await roadCellRefusals(tx, village, gesture.cells, Boolean(style));
  const result: RoadCellsResult = { placed: 0, restyled: 0, removed: 0, unchanged: 0, stone: 0 };
  if (!style) {
    const first = gesture.cells.find((cell) => refused.has(cellKey(cell)));
    if (first) throw skipError(refused.get(cellKey(first))!);
    const remove = gesture.cells.filter((cell) => own.has(cellKey(cell)));
    result.removed = remove.length;
    result.unchanged = gesture.cells.length - remove.length;
    return { quote: { stone: 0 }, result, place: [], remove, style: null };
  }
  const skipped: RoadCellSkip[] = [];
  for (const cell of gesture.cells) {
    const code = refused.get(cellKey(cell));
    if (code) skipped.push({ cellX: cell.cellX, cellY: cell.cellY, code });
  }
  // Every cell refused: still a refusal of the gesture, with the first motive.
  if (skipped.length === gesture.cells.length) throw skipError(skipped[0]!.code, skipped);
  if (skipped.length) result.skipped = skipped;
  const place: Prepared['place'] = [];
  for (const cell of gesture.cells) {
    if (refused.has(cellKey(cell))) continue;
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

/** Own cells a removal deletes, with the refusals of the removal gesture (a
 * foreign or out-of-reach cell refuses all; an absent cell is unchanged).
 * Shared with demolition (docs/SPEC-DEMOLITION.md §9); no write. */
export async function roadCellsToRemove(
  tx: Transaction<Database>,
  village: OwnedVillage,
  cells: readonly Cell[],
): Promise<Cell[]> {
  if (!cells.length) return [];
  const { refused, own } = await roadCellRefusals(tx, village, cells, false);
  const first = cells.find((cell) => refused.has(cellKey(cell)));
  if (first) throw skipError(refused.get(cellKey(first))!);
  return cells.filter((cell) => own.has(cellKey(cell)));
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
        result: {
          placed: 0,
          restyled: 0,
          removed: 0,
          unchanged: 0,
          stone: 0,
          ...(error instanceof RoadCellsRefused && error.skipped.length ? { skipped: error.skipped } : {}),
        },
      };
    }
  });
}

/** Canonical content of a gesture: what one command identifier names. A cell
 * named twice is the same gesture as the cell named once. */
function canonical(request: RoadCellsRequest) {
  const cells = uniqueRoadCells(request.cells).map(({ cellX, cellY }) => ({ cellX, cellY }));
  return request.action === 'place'
    ? {
        action: request.action,
        cells,
        style: {
          surface: request.style.surface,
          sidewalks: request.style.sidewalks,
          gauge: request.style.gauge ?? 'chemin',
        },
        expectedQuote: { stone: request.expectedQuote.stone },
      }
    : { action: request.action, cells };
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
    // Anchors of the changed cells (S4a): an accessory leaves with the last
    // road cell of its village touching its vertex; a suppression (`none`)
    // leaves when its vertex is no longer a re-entrant corner.
    await cleanRoadAnchors(
      tx,
      worldId,
      villageId,
      [...prepared.place.filter((cell) => cell.insert), ...prepared.remove],
      village,
    );
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
