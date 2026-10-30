import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Transaction } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import {
  editedRc1Field,
  fixedBuildingFootprint,
  footprintVertices,
  isBuildingFootprintFlat,
  withinBuildReach,
  infrastructurePlanSurface,
  infrastructureSidewalkSurface,
  subCellKey,
  pathPassageIntersectsBox,
  SPAWN_PEDESTRIAN_HALF_WIDTH,
  type BuildingType,
  type ConstructionConfirmation,
  type GeneratedLandscape,
  type InfrastructurePlan,
  type TravelCell,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { readRc1Source } from '../worlds/rc1-source.js';
import { rc1AbsentTrees, removedStumpsSql } from '../deposits/woodland.js';
import { villageSyncRevision } from './sync-revision.js';
import type { OwnedVillage } from './service.js';
import type { VillageEconomy } from './reconcile-economy.js';
import { normalizeCell, wrappedDelta, toroidalChebyshev } from '../worlds/coordinates.js';
import { normalizeSpatialSelection, type SpatialCell } from './spatial-selection.js';
import { observationVillage } from '../admin/observation-actions.js';
import { profileParts } from '../operations/dev-timing.js';

type Cost = { resourceCode: string; amount: number };
export interface BuildingPlacement {
  buildingType: BuildingType;
  anchor: SpatialCell;
  cells: SpatialCell[];
  commandId?: string | undefined;
  expectedCosts?: Cost[] | undefined;
  quarterTurns?: number;
  houseVariant?: 'stone' | 'logs' | 'beams';
  legacy?: boolean;
}
type Village = OwnedVillage & {
  terrainModel: 'terraces' | 'vertices';
  checksum: string | null;
  rowVersion: string | null;
};
const fail = (code: string, message: string): never => {
  throw new HttpError(409, code, message);
};
const canonicalCosts = (costs: Cost[] = []) =>
  costs
    .map((c) => ({ resourceCode: c.resourceCode, amount: c.amount }))
    .sort((a, b) => a.resourceCode.localeCompare(b.resourceCode));
const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;
const date = (value: unknown) =>
  value === null ? null : new Date(value instanceof Date ? value.getTime() : String(value)).toISOString();

/** The materialized village CTE takes the row before the world's spatial lock.
 * H and every mutable placement input are read in the NEXT statement, after waits. */
async function lockPlacement(tx: Transaction<Database>, accountId: string, slug: string, villageId: string) {
  const result = await sql<Village>`with owner as materialized (
    select v.id as village_id,v.world_id,v.name as village_name,v.anchor_cell_x,v.anchor_cell_y,
      w.slug as world_slug,w.name as world_name,w.topology,w.width_cells,w.height_cells,w.chunk_size,w.seed,w.generation_version,w.terrain_model
    from villages v join worlds w on w.id=v.world_id
    join world_memberships m on m.world_id=w.id and m.account_id=${accountId}::uuid
    where w.slug=${slug} and v.id=${villageId}::uuid and v.owner_account_id=${accountId}::uuid for update of v
  ) select owner.*,pg_advisory_xact_lock(hashtextextended('infrastructure:'||owner.world_id::text,0)),
    g.checksum,g.xmin::text||':'||g.ctid::text as row_version
    from owner left join world_generation_candidates g on g.world_id=owner.world_id`.execute(tx);
  const village = result.rows[0];
  if (!village) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable dans ce monde.');
  observationVillage(accountId, village.worldId, villageId);
  return village;
}

// Only immutable tree indices are cached. The edits/permissions are read anew.
const treeIndexes = new WeakMap<GeneratedLandscape, Map<string, number[]>>();
function localTrees(data: GeneratedLandscape, cells: SpatialCell[]) {
  let index = treeIndexes.get(data);
  if (!index) {
    index = new Map();
    for (const [i, t] of (data.forest?.trees ?? []).entries()) {
      const key = `${Math.floor(t.x)}:${Math.floor(t.y)}`,
        bucket = index.get(key) ?? [];
      bucket.push(i);
      index.set(key, bucket);
    }
    treeIndexes.set(data, index);
  }
  const found = new Set<number>();
  for (const c of cells)
    for (let y = c.cellY - 1; y <= c.cellY; y++)
      for (let x = c.cellX - 1; x <= c.cellX; x++)
        for (const i of index.get(`${normalizeCell(x, data.width)}:${normalizeCell(y, data.height)}`) ?? [])
          found.add(i);
  return [...found];
}

function near(
  cells: SpatialCell[],
  x: ReturnType<typeof sql.ref>,
  y: ReturnType<typeof sql.ref>,
  v: Village,
  radius: number | ReturnType<typeof sql.ref>,
) {
  // Exact cells and their immediate terrain halo can use the coordinate indexes;
  // wrapping/abs on the persisted columns would scan the world's occupancies.
  if (typeof radius === 'number' && radius <= 1) {
    const selected = new Map<string, SpatialCell>();
    for (const c of cells)
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const cell = {
            cellX: normalizeCell(c.cellX + dx, v.widthCells),
            cellY: normalizeCell(c.cellY + dy, v.heightCells),
          };
          selected.set(`${cell.cellX}:${cell.cellY}`, cell);
        }
    return sql<boolean>`(${x},${y}) in(select c."cellX",c."cellY" from jsonb_to_recordset(${json([...selected.values()])}) as c("cellX" int,"cellY" int))`;
  }
  return sql<boolean>`exists(select 1 from jsonb_to_recordset(${json(cells)}) as c("cellX" int,"cellY" int)
    where least(abs(${x}-c."cellX"),${v.widthCells}-abs(${x}-c."cellX"))<=${radius}
      and least(abs(${y}-c."cellY"),${v.heightCells}-abs(${y}-c."cellY"))<=${radius})`;
}

