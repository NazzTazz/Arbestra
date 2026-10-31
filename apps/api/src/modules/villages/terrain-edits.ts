import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Transaction } from 'kysely';
import {
  buildTravelNetwork,
  fixedBuildingFootprint,
  footprintVertices,
  isBuildingFootprintFlat,
  levelingWork,
  spawnDelta,
  terraformCells,
  vertexKey,
  vertexLeveling,
  TERRAIN_EDIT_CELLS_PER_COMMAND,
  type SyncV2Batch,
  type TerrainEditGesture,
  type TerrainEditsConfirmationV2,
  type TerrainEditsRequest,
  type TerrainEditsResult,
  type VillageState,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { readRc1Ground } from '../worlds/rc1-ground.js';
import { readRc1Source } from '../worlds/rc1-source.js';
import { editedRc1Field } from '../onboarding/rc1-field.js';
import { rc1NetworkGround } from '../navigation/rc1-network-ground.js';
import { beginVillageEconomy, type VillageEconomy } from './reconcile-economy.js';
import { readNavigationInfrastructure } from './infrastructure.js';
import { publishPrivateEffects } from './sync-v2-effects.js';
import {
  assertBuildableCells,
  ownedVillage,
  readInfrastructureSpatialState,
  villageCommandResult,
  type OwnedVillage,
} from './service.js';

/** Instant terrain edits (docs/SPEC-TERRAFORMATION-INSTANTANEE.md): one batch
 * of gestures from the client's 10 s window, applied in order at admission,
 * all or nothing, free and without workers. Never reads `state()` (step 5b). */
type Cell = { cellX: number; cellY: number };
type Vertex = { vertexX: number; vertexY: number; height: number };
const key = (c: Cell) => `${c.cellX}:${c.cellY}`;
const wrap = (n: number, size: number) => ((n % size) + size) % size;

/** A refusal names the gesture that caused it (0-based, in batch order). */
class TerrainEditRefused extends HttpError {
  constructor(
    readonly gesture: number,
    code: string,
    message: string,
  ) {
    super(409, code, message);
  }
}

/** Canonical content of a batch: what one command identifier names. */
const canonical = (request: TerrainEditsRequest) => ({
  gestures: request.gestures.map((g) =>
    g.buildingType === 'terrain'
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
  /** Footprints leveled for a building: they must stay reachable. */
  sites: Array<{ id: string; buildingType: string; anchor: Cell; quarterTurns: number; cells: Cell[] }>;
  gestures: number;
  unchanged: number;
}

/** Validates and applies the batch in memory, gesture after gesture, each on
 * the field the previous ones leave. Throws the first refusal, before any write. */
async function prepareTerrainEdits(
  tx: Transaction<Database>,
  v: OwnedVillage,
  economy: VillageEconomy,
  gestures: readonly TerrainEditGesture[],
): Promise<Applied> {
  if (v.generationVersion !== 3)
    throw new HttpError(409, 'LEVELING_UNAVAILABLE', 'La terraformation est disponible sur les mondes RC1.');
  const ground = await readRc1Ground(tx, v.worldId);
  const source = await readRc1Source(tx, v.worldId);
  const geometry = ground.field.geometry;
  const applied: Applied = { vertices: new Map(), terraces: new Map(), sites: [], gestures: 0, unchanged: 0 };
  const heightAt = (x: number, y: number) =>
    applied.vertices.get(`${wrap(x, v.widthCells)}:${wrap(y, v.heightCells)}`)?.height ?? geometry!.height(x, y);
  const fieldWith = (vertices: Map<string, Vertex>, terraces: Map<string, Cell & { height: number }>) =>
    !vertices.size && !terraces.size
      ? ground.field
      : editedRc1Field(
          source.data,
          source.field,
          mergedTerraces(terraces),
          [],
          geometry ? mergedVertices(vertices) : undefined,
        );
  const mergedVertices = (vertices: Map<string, Vertex>) =>
    [...(ground.navigationEdits.vertices ?? []).filter((p) => !vertices.has(vertexKey(p))), ...vertices.values()].sort(
      (a, b) => a.vertexX - b.vertexX || a.vertexY - b.vertexY,
    );
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
  let field = ground.field;
  for (const [index, gesture] of gestures.entries()) {
    const refuse = (code: string, message: string) => new TerrainEditRefused(index, code, message);
    if (gesture.anchor.cellX >= v.widthCells || gesture.anchor.cellY >= v.heightCells)
      throw new HttpError(400, 'INVALID_COORDINATES', 'Coordonnées non canoniques.');
    const free = gesture.buildingType === 'terrain';
    let cells: Cell[];
    try {
      cells = free
        ? terraformCells({ ...gesture, quarterTurns: 0, workerCount: 1 }, v)
        : fixedBuildingFootprint(gesture.buildingType, gesture.anchor, gesture.quarterTurns, v);
    } catch {
      throw refuse('INVALID_TERRAFORM_SELECTION', 'Sélection ou hauteur invalide.');
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
      if (limit?.instanceLimitPerVillage != null && Number(limit.instances) >= limit.instanceLimitPerVillage)
        throw refuse('BUILDING_LIMIT_REACHED', 'Limite atteinte pour ce bâtiment.');
    }
    if (free && !geometry)
      throw refuse('LEVELING_UNAVAILABLE', 'Ce monde doit utiliser le terrain à sommets partagés.');
    try {
      await assertBuildableCells(tx, v, cells);
    } catch (error) {
      if (error instanceof HttpError) throw refuse(error.code, error.message);
      throw error;
    }
    // A gesture without effect is no refusal: nothing to write for it.
    if (
      !free &&
      isBuildingFootprintFlat(
        geometry
          ? footprintVertices(cells, v).map((p) => heightAt(p.vertexX, p.vertexY) * 100)
          : cells.map((c) => applied.terraces.get(key(c))?.height ?? ground.cell(c.cellX, c.cellY).elevation),
      )
    ) {
      applied.unchanged++;
      continue;
    }
    const plan = geometry ? vertexLeveling(cells, v, heightAt, 1, free ? gesture.height : undefined) : undefined;
    if (plan && plan.volume < 1e-9) {
      applied.unchanged++;
      continue;
    }
    const affectedCells = plan?.affectedCells ?? cells;
    if (plan)
      try {
        await assertBuildableCells(tx, v, affectedCells);
      } catch (error) {
        if (error instanceof HttpError) throw refuse(error.code, error.message);
        throw error;
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
    for (const c of cells)
      for (let y = 0; y <= 8; y++)
        for (let x = 0; x <= 8; x++) {
          const s = field.sample(c.cellX - 0.5 + x / 8, c.cellY - 0.5 + y / 8);
          if (height <= Math.max(0, s.surface) + 1e-6)
            throw refuse('LEVELING_WATER', 'Cette hauteur ferait entrer l’eau dans la sélection.');
        }
    const vertices = new Map(applied.vertices),
      terraces = new Map(applied.terraces);
    if (plan) for (const p of plan.vertices) vertices.set(vertexKey(p), p);
    else for (const c of cells) terraces.set(key(c), { ...c, height });
    const future = fieldWith(vertices, terraces);
    if (plan)
      for (const c of affectedCells)
        for (const p of footprintVertices([c], v)) {
          const s = future.sample(p.vertexX - 0.5, p.vertexY - 0.5);
          if (s.elevation <= Math.max(0, s.surface) + 1e-6)
            throw refuse('LEVELING_WATER', 'Le raccord du terrain ferait entrer l’eau.');
        }
    for (const f of foundations) {
      if (
        !cells.some(
          (p) =>
            Math.abs(spawnDelta(p.cellX, f.cellX, v.widthCells)) <= 1 &&
            Math.abs(spawnDelta(p.cellY, f.cellY, v.heightCells)) <= 1,
        )
      )
        continue;
      for (const dx of [-0.5, 0, 0.5])
        for (const dy of [-0.5, 0, 0.5])
          if (
            field.sample(f.cellX + dx, f.cellY + dy).elevation !== future.sample(f.cellX + dx, f.cellY + dy).elevation
          )
            throw refuse('LEVELING_FOUNDATION', 'Éloignez la retouche de la fondation voisine.');
    }
    applied.vertices = vertices;
    applied.terraces = terraces;
    field = future;
    applied.gestures++;
    if (!free)
      applied.sites.push({
        id: `terrain-edit-${index}`,
        buildingType: gesture.buildingType,
        anchor: gesture.anchor,
        quarterTurns: gesture.quarterTurns,
        cells,
      });
  }
  if (applied.gestures) await assertAccess(tx, v, economy, ground, source, applied, field);
  return applied;
}

/** No existing building loses its access, and a leveled footprint stays
 * reachable, on the final field. Command geometry only, never `state()`. */
async function assertAccess(
  tx: Transaction<Database>,
  v: OwnedVillage,
  economy: VillageEconomy,
  ground: Awaited<ReturnType<typeof readRc1Ground>>,
  source: Awaited<ReturnType<typeof readRc1Source>>,
  applied: Applied,
  finalField: Awaited<ReturnType<typeof readRc1Ground>>['field'],
) {
  const { snapshot } = await readInfrastructureSpatialState(tx, v, economy, undefined, false);
  const infrastructure = await readNavigationInfrastructure(tx, v);
  // Neighbours participate as physical obstacles, never as editable buildings.
  const foreign = await tx
    .selectFrom('worldCellOccupancies as o')
    .innerJoin('buildings as b', (j) => j.onRef('b.worldId', '=', 'o.worldId').onRef('b.id', '=', 'o.buildingId'))
    .select(['o.cellX', 'o.cellY', 'o.role', 'b.id', 'b.buildingType', 'b.visualLayout', 'b.quarterTurns'])
    .where('o.worldId', '=', v.worldId)
    .where('b.villageId', '!=', v.villageId)
    .execute();
  const foreignCells = foreign.filter(
    (c) =>
      wrap(c.cellX - snapshot.region.originCellX, v.widthCells) < snapshot.region.width &&
      wrap(c.cellY - snapshot.region.originCellY, v.heightCells) < snapshot.region.height,
  );
  const foreignKeys = new Set(foreignCells.map(key));
  const current = {
    ...snapshot,
    infrastructure,
    cells: [
      ...snapshot.cells.filter((c) => !foreignKeys.has(key(c))),
      ...foreignCells.map((c) => ({
        cellX: c.cellX,
        cellY: c.cellY,
        footprint: { buildingId: c.id },
        building:
          c.role === 'anchor'
            ? { id: c.id, type: c.buildingType, quarterTurns: c.quarterTurns, visualLayout: c.visualLayout }
            : null,
      })),
    ],
  } as unknown as VillageState;
  const sites = new Map<string, { id: string; anchor: boolean; type: string; quarterTurns: number }>();
  for (const site of applied.sites)
    for (const c of site.cells)
      sites.set(key(c), {
        id: site.id,
        anchor: c.cellX === site.anchor.cellX && c.cellY === site.anchor.cellY,
        type: site.buildingType,
        quarterTurns: site.quarterTurns,
      });
  const futureState = sites.size
    ? ({
        ...current,
        cells: [
          ...current.cells.filter((c) => !sites.has(key(c))),
          ...[...sites].map(([k, s]) => {
            const [cellX, cellY] = k.split(':').map(Number) as [number, number];
            return {
              cellX,
              cellY,
              footprint: { buildingId: s.id },
              building: s.anchor ? { id: s.id, type: s.type, quarterTurns: s.quarterTurns } : null,
            };
          }),
        ],
      } as unknown as VillageState)
    : current;
  const existing = buildTravelNetwork(current, [], ground.navigation)
    .filter((r) => r.kind === 'building')
    .map((r) => r.id);
  const future = rc1NetworkGround(
    source.data,
    source.field,
    {
      ...ground.navigationEdits,
      terraces: [...ground.terraces.filter((c) => !applied.terraces.has(key(c))), ...applied.terraces.values()].sort(
        (a, b) => a.cellX - b.cellX || a.cellY - b.cellY,
      ),
      ...(ground.field.geometry
        ? {
            vertices: [
              ...(ground.navigationEdits.vertices ?? []).filter((p) => !applied.vertices.has(vertexKey(p))),
              ...applied.vertices.values(),
            ].sort((a, b) => a.vertexX - b.vertexX || a.vertexY - b.vertexY),
          }
        : {}),
    },
    finalField,
  );
  const after = new Set(buildTravelNetwork(futureState, [], future).map((r) => r.id));
  if (existing.some((id) => !after.has(id)) || applied.sites.some((s) => !after.has(s.id)))
    throw new HttpError(409, 'LEVELING_ACCESS', 'Ces retouches couperaient l’accès d’un bâtiment.');
}

/** Test seam: runs after the height writes, before the receipt and the
 * publication (rollback proof); `afterLock` once the village is held. */
export const terrainEditsTestHooks: {
  afterLock?: () => Promise<void>;
  afterWrites?: (tx: Transaction<Database>) => Promise<void>;
} = {};

/** V2-native instant terrain edits: village lock (with the world's exclusive
 * navigation lock: heights change paths), bounded reads, refusal without
 * writes, height writes, receipt, then terminal publication. Idempotent by
 * `commandId`. */
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
  const cellCount = request.gestures.reduce((n, g) => n + (g.buildingType === 'terrain' ? g.cells.length : 9), 0);
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
    const economy = await beginVillageEconomy(tx, worldId, villageId, undefined, [], [], true);
    await terrainEditsTestHooks.afterLock?.();
    // A concurrent first attempt of the same identifier committed meanwhile.
    const raced = await replay(tx, village);
    if (raced) return raced;
    const applied = await prepareTerrainEdits(tx, village, economy, request.gestures);
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
      result,
      ...(effects ? { effects } : {}),
    };
  });
}
