import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Transaction } from 'kysely';
import {
  cellVertices,
  fixedBuildingFootprint,
  footprintVertices,
  isBuildingFootprintFlat,
  levelingWork,
  spawnDelta,
  terrainEditCellCount,
  terrainEditCells,
  terrainEditUnit,
  terrainRestoreCells,
  terrainRestoreUnit,
  triangleHeight,
  vertexCells,
  vertexKey,
  vertexLeveling,
  TERRAIN_EDIT_CELLS_PER_COMMAND,
  type SyncV2Batch,
  type TerrainEditGesture,
  type TerrainEditRefusal,
  type TerrainEditRefusalCode,
  type TerrainEditsConfirmationV2,
  type TerrainEditsRequest,
  type TerrainEditsResult,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { readRc1Ground } from '../worlds/rc1-ground.js';
import { readRc1Source } from '../worlds/rc1-source.js';
import { editedRc1Field } from '../onboarding/rc1-field.js';
import { beginVillageEconomy } from './reconcile-economy.js';
import { assertSpatialCoverage, vertexCells as spatialVertexCells } from '../worlds/spatial-locks.js';
import { publishPrivateEffects } from './sync-v2-effects.js';
import { buildableCellRefusals, ownedVillage, villageCommandResult, type OwnedVillage } from './service.js';

/** Instant terrain edits (docs/SPEC-TERRAFORMATION-INSTANTANEE.md): one batch
 * of gestures, applied in order at admission, free and without workers. A
 * refusal no longer voids the batch (docs/SPEC-TERRAFORMATION-OUTIL.md §7):
 * the unit is one painted cell of a free gesture (its 3 × 3), or a whole
 * footprint leveling. Never reads `state()` (step 5b). */
type Cell = { cellX: number; cellY: number };
type Vertex = { vertexX: number; vertexY: number; height: number };
const key = (c: Cell) => `${c.cellX}:${c.cellY}`;
const wrap = (n: number, size: number) => ((n % size) + size) % size;

/** A batch where nothing is written and something is refused: 409 with the
 * code of the first refusal, its gesture and every refused unit. */
class TerrainEditRefused extends HttpError {
  constructor(
    readonly gesture: number,
    code: string,
    message: string,
    readonly refused: readonly TerrainEditRefusal[],
  ) {
    super(409, code, message, { gesture, refused });
  }
}

/** Canonical content of a batch: what one command identifier names. */
const canonical = (request: TerrainEditsRequest) => ({
  gestures: request.gestures.map((g) =>
    g.buildingType === 'terrain-restore'
      ? {
          buildingType: g.buildingType,
          cells: g.cells.map(({ cellX, cellY, corners, expected }) => ({
            cellX,
            cellY,
            corners: [...corners],
            expected: [...expected],
          })),
        }
      : g.buildingType === 'terrain'
        ? {
            buildingType: g.buildingType,
            anchor: { cellX: g.anchor.cellX, cellY: g.anchor.cellY },
            cells: g.cells.map(({ cellX, cellY }) => ({ cellX, cellY })),
            height: g.height,
          }
        : {
            buildingType: g.buildingType,
            anchor: { cellX: g.anchor.cellX, cellY: g.anchor.cellY },
            quarterTurns: g.quarterTurns,
          },
  ),
});

interface Applied {
  /** Final heights of every vertex the batch touched (vertex worlds). */
  vertices: Map<string, Vertex>;
  /** Footprint terraces (worlds without shared vertices). */
  terraces: Map<string, Cell & { height: number }>;
  /** Gestures with at least one unit written. */
  gestures: number;
  /** Gestures with neither a unit written nor a unit refused. */
  unchanged: number;
  /** Refused units in processing order, and their messages. */
  refused: TerrainEditRefusal[];
  messages: string[];
}
/** One unit: a painted cell of a free gesture, or a whole footprint. A unit
 * refused before any cell is read (selection, limit, world) carries its code. */
interface Unit {
  gesture: number;
  anchor: Cell;
  cells: Cell[];
  free: boolean;
  height: number;
  /** A restored cell (§7.10): its four corner heights and those the undone stroke left. */
  corners?: readonly number[];
  expected?: readonly number[];
  refusal?: { code: TerrainEditRefusalCode; message: string };
}
/** Rank of a cell refusal: `assertBuildableCells` throws the infrastructure
 * of any cell first, then engaged passages, then the ground cell by cell. */
const RANK: Record<string, number> = { INFRASTRUCTURE_OCCUPIED: 0, ENGAGED_PASSAGE: 1 };
/** The refusal `assertBuildableCells(cells)` would throw, with the cell it names. */
function firstRefusal(cells: readonly Cell[], refusals: ReadonlyMap<string, HttpError>) {
  let found: { cell: Cell; error: HttpError } | null = null,
    rank = Infinity;
  for (const cell of cells) {
    const error = refusals.get(key(cell));
    if (error && (RANK[error.code] ?? 2) < rank) {
      found = { cell, error };
      rank = RANK[error.code] ?? 2;
    }
  }
  return found;
}

/**
 * Validates and applies the batch in memory, unit after unit in batch order
 * (gestures in order, the painted cells of a free gesture in the canonical
 * order of `terraformCells`), each on the field the accepted ones before it
 * leave. A refused unit writes nothing and the next one goes on: the accepted
 * units of a batch end exactly where the all-or-nothing version left them.
 * Throws only the global refusals (world, coordinates), before any write.
 */
async function prepareTerrainEdits(
  tx: Transaction<Database>,
  v: OwnedVillage,
  gestures: readonly TerrainEditGesture[],
): Promise<Applied> {
  if (v.generationVersion !== 3)
    throw new HttpError(409, 'LEVELING_UNAVAILABLE', 'La terraformation est disponible sur les mondes RC1.');
  for (const gesture of gestures)
    if (
      (gesture.buildingType === 'terrain-restore' ? gesture.cells : [gesture.anchor]).some(
        (c) => c.cellX >= v.widthCells || c.cellY >= v.heightCells,
      )
    )
      throw new HttpError(400, 'INVALID_COORDINATES', 'Coordonnées non canoniques.');
  const ground = await readRc1Ground(tx, v.worldId);
  const source = await readRc1Source(tx, v.worldId);
  const geometry = ground.field.geometry;
  const applied: Applied = {
    vertices: new Map(),
    terraces: new Map(),
    gestures: 0,
    unchanged: 0,
    refused: [],
    messages: [],
  };
  const heightAt = (x: number, y: number) =>
    applied.vertices.get(`${wrap(x, v.widthCells)}:${wrap(y, v.heightCells)}`)?.height ?? geometry!.height(x, y);
  const mergedTerraces = (terraces: Map<string, Cell & { height: number }>) =>
    [...ground.terraces.filter((c) => !terraces.has(key(c))), ...terraces.values()].sort(
      (a, b) => a.cellX - b.cellX || a.cellY - b.cellY,
    );
  // Foundations are compared near the edited cells only; read once.
  const foundations = await tx
    .selectFrom('worldCellOccupancies')
    .select(['cellX', 'cellY'])
    .where('worldId', '=', v.worldId)
    .where('buildingId', 'is not', null)
    .execute();
  const nearFoundations = (cells: readonly Cell[]) =>
    foundations.filter((f) =>
      cells.some(
        (p) =>
          Math.abs(spawnDelta(p.cellX, f.cellX, v.widthCells)) <= 1 &&
          Math.abs(spawnDelta(p.cellY, f.cellY, v.heightCells)) <= 1,
      ),
    );

  // 1. The units, gesture by gesture; a gesture refused as a whole is one unit.
  const units: Unit[] = [];
  for (const [index, gesture] of gestures.entries()) {
    if (gesture.buildingType === 'terrain-restore') {
      // Restoration (§7.10): one unit per cell, in the given order.
      const anchor = { cellX: gesture.cells[0]!.cellX, cellY: gesture.cells[0]!.cellY };
      const whole = (code: TerrainEditRefusalCode, message: string) =>
        units.push({ gesture: index, anchor, cells: [], free: true, height: 0, refusal: { code, message } });
      let restored: ReturnType<typeof terrainRestoreCells>;
      try {
        restored = terrainRestoreCells(gesture, v);
      } catch {
        whole('INVALID_TERRAFORM_SELECTION', 'Restauration invalide.');
        continue;
      }
      if (!geometry) whole('LEVELING_UNAVAILABLE', 'Ce monde doit utiliser le terrain à sommets partagés.');
      else
        for (const c of restored) {
          const cell = { cellX: c.cellX, cellY: c.cellY };
          units.push({
            gesture: index,
            anchor: cell,
            cells: [cell],
            free: true,
            height: 0,
            corners: c.corners,
            expected: c.expected,
          });
        }
      continue;
    }
    const free = gesture.buildingType === 'terrain';
    const whole = (code: TerrainEditRefusalCode, message: string) =>
      units.push({ gesture: index, anchor: gesture.anchor, cells: [], free, height: 0, refusal: { code, message } });
    let cells: Cell[];
    try {
      cells = free
        ? terrainEditCells(gesture, v)
        : fixedBuildingFootprint(gesture.buildingType, gesture.anchor, gesture.quarterTurns, v);
    } catch {
      whole('INVALID_TERRAFORM_SELECTION', 'Sélection ou hauteur invalide.');
      continue;
    }
    if (!free) {
      // Same instance limit as the placement: no footprint for a building the village cannot place.
      const limit = await tx
        .selectFrom('buildingTypes')
        .select([
          'instanceLimitPerVillage',
          (eb) =>
            eb
              .selectFrom('buildings')
              .select(sql<number>`count(*)::int`.as('n'))
              .where('worldId', '=', v.worldId)
              .where('villageId', '=', v.villageId)
              .where('buildingType', '=', gesture.buildingType)
              .as('instances'),
        ])
        .where('code', '=', gesture.buildingType)
        .executeTakeFirst();
      if (limit?.instanceLimitPerVillage != null && Number(limit.instances) >= limit.instanceLimitPerVillage) {
        whole('BUILDING_LIMIT_REACHED', 'Limite atteinte pour ce bâtiment.');
        continue;
      }
      units.push({ gesture: index, anchor: gesture.anchor, cells, free, height: 0 });
    } else if (!geometry) whole('LEVELING_UNAVAILABLE', 'Ce monde doit utiliser le terrain à sommets partagés.');
    else
      for (const cell of cells)
        units.push({ gesture: index, anchor: cell, cells: [cell], free, height: gesture.height });
  }

  // 2. One read of the refusals of every unit's cells and of their rings.
  const wanted = new Map<string, Cell>();
  for (const unit of units)
    for (const c of [
      ...unit.cells,
      ...(geometry && unit.cells.length ? vertexCells(footprintVertices(unit.cells, v), v) : []),
    ])
      wanted.set(key(c), c);
  const refusals = await buildableCellRefusals(tx, v, [...wanted.values()]);

  // 3. Unit after unit, each on the field the accepted ones leave.
  const written = new Set<number>(),
    refusedGestures = new Set<number>();
  let field = ground.field;
  // Shared vertices: a sample at a vertex is its height, the water surface
  // does not depend on the edits, and a foundation's samples (corners, edge
  // midpoints, centre) move exactly when one of its corners does.
  const wetCell = (affectedCells: readonly Cell[], after: (x: number, y: number) => number) =>
    affectedCells.find((c) =>
      footprintVertices([c], v).some(
        (p) =>
          after(p.vertexX, p.vertexY) <= Math.max(0, field.sample(p.vertexX - 0.5, p.vertexY - 0.5).surface) + 1e-6,
      ),
    );
  const movedFoundation = (cells: readonly Cell[], after: (x: number, y: number) => number) =>
    nearFoundations(cells).find((f) =>
      cellVertices(f, v).some((p) => after(p.vertexX, p.vertexY) !== heightAt(p.vertexX, p.vertexY)),
    );
  for (const unit of units) {
    const refuse = (code: string, message: string, at: Cell) => {
      applied.refused.push({
        gesture: unit.gesture,
        cell: { cellX: unit.anchor.cellX, cellY: unit.anchor.cellY },
        code: code as TerrainEditRefusalCode,
        at: { cellX: at.cellX, cellY: at.cellY },
      });
      applied.messages.push(message);
      refusedGestures.add(unit.gesture);
    };
    if (unit.refusal) {
      refuse(unit.refusal.code, unit.refusal.message, unit.anchor);
      continue;
    }
    const { cells } = unit;
    if (unit.corners && unit.expected && geometry) {
      // A restored cell: no effect (nothing left intact included) is no refusal, checked first (an unchanged
      // cell beside a road is not refused); then the rules of a painted cell.
      const plan = terrainRestoreUnit(cells[0]!, v, heightAt, unit.corners, unit.expected);
      if (plan.volume < 1e-9) continue;
      const obstacle = firstRefusal(cells, refusals) ?? firstRefusal(plan.affectedCells, refusals);
      if (obstacle) {
        refuse(obstacle.error.code, obstacle.error.message, obstacle.cell);
        continue;
      }
      const next = new Map(plan.vertices.map((p) => [vertexKey(p), p.height]));
      const after = (x: number, y: number) => next.get(`${x}:${y}`) ?? heightAt(x, y);
      // Water over the whole surface, corners included, at the restored heights.
      const [h00, h10, h11, h01] = plan.vertices.map((p) => p.height) as [number, number, number, number];
      const c = cells[0]!;
      let flooded = false;
      for (let y = 0; y <= 8 && !flooded; y++)
        for (let x = 0; x <= 8 && !flooded; x++) {
          const s = field.sample(c.cellX - 0.5 + x / 8, c.cellY - 0.5 + y / 8);
          flooded = triangleHeight(h00, h10, h11, h01, x / 8, y / 8) <= Math.max(0, s.surface) + 1e-6;
        }
      if (flooded) {
        refuse('LEVELING_WATER', 'Cette hauteur ferait entrer l’eau dans la sélection.', c);
        continue;
      }
      const wet = wetCell(plan.affectedCells, after);
      if (wet) {
        refuse('LEVELING_WATER', 'Le raccord du terrain ferait entrer l’eau.', wet);
        continue;
      }
      const moved = movedFoundation(cells, after);
      if (moved) {
        refuse('LEVELING_FOUNDATION', 'Éloignez la retouche de la fondation voisine.', moved);
        continue;
      }
      for (const p of plan.vertices) applied.vertices.set(vertexKey(p), p);
      written.add(unit.gesture);
      continue;
    }
    const blocked = firstRefusal(cells, refusals);
    if (blocked) {
      refuse(blocked.error.code, blocked.error.message, blocked.cell);
      continue;
    }
    // A unit without effect is no refusal: nothing to write for it.
    if (
      !unit.free &&
      isBuildingFootprintFlat(
        geometry
          ? footprintVertices(cells, v).map((p) => heightAt(p.vertexX, p.vertexY) * 100)
          : cells.map((c) => applied.terraces.get(key(c))?.height ?? ground.cell(c.cellX, c.cellY).elevation),
      )
    )
      continue;
    const plan = geometry
      ? unit.free
        ? terrainEditUnit(cells[0]!, v, heightAt, unit.height)
        : vertexLeveling(cells, v, heightAt, 1)
      : undefined;
    if (plan && plan.volume < 1e-9) continue;
    const affectedCells = plan?.affectedCells ?? cells;
    if (plan) {
      const ring = firstRefusal(affectedCells, refusals);
      if (ring) {
        refuse(ring.error.code, ring.error.message, ring.cell);
        continue;
      }
    }
    // Terrace worlds keep the historical footprint height: the mean of 64 samples per cell.
    const height =
      plan?.height ??
      levelingWork(
        cells.map((c) =>
          Array.from(
            { length: 64 },
            (_, i) =>
              field.sample(c.cellX - 0.5 + ((i % 8) + 0.5) / 8, c.cellY - 0.5 + (Math.floor(i / 8) + 0.5) / 8)
                .elevation,
          ),
        ),
        1,
      ).height;
    // Water over the whole surface, corners included, at the final height.
    const flooded = cells.find((c) => {
      for (let y = 0; y <= 8; y++)
        for (let x = 0; x <= 8; x++) {
          const s = field.sample(c.cellX - 0.5 + x / 8, c.cellY - 0.5 + y / 8);
          if (height <= Math.max(0, s.surface) + 1e-6) return true;
        }
      return false;
    });
    if (flooded) {
      refuse('LEVELING_WATER', 'Cette hauteur ferait entrer l’eau dans la sélection.', flooded);
      continue;
    }
    if (plan) {
      const next = new Map(plan.vertices.map((p) => [vertexKey(p), p.height]));
      const after = (x: number, y: number) => next.get(`${x}:${y}`) ?? heightAt(x, y);
      const wet = wetCell(affectedCells, after);
      if (wet) {
        refuse('LEVELING_WATER', 'Le raccord du terrain ferait entrer l’eau.', wet);
        continue;
      }
      const moved = movedFoundation(cells, after);
      if (moved) {
        refuse('LEVELING_FOUNDATION', 'Éloignez la retouche de la fondation voisine.', moved);
        continue;
      }
      for (const p of plan.vertices) applied.vertices.set(vertexKey(p), p);
    } else {
      const terraces = new Map(applied.terraces);
      for (const c of cells) terraces.set(key(c), { ...c, height });
      const future = editedRc1Field(source.data, source.field, mergedTerraces(terraces), []);
      const moved = nearFoundations(cells).find((f) =>
        [-0.5, 0, 0.5].some((dx) =>
          [-0.5, 0, 0.5].some(
            (dy) =>
              field.sample(f.cellX + dx, f.cellY + dy).elevation !==
              future.sample(f.cellX + dx, f.cellY + dy).elevation,
          ),
        ),
      );
      if (moved) {
        refuse('LEVELING_FOUNDATION', 'Éloignez la retouche de la fondation voisine.', moved);
        continue;
      }
      applied.terraces = terraces;
      field = future;
    }
    written.add(unit.gesture);
  }
  applied.gestures = written.size;
  applied.unchanged = gestures.filter((_, i) => !written.has(i) && !refusedGestures.has(i)).length;
  // No connectivity guarantee (docs/DECISIONS-NAVIGATION-2026-10-31.md): an edit
  // may cut a building off; navigation notices it when a trip is requested.
  return applied;
}

/** Test seam: runs after the height writes, before the receipt and the
 * publication (rollback proof); `afterLock` once the village is held. */
/** The cells a batch may change, read from the request before any lock:
 * painted cells, footprints, restored cells. Their vertices and the 3 × 3 of a
 * painted cell stay within the halo of their zones. An invalid gesture is
 * refused later without writing, so it locks nothing. */
function terrainEditWriteCells(gestures: readonly TerrainEditGesture[], v: OwnedVillage): Cell[] {
  return gestures.flatMap((gesture) => {
    try {
      if (gesture.buildingType === 'terrain-restore')
        return gesture.cells.map((c) => ({ cellX: c.cellX, cellY: c.cellY }));
      return gesture.buildingType === 'terrain'
        ? terrainEditCells(gesture, v)
        : fixedBuildingFootprint(gesture.buildingType, gesture.anchor, gesture.quarterTurns, v);
    } catch {
      return [];
    }
  });
}

export const terrainEditsTestHooks: {
  afterLock?: () => Promise<void>;
  afterWrites?: (tx: Transaction<Database>) => Promise<void>;
} = {};

/** V2-native instant terrain edits: village lock (with the world's exclusive
 * navigation lock: heights change paths), bounded reads, the accepted units'
 * height writes, receipt (with the refused units), then terminal publication.
 * Idempotent by `commandId`. */
export async function terrainEditsCommandV2(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  request: TerrainEditsRequest,
  generation: number,
): Promise<TerrainEditsConfirmationV2> {
  if (!Number.isSafeInteger(generation) || generation < 0) throw Error('Invalid synchronization generation');
  const content = canonical(request);
  const cellCount = request.gestures.reduce((n, g) => n + terrainEditCellCount(g), 0);
  if (cellCount > TERRAIN_EDIT_CELLS_PER_COMMAND)
    throw new HttpError(400, 'TERRAIN_EDITS_TOO_LARGE', 'Trop de cases dans ce lot.');
  const replay = async (tx: Kysely<Database>, village: OwnedVillage) => {
    const receipt = await tx
      .selectFrom('terrainEditReceipts')
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
    const { worldId } = village;
    const economy = await beginVillageEconomy(tx, worldId, villageId, undefined, [], [], {
      write: terrainEditWriteCells(request.gestures, village),
    });
    await terrainEditsTestHooks.afterLock?.();
    // A concurrent first attempt of the same identifier committed meanwhile.
    const raced = await replay(tx, village);
    if (raced) return raced;
    const applied = await prepareTerrainEdits(tx, village, request.gestures);
    // Nothing written and something refused: the refusal of the first unit,
    // all of them in the body, nothing written, no receipt.
    const first = applied.refused[0];
    if (first && !applied.gestures)
      throw new TerrainEditRefused(first.gesture, first.code, applied.messages[0]!, applied.refused);
    await assertSpatialCoverage(
      tx,
      worldId,
      [...applied.vertices.values()].flatMap(spatialVertexCells),
      'exclusive',
      0,
      'terrain vertices',
    );
    if (applied.vertices.size)
      await tx
        .insertInto('worldTerrainVertices')
        .values([...applied.vertices.values()].map((p) => ({ ...p, worldId })))
        .onConflict((c) =>
          c.columns(['worldId', 'vertexX', 'vertexY']).doUpdateSet((e) => ({ height: e.ref('excluded.height') })),
        )
        .execute();
    if (applied.terraces.size)
      await tx
        .insertInto('worldSpawnTerraces')
        .values([...applied.terraces.values()].map((c) => ({ ...c, worldId, villageId })))
        .onConflict((c) =>
          c
            .columns(['worldId', 'cellX', 'cellY'])
            .doUpdateSet((e) => ({ height: e.ref('excluded.height'), villageId: e.ref('excluded.villageId') })),
        )
        .execute();
    await terrainEditsTestHooks.afterWrites?.(tx);
    const result: TerrainEditsResult = {
      gestures: applied.gestures,
      unchanged: applied.unchanged,
      vertices: applied.vertices.size,
      ...(applied.refused.length ? { refused: applied.refused } : {}),
    };
    await tx
      .insertInto('terrainEditReceipts')
      .values({
        worldId,
        villageId,
        commandId: request.commandId,
        request: JSON.stringify(content),
        result: JSON.stringify(result),
        createdAt: economy.through,
      })
      .execute();
    let effects: SyncV2Batch | undefined;
    await villageCommandResult(tx, village, economy, request.commandId, async (t, e) => {
      effects = await publishPrivateEffects(t, e, generation);
    });
    return {
      protocol: 2,
      worldId,
      villageId,
      commandId: request.commandId,
      status: 'applied',
      commandTime: economy.through.toISOString(),
      result,
      ...(effects ? { effects } : {}),
    };
  });
}