/** One round trip for the selected footprint, its spatial rights, price, receipt
 * and stocks. No economic transition, admission or village presentation reader. */
async function inputs(
  tx: Transaction<Database>,
  v: Village,
  p: BuildingPlacement,
  cells: SpatialCell[],
  treeIds: number[],
) {
  const wid = v.worldId,
    vid = v.villageId,
    chunkKeys = [
      ...new Map(
        cells.map((c) => {
          const chunkX = Math.floor(c.cellX / v.chunkSize),
            chunkY = Math.floor(c.cellY / v.chunkSize);
          return [`${chunkX}:${chunkY}`, { chunkX, chunkY }];
        }),
      ).values(),
    ];
  const receipt = tx
    .selectFrom('buildingCommandReceipts')
    .selectAll()
    .where('worldId', '=', wid)
    .where('villageId', '=', vid)
    .where('commandId', '=', p.commandId!);
  const wrap = (delta: ReturnType<typeof sql>, size: number) =>
    sql`case when ${delta}>${size / 2} then ${delta}-${size} when ${delta}<${-size / 2} then ${delta}+${size} else ${delta} end`;
  const margin = 0.5 + SPAWN_PEDESTRIAN_HALF_WIDTH + 1e-9;
  // Return only segments whose toroidal bounds touch the footprint. Sparse legacy
  // paths are swept too; checking vertices alone would let a building cut a trip.
  const paths = sql<Array<TravelCell[]>>`coalesce((select jsonb_agg(jsonb_build_array(a,b)) from (
    select path_cells as path from deposit_extractions where world_id=${wid}::uuid and status='in-progress'
    union all select path_cells from garden_harvests where world_id=${wid}::uuid and status='in-progress'
    union all select return_path_cells from garden_harvests where world_id=${wid}::uuid and status='in-progress'
    union all select s->'path' from garden_harvests, jsonb_array_elements(stops) s where world_id=${wid}::uuid and status='in-progress'
    union all select path_cells from science_activities where world_id=${wid}::uuid and status='in-progress'
    union all select path from trade_journeys where world_id=${wid}::uuid and returns_at>statement_timestamp()
    union all select path from leveling_jobs where world_id=${wid}::uuid and completed_at is null
  ) paths cross join lateral (
    -- Coordinates read once per point; the footprint is a constant VALUES list
    -- (not JSON parsed again for each of the world's path segments).
    select coalesce(lag(point) over(order by ord),point) as a,point as b,
      coalesce(lag((point->>'cellX')::float8) over(order by ord),(point->>'cellX')::float8) as x0,
      coalesce(lag((point->>'cellY')::float8) over(order by ord),(point->>'cellY')::float8) as y0,
      (point->>'cellX')::float8 as x1,(point->>'cellY')::float8 as y1
    from jsonb_array_elements(path) with ordinality p(point,ord)
  ) segments cross join lateral (select ${wrap(sql`x1-x0`, v.widthCells)} as dx,${wrap(sql`y1-y0`, v.heightCells)} as dy) m
  where exists(select 1 from (values ${sql.join(cells.map((c) => sql`(${c.cellX}::float8,${c.cellY}::float8)`))}) c(x,y)
    cross join lateral(select ${wrap(sql`x0-c.x`, v.widthCells)} as ax,${wrap(sql`y0-c.y`, v.heightCells)} as ay) d
    where least(ax,ax+dx)<=${margin} and greatest(ax,ax+dx)>=${-margin}
      and least(ay,ay+dy)<=${margin} and greatest(ay,ay+dy)>=${-margin}
  )),'[]'::jsonb)`;
  const fields = [
    sql<Date>`statement_timestamp()`.as('through'),
    jsonObjectFrom(receipt).as('receipt'),
    jsonObjectFrom(
      tx
        .selectFrom('buildingTypes as t')
        .innerJoin('buildingTypeLevels as l', 'l.buildingTypeCode', 't.code')
        .select([
          't.code',
          't.buildable',
          't.productionMode',
          't.instanceLimitPerVillage',
          'l.constructionDurationSeconds',
        ])
        .where('t.code', '=', p.buildingType)
        .where('l.level', '=', 1),
    ).as('definition'),
    jsonArrayFrom(
      tx
        .selectFrom('buildingLevelCosts')
        .select(['resourceCode', 'amount'])
        .where('buildingTypeCode', '=', p.buildingType)
        .where('level', '=', 1),
    ).as('costs'),
    jsonArrayFrom(
      tx
        .selectFrom('buildingVariantCosts')
        .select(['resourceCode', 'amount', 'replacesResourceCode'])
        .where('buildingTypeCode', '=', p.buildingType)
        .where('level', '=', 1)
        .where('variant', '=', p.houseVariant ?? 'stone'),
    ).as('variants'),
    jsonArrayFrom(
      tx
        .selectFrom('buildingLevelProduction')
        .select(['resourceCode', 'capacity'])
        .where('buildingTypeCode', '=', p.buildingType)
        .where('level', '=', 1),
    ).as('production'),
    tx
      .selectFrom('buildings')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('worldId', '=', wid)
      .where('villageId', '=', vid)
      .where('buildingType', '=', p.buildingType)
      .as('instances'),
    jsonArrayFrom(
      tx
        .selectFrom('worldCellOccupancies')
        .select(['cellX', 'cellY'])
        .where('worldId', '=', wid)
        .where(near(cells, sql.ref('cellX'), sql.ref('cellY'), v, 0)),
    ).as('occupied'),
    jsonArrayFrom(
      tx
        .selectFrom('worldCellOccupancies as o')
        .innerJoin('buildings as b', (j) => j.onRef('b.worldId', '=', 'o.worldId').onRef('b.id', '=', 'o.buildingId'))
        .select(['o.cellX', 'o.cellY'])
        .where('o.worldId', '=', wid)
        .where('b.villageId', '=', vid)
        .where('o.pendingExpansionId', 'is', null)
        .where((eb) =>
          eb.or([
            eb('b.status', '=', 'completed'),
            eb.and([eb('b.buildingType', '=', 'town-hall'), eb('b.targetLevel', 'is not', null)]),
          ]),
        )
        .where(near(cells, sql.ref('o.cellX'), sql.ref('o.cellY'), v, 8)),
    ).as('reach'),
    jsonArrayFrom(
      tx
        .selectFrom('worldClearings')
        .select(['centerCellX', 'centerCellY', 'innerRadius'])
        .where('worldId', '=', wid)
        .where('status', '=', 'protected')
        .where(near(cells, sql.ref('centerCellX'), sql.ref('centerCellY'), v, sql.ref('innerRadius'))),
    ).as('clearings'),
    jsonArrayFrom(
      tx.selectFrom('levelingJobs').select('quote').where('worldId', '=', wid).where('completedAt', 'is', null)
        .where(sql<boolean>`exists(select 1 from jsonb_to_recordset(quote->'cells') q("cellX" int,"cellY" int)
        where ${near(cells, sql.raw('q."cellX"'), sql.raw('q."cellY"'), v, 1)})`),
    ).as('leveling'),
    jsonArrayFrom(
      tx
        .selectFrom('villageInfrastructure as i')
        .innerJoin('villages as n', (j) => j.onRef('n.id', '=', 'i.villageId').onRef('n.worldId', '=', 'i.worldId'))
        .select('i.plan')
        .where('i.worldId', '=', wid)
        .where(near(cells, sql.ref('n.anchorCellX'), sql.ref('n.anchorCellY'), v, 34)),
    ).as('plans'),
    // Road cells of any village on the footprint (073), under the same lock.
    jsonArrayFrom(
      tx
        .selectFrom('roadCells')
        .select(['cellX', 'cellY'])
        .where('worldId', '=', wid)
        .where(
          sql<boolean>`(cell_x,cell_y) in (select * from unnest(${cells.map((c) => c.cellX)}::int[],${cells.map((c) => c.cellY)}::int[]))`,
        ),
    ).as('roadCells'),
    paths.as('paths'),
    jsonArrayFrom(
      tx
        .selectFrom('worldChunks')
        .select(['chunkX', 'chunkY', 'terrainCodes', 'elevations'])
        .where('worldId', '=', wid)
        .where((eb) =>
          v.generationVersion === 3
            ? sql<boolean>`false`
            : eb.or(chunkKeys.map((c) => eb.and([eb('chunkX', '=', c.chunkX), eb('chunkY', '=', c.chunkY)]))),
        ),
    ).as('chunks'),
    jsonArrayFrom(
      tx
        .selectFrom('worldSpawnTerraces')
        .select(['cellX', 'cellY', 'height'])
        .where('worldId', '=', wid)
        .where(near(cells, sql.ref('cellX'), sql.ref('cellY'), v, 1))
        .orderBy('cellX')
        .orderBy('cellY'),
    ).as('terraces'),
    jsonArrayFrom(
      tx
        .selectFrom('worldTerrainVertices')
        .select(['vertexX', 'vertexY', 'height'])
        .where('worldId', '=', wid)
        .where(near(cells, sql.ref('vertexX'), sql.ref('vertexY'), v, 1)),
    ).as('vertices'),
    jsonArrayFrom(
      tx
        .selectFrom('worldRc1Resources as r')
        .leftJoin('woodlandDeposits as d', (j) =>
          j.onRef('d.worldId', '=', 'r.worldId').onRef('d.featureId', '=', 'r.featureId'),
        )
        .select(['r.treeIndices', 'r.removedIndices', 'd.cleared', removedStumpsSql('r').as('stumps')])
        .where('r.worldId', '=', wid)
        .where(
          treeIds.length
            ? sql<boolean>`exists(select 1 from jsonb_array_elements_text(r.tree_indices) t(i) where t.i::int=any(${sql.val(treeIds)}::integer[]))`
            : sql<boolean>`false`,
        ),
    ).as('trees'),
    sql<Stock[]>`(select coalesce(jsonb_agg(s),'[]') from (
      select r.resource_code as code,t.display_name,t.icon_key,r.amount::text as stored,
        (r.amount+floor(coalesce(f.remainder,0)+p.rate*coalesce(extract(epoch from (greatest(statement_timestamp(),f.production_updated_at)-f.production_updated_at)),0)/3600))::text as amount,
        p.rate::text as production_per_hour,case when f.production_updated_at is not null then greatest(statement_timestamp(),f.production_updated_at) end as production_updated_at,
        mod(coalesce(f.remainder,0)+p.rate*coalesce(extract(epoch from (greatest(statement_timestamp(),f.production_updated_at)-f.production_updated_at)),0)/3600,1)::text as remainder
      from village_resources r join resource_types t on t.code=r.resource_code join villages v on v.id=r.village_id and v.world_id=r.world_id
      left join village_resource_flows f on f.world_id=r.world_id and f.village_id=r.village_id and f.resource_code=r.resource_code
      cross join lateral (select case when f.production_updated_at is null or (r.resource_code='wood' and v.economy_activated_at is not null) then 0
        else f.base_rate_per_hour+coalesce((select sum(bp.rate_per_hour) from buildings b join building_level_production bp on bp.building_type_code=b.building_type and bp.level=b.level and bp.resource_code=r.resource_code
          where b.world_id=r.world_id and b.village_id=r.village_id and (b.status='completed' or b.target_level is not null)),0) end as rate) p
      where r.world_id=${wid}::uuid and r.village_id=${vid}::uuid order by r.resource_code
    ) s)`.as('stocks'),
    jsonArrayFrom(
      tx
        .selectFrom('worldCellOccupancies as o')
        .innerJoin('buildings as b', (j) => j.onRef('b.worldId', '=', 'o.worldId').onRef('b.id', '=', 'o.buildingId'))
        .innerJoin('buildingCommandReceipts as r', (j) =>
          j.onRef('r.worldId', '=', 'b.worldId').onRef('r.buildingId', '=', 'b.id'),
        )
        .select([
          'o.cellX',
          'o.cellY',
          'o.role',
          'b.id',
          'b.buildingType',
          'b.level',
          'b.targetLevel',
          'b.status',
          'b.constructionStartedAt',
          'b.constructionCompletesAt',
          'b.completedAt',
          'b.quarterTurns',
          'b.visualLayout',
        ])
        .where('r.worldId', '=', wid)
        .where('r.villageId', '=', vid)
        .where('b.villageId', '=', vid)
        .where('r.commandId', '=', p.commandId!)
        .where(near(cells, sql.ref('o.cellX'), sql.ref('o.cellY'), v, 0)),
    ).as('replay'),
  ] as const;
  // Opted-in diagnostics only: time each part of this one-round-trip read.
  await profileParts(
    fields.map((field) => [partName(field), () => tx.selectNoFrom([field] as never).execute()] as const),
  );
  return tx.selectNoFrom(fields).executeTakeFirstOrThrow();
}
const partName = (field: { toOperationNode(): unknown }) =>
  String((field.toOperationNode() as { alias?: { name?: string } }).alias?.name ?? '?');
interface Stock {
  code: string;
  displayName: string;
  iconKey: string;
  stored: string;
  amount: string;
  productionPerHour: string;
  productionUpdatedAt: string | null;
  remainder: string | null;
}
type Inputs = Awaited<ReturnType<typeof inputs>>;

function validateSpace(
  v: Village,
  cells: SpatialCell[],
  data: Inputs,
  source: Awaited<ReturnType<typeof readRc1Source>> | undefined,
  treeIds: number[],
  type: BuildingType,
) {
  if (data.occupied.length) fail('CELL_OCCUPIED', 'Cette case est déjà occupée.');
  if (
    data.leveling.some((j) =>
      j.quote.cells.some((p) =>
        cells.some((c) => toroidalChebyshev(c.cellX, c.cellY, p.cellX, p.cellY, v.widthCells, v.heightCells) <= 1),
      ),
    )
  )
    fail('LEVELING_NEARBY', 'Attendez la fin du nivellement avant de construire sur cette emprise ou contre son bord.');
  const wanted = new Set(cells.map((c) => `${c.cellX}:${c.cellY}`));
  if (data.roadCells.length) fail('INFRASTRUCTURE_OCCUPIED', 'Retirez la route de cette case avant de construire.');
  for (const { plan } of data.plans) validatePlan(plan, wanted, v);
  if (data.paths.some((path) => cells.some((c) => pathPassageIntersectsBox(path, c, 0.5, 0.5, v))))
    fail('ENGAGED_PASSAGE', 'Une équipe utilise encore cette emprise.');
  // A trunk stands until its stump is removed or its case cleared; the case
  // itself stays occupied until cleared (docs/SPEC-BOIS-ARBRE-UNITE.md).
  const removed = new Set(data.trees.flatMap(rc1AbsentTrees));
  const field = source
    ? editedRc1Field(
        {
          ...source.data,
          forest: {
            ...source.data.forest!,
            trees: treeIds.filter((i) => !removed.has(i)).map((i) => source.data.forest!.trees[i]!),
          },
        },
        source.field,
        data.terraces,
        [],
        v.terrainModel === 'vertices' ? data.vertices : undefined,
      )
    : undefined;
  const heights: number[] = [];
  for (const c of cells) {
    if (!withinBuildReach(c, data.reach, v))
      fail('OUTSIDE_VILLAGE_REACH', 'Cette case est trop éloignée de votre village.');
    if (
      data.clearings.some(
        (r) =>
          toroidalChebyshev(c.cellX, c.cellY, r.centerCellX, r.centerCellY, v.widthCells, v.heightCells) <=
          r.innerRadius,
      )
    )
      fail('CLEARING_PROTECTED', 'Cette clairière est protégée.');
    if (field) {
      const s = { x: c.cellX, y: c.cellY, halfWidth: 0.5, halfHeight: 0.5 };
      if (field.surfaceReason(s, null, 0.125) || field.intersectsTree(s))
        fail('TERRAIN_NOT_BUILDABLE', 'Cette emprise rencontre un obstacle naturel.');
      heights.push(Math.round(field.physicalSample(c.cellX, c.cellY).elevation * 100));
    } else {
      const chunk = data.chunks.find(
        (r) => r.chunkX === Math.floor(c.cellX / v.chunkSize) && r.chunkY === Math.floor(c.cellY / v.chunkSize),
      );
      if (!chunk) fail('WORLD_NOT_READY', 'Le terrain de ce monde est en préparation.');
      const index = (c.cellY % v.chunkSize) * v.chunkSize + (c.cellX % v.chunkSize);
      if (chunk!.terrainCodes[index] !== 1)
        fail('TERRAIN_NOT_BUILDABLE', 'Cette emprise rencontre un obstacle naturel.');
      heights.push(chunk!.elevations[index]!);
    }
  }
  const foundation = field?.geometry
    ? footprintVertices(cells, v).map((p) => field.geometry!.height(p.vertexX, p.vertexY) * 100)
    : heights;
  if (
    type !== 'garden' &&
    (field?.geometry || type === 'university' || type === 'stonemason') &&
    !isBuildingFootprintFlat(foundation)
  )
    fail('UNEVEN_TERRAIN', 'Préparez une emprise plane avant de construire.');
}
function validatePlan(plan: InfrastructurePlan, wanted: Set<string>, v: Village) {
  const surface = infrastructurePlanSurface(plan, v),
    sidewalk = infrastructureSidewalkSurface(surface, v);
  if (
    plan.equipment.some((e) => wanted.has(subCellKey(e, v))) ||
    [...surface.values()].some(
      (p) =>
        p.manual &&
        wanted.has(`${Math.floor((p.x + 8) / 16) % v.widthCells}:${Math.floor((p.y + 8) / 16) % v.heightCells}`),
    ) ||
    [...sidewalk.values()].some((p) =>
      wanted.has(`${Math.floor((p.x + 8) / 16) % v.widthCells}:${Math.floor((p.y + 8) / 16) % v.heightCells}`),
    )
  )
    fail('INFRASTRUCTURE_OCCUPIED', 'Déplacez la voie ou l’équipement avant de construire.');
}

/** A placement only debits, reserves and schedules its own construction. */
/** `afterWrites` runs in the transaction after a new placement (never on a
 * replay): the V2 path publishes its journal and reads its effects there. */
export async function placeBuilding(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  input: BuildingPlacement,
  durationOverride: number | null,
  afterWrites?: (tx: Transaction<Database>, economy: VillageEconomy) => Promise<void>,
): Promise<ConstructionConfirmation> {
  const p = {
    ...input,
    commandId: input.commandId ?? randomUUID(),
    quarterTurns: input.quarterTurns ?? 0,
    houseVariant: input.houseVariant ?? 'stone',
  };
  const confirmed = await db.transaction().execute(async (tx) => {
    const v = await lockPlacement(tx, accountId, slug, villageId);
    const selection = normalizeSpatialSelection(p.anchor, p.cells, v.widthCells, v.heightCells),
      cells = selection.cells;
    const request = {
      ...(p.houseVariant !== 'stone' ? { houseVariant: p.houseVariant } : {}),
      quarterTurns: p.quarterTurns,
      buildingType: p.buildingType,
      ...(p.legacy
        ? { cellX: selection.anchor.cellX, cellY: selection.anchor.cellY }
        : { anchor: selection.anchor, cells }),
      expectedCosts: canonicalCosts(p.expectedCosts),
    };
    const source =
      v.generationVersion === 3
        ? await readRc1Source(tx, v.worldId, {
            world: v,
            identity: v.rowVersion ? { checksum: v.checksum, rowVersion: v.rowVersion } : null,
          })
        : undefined;
    const treeIds = source ? localTrees(source.data, cells) : [],
      data = await inputs(tx, v, p, cells, treeIds),
      at = data.through;
    let rows: Inputs['replay'];
    if (data.receipt) {
      const comparable = (value: unknown) =>
        value && typeof value === 'object' ? { quarterTurns: 0, ...value } : value;
      if (data.receipt.commandType !== 'construct' || !isDeepStrictEqual(comparable(data.receipt.request), request))
        fail('COMMAND_ID_CONFLICT', 'Cette intention de construction a déjà été utilisée différemment.');
      // A completed garden may now belong to a fused logical component. Its
      // canonical identity/plots belong to SSE; never resurrect its old anchor.
      rows = data.replay.filter((c) => c.buildingType !== 'garden' || c.status !== 'completed');
    } else {
      const item = data.definition;
      if (!item) fail('BUILDING_LEVEL_UNKNOWN', 'Ce niveau de bâtiment n’existe pas.');
      if (!item!.buildable) fail('BUILDING_NOT_BUILDABLE', 'Ce bâtiment ne peut pas être construit directement.');
      if (item!.instanceLimitPerVillage !== null && Number(data.instances) >= item!.instanceLimitPerVillage)
        fail('BUILDING_LIMIT_REACHED', 'Limite atteinte pour ce bâtiment.');
      if (p.buildingType === 'university' || p.buildingType === 'stonemason') {
        const expected = new Set(
          fixedBuildingFootprint(p.buildingType, selection.anchor, p.quarterTurns, v).map(
            (c) => `${c.cellX}:${c.cellY}`,
          ),
        );
        if (cells.length !== expected.size || cells.some((c) => !expected.has(`${c.cellX}:${c.cellY}`)))
          fail('INVALID_BUILDING_FOOTPRINT', 'Emprise de bâtiment invalide.');
      } else if (p.buildingType !== 'garden' && cells.length !== 1)
        fail('INVALID_BUILDING_FOOTPRINT', 'Ce bâtiment occupe exactement une case.');
      validateSpace(v, cells, data, source, treeIds, p.buildingType);
      const costs = new Map(data.costs.map((c) => [c.resourceCode, Number(c.amount)]));
      for (const c of data.variants) {
        if (c.replacesResourceCode) costs.delete(c.replacesResourceCode);
        costs.set(c.resourceCode, (costs.get(c.resourceCode) ?? 0) + Number(c.amount));
      }
      if (p.buildingType === 'garden') for (const [code, amount] of costs) costs.set(code, amount * cells.length);
      if (
        p.expectedCosts?.length &&
        [...costs].some(
          ([code, amount]) => amount > (p.expectedCosts!.find((c) => c.resourceCode === code)?.amount ?? -1),
        )
      )
        fail('BUILDING_COST_CHANGED', 'Le coût a changé. Vérifiez la palette avant de recommencer.');
      const paid = [...costs].map(([code, amount]) => {
        const stock = data.stocks.find((r) => r.code === code);
        if (!stock || !Number.isSafeInteger(Number(stock.amount)) || Number(stock.amount) < amount)
          fail('INSUFFICIENT_RESOURCES', 'Ressources insuffisantes.');
        return {
          code,
          amount: Number(stock!.amount) - amount,
          stored: stock!.stored,
          remainder: stock!.remainder,
          through: stock!.productionUpdatedAt,
        };
      });
      const id = randomUUID(),
        completesAt = new Date(at.getTime() + (durationOverride ?? item!.constructionDurationSeconds * 1000));
      const visualLayout =
        p.buildingType === 'dwelling'
          ? {
              recipe:
                p.houseVariant === 'logs' ? 'log-house' : p.houseVariant === 'beams' ? 'beam-house' : 'stone-house',
              version: 1,
              quarterTurns: p.quarterTurns,
              entranceFace: '-z',
              offset: [0, 0],
            }
          : null;
      const written = await sql<{ reserved: number; debited: number }>`with
        paid as (update village_resources r set amount=p.amount from jsonb_to_recordset(${json(paid)}) p(code text,amount bigint,stored bigint)
          where r.world_id=${v.worldId}::uuid and r.village_id=${villageId}::uuid and r.resource_code=p.code and r.amount=p.stored returning r.resource_code),
        flows as (update village_resource_flows f set remainder=p.remainder,production_updated_at=p.through
          from jsonb_to_recordset(${json(paid)}) p(code text,remainder numeric,through timestamptz)
          where f.world_id=${v.worldId}::uuid and f.village_id=${villageId}::uuid and f.resource_code=p.code and p.through is not null returning f.resource_code),
        building as (insert into buildings(id,world_id,village_id,building_type,level,target_level,status,construction_started_at,construction_completes_at,completed_at,quarter_turns,visual_layout)
          values(${id}::uuid,${v.worldId}::uuid,${villageId}::uuid,${p.buildingType},1,null,'under-construction',${at},${completesAt},null,${p.quarterTurns},${visualLayout === null ? sql`null` : json(visualLayout)}) returning id),
        reserved as (insert into world_cell_occupancies(world_id,building_id,cell_x,cell_y,role)
          select ${v.worldId}::uuid,b.id,c."cellX",c."cellY",case when c."cellX"=${selection.anchor.cellX} and c."cellY"=${selection.anchor.cellY} then 'anchor' else 'extension' end
          from building b,jsonb_to_recordset(${json(cells)}) c("cellX" int,"cellY" int) order by c."cellX",c."cellY"
          on conflict(world_id,cell_x,cell_y) do nothing returning cell_x,cell_y),
        locked_woods as materialized (select feature_id from woodland_deposits d where world_id=${v.worldId}::uuid and not cleared
          and exists(select 1 from reserved r where r.cell_x=d.cell_x and r.cell_y=d.cell_y) order by feature_id for update),
        woods as (update woodland_deposits d set cleared=true,remaining_amount=reserved_amount,revision=revision+1,updated_at=${at}
          where d.world_id=${v.worldId}::uuid and d.feature_id in(select feature_id from locked_woods) returning d.feature_id),
        task as (insert into scheduled_tasks(world_id,task_type,subject_id,payload,due_at,available_at,last_error,completed_at)
          select ${v.worldId}::uuid,'building.complete',id,'{}'::jsonb,${completesAt},${completesAt},null,null from building returning id),
        buffers as (insert into building_resource_buffers(world_id,village_id,building_id,resource_code,stored_amount,remainder,production_updated_at)
          select ${v.worldId}::uuid,${villageId}::uuid,b.id,p.code,0,0,${completesAt} from building b,
          jsonb_to_recordset(${json(item!.productionMode === 'buffered' ? data.production.map((r) => ({ code: r.resourceCode })) : [])}) p(code text) returning building_id),
        receipt as (insert into building_command_receipts(world_id,village_id,command_id,command_type,request,building_id)
          select ${v.worldId}::uuid,${villageId}::uuid,${p.commandId}::uuid,'construct',${json(request)},id from building returning building_id)
        select (select count(*)::int from reserved) as reserved,(select count(*)::int from paid) as debited`.execute(
        tx,
      );
      if (written.rows[0]!.reserved !== cells.length) fail('CELL_OCCUPIED', 'Une case vient d’être réservée.');
      if (written.rows[0]!.debited !== paid.length) fail('INSUFFICIENT_RESOURCES', 'Les ressources ont changé.');
      for (const s of data.stocks) {
        const debit = paid.find((p) => p.code === s.code);
        if (debit) s.amount = String(debit.amount);
      }
      rows = cells.map((c) => ({
        ...c,
        id,
        buildingType: p.buildingType,
        level: 1,
        targetLevel: null,
        status: 'under-construction' as const,
        constructionStartedAt: at.toISOString(),
        constructionCompletesAt: completesAt.toISOString(),
        completedAt: null,
        quarterTurns: p.quarterTurns,
        visualLayout: visualLayout as Inputs['replay'][number]['visualLayout'],
        role: c.cellX === selection.anchor.cellX && c.cellY === selection.anchor.cellY ? 'anchor' : 'extension',
      }));
      if (afterWrites) await afterWrites(tx, { worldId: v.worldId, villageId, through: at });
    }
    return {
      kind: 'construction' as const,
      cellsMode: 'patch' as const,
      worldId: v.worldId,
      villageId,
      commandId: p.commandId,
      commandTime: date(data.receipt?.createdAt ?? at)!,
      serverTime: at.toISOString(),
      resources: data.stocks.map((s) => ({
        code: s.code,
        displayName: s.displayName,
        iconKey: s.iconKey,
        amount: Number(s.amount),
        productionPerHour: Number(s.productionPerHour),
        productionUpdatedAt: date(s.productionUpdatedAt),
      })),
      cells: rows.map((c) => ({
        id: `${c.cellX}:${c.cellY}`,
        cellX: c.cellX,
        cellY: c.cellY,
        x: wrappedDelta(c.cellX, v.anchorCellX, v.widthCells) * 2.5,
        z: wrappedDelta(c.cellY, v.anchorCellY, v.heightCells) * 2.5,
        building:
          c.role === 'anchor'
            ? {
                id: c.id,
                type: c.buildingType as BuildingType,
                level: c.level,
                targetLevel: c.targetLevel,
                status: c.status,
                constructionStartedAt: date(c.constructionStartedAt),
                constructionCompletesAt: date(c.constructionCompletesAt),
                completedAt: date(c.completedAt),
                quarterTurns: c.quarterTurns,
                visualLayout: c.visualLayout,
                hiddenSuppliesAvailable: false,
                garden: null,
              }
            : null,
        footprint: {
          buildingId: c.id,
          buildingType: c.buildingType as BuildingType,
          role: c.role as 'anchor' | 'extension',
          state: c.status === 'completed' || c.targetLevel !== null ? ('active' as const) : ('reserved' as const),
        },
        canBuild: false,
      })),
    };
  });
  // V2 callers order by their journal, not by this V1 fence (a world count).
  if (afterWrites) return { ...confirmed, minimumRevision: 0 };
  // Fence after COMMIT: an old coherent SSE projection cannot cover this receipt.
  return { ...confirmed, minimumRevision: (await villageSyncRevision(db, confirmed.worldId)).revision };
}
