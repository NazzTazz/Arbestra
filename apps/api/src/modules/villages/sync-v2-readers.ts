import { sql, type RawBuilder, type Transaction } from 'kysely';
import {
  SYNC_V2_COMPONENT_LIMITS,
  SYNC_V2_PRIVATE_COMPONENTS,
  SYNC_V2_SNAPSHOT_PAGE_REFERENCES,
  type SyncV2Change,
  type SyncV2Contribution,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { projectVillageResources, projectGardenPlots } from './economy.js';
import { readProcessingOrders } from './processing.js';
import { readCohortProjection, readPopulationProjection } from '../population/projection.js';
import { housingCapacity, HOUSING_BUILDING_TYPES } from '../population/housing.js';
import type { VillageEconomy } from './reconcile-economy.js';
import { readExtractionPools } from '../deposits/extraction-pools.js';
import { readExtractions } from '../deposits/stone-extractions.js';
import { readWorksites } from '../deposits/worksites.js';
import { readExploitationOrders } from './exploitation-budget.js';
import { levelingSnapshot } from './leveling.js';
import { ownTradeOffers, readPrivateTradeJourneys } from './trade-economy.js';

export interface SyncEntityReference {
  component: string;
  key: string;
}
export const privateReaderComponents = new Set<SyncV2Change['component']>([
  'resources',
  'processingOrders',
  'cohorts',
  'populationSummary',
  'restHousing',
  'buildings',
  'accomplishments',
  'extractionPools',
  'gardenPlots',
  'gardenHarvests',
  'buildingExpansions',
  'extractions',
  'worksites',
  'exploitationOrders',
  'levelingJobs',
  'marketExchanges',
  'tradeOffers',
  'tradeJourneys',
  'scienceActivities',
  'scienceContributions',
  'identity',
  'infrastructure',
  'installation',
  'roadCells',
]);

/** Enumeration is reserved for an explicit scope snapshot. Ordinary deltas
 * receive their keys from the durable journal and never enter this path.
 * Each query yields (component, key) rows; the six singleton references are
 * listed apart (singletonReferences). */
function privateReferenceQueries(context: VillageEconomy): RawBuilder<SyncEntityReference>[] {
  const { worldId, villageId } = context;
  const sources = [
    ['resources', 'village_resources', 'resource_code'],
    ['cohorts', 'population_cohorts', 'id'],
    ['buildings', 'buildings', 'id'],
    ['accomplishments', 'village_accomplishments', 'code'],
    ['scienceContributions', 'science_contributions', 'building_id'],
  ] as const;
  const queries = sources.map(
    ([component, table, column]) => sql<SyncEntityReference>`
    select ${sql.lit(component)}::text as component, ${sql.id(column)}::text as key from ${sql.id(table)}
    where world_id=${worldId} and village_id=${villageId}`,
  );
  // Only running entries, plus the recent history the historical read showed:
  // finished rows (thousands in an old village) would push a component past
  // its bound in the client schema, and the snapshot past its own.
  const running = (component: string, table: string, condition: RawBuilder<unknown>) =>
    sql<SyncEntityReference>`select ${sql.lit(component)}::text as component,id::text as key from ${sql.id(table)}
    where world_id=${worldId} and village_id=${villageId} and ${condition}`;
  const recent = (component: string, table: string, open: RawBuilder<unknown>, order: string, limit: number) =>
    sql<SyncEntityReference>`select ${sql.lit(component)}::text as component,id::text as key from ${sql.id(table)}
    where world_id=${worldId} and village_id=${villageId} and (${open} or id in (select id from ${sql.id(table)}
      where world_id=${worldId} and village_id=${villageId} order by ${sql.id(order)} desc limit ${sql.lit(limit)}))`;
  // Only buildings the restHousing reader turns into a row: housing types that
  // are built or being upgraded. Others never carry a value, and one that
  // becomes housing is touched by the buildings trigger (migration 053).
  queries.push(
    running(
      'restHousing',
      'buildings',
      sql`building_type in (${sql.join(HOUSING_BUILDING_TYPES)}) and (status='completed' or target_level is not null)`,
    ),
    running('gardenHarvests', 'garden_harvests', sql`status='in-progress'`),
    running('extractions', 'deposit_extractions', sql`status='in-progress'`),
    running('buildingExpansions', 'building_expansions', sql`status='under-construction'`),
    running('levelingJobs', 'leveling_jobs', sql`completed_at is null`),
    running('tradeOffers', 'trade_offers', sql`status='open'`),
    running('scienceActivities', 'science_activities', sql`status='in-progress'`),
    recent('processingOrders', 'processing_orders', sql`status not in ('completed','cancelled')`, 'created_at', 20),
    recent('marketExchanges', 'market_exchanges', sql`completed_at is null`, 'started_at', 20),
    recent('worksites', 'extraction_worksites', sql`status in ('running','paused','stopping')`, 'created_at', 32),
  );
  // Orders still open or with workers out (the status readExploitationOrders
  // derives), plus the 32 recent ones the historical read showed: Catmark held
  // 1222 completed orders, past the component bound of the client schema.
  queries.push(sql<SyncEntityReference>`select 'exploitationOrders'::text as component,o.id::text as key
    from exploitation_orders o
    where o.world_id=${worldId} and o.village_id=${villageId} and (o.garden_status='pending'
      or o.id in (select id from exploitation_orders where world_id=${worldId} and village_id=${villageId}
        order by confirmed_at desc limit 32)
      or exists (select 1 from extraction_worksites w where w.world_id=o.world_id and w.village_id=o.village_id
        and w.exploitation_order_id=o.id and w.status in ('running','paused'))
      or exists (select 1 from garden_harvests h where h.world_id=o.world_id and h.village_id=o.village_id
        and h.exploitation_order_id=o.id and h.status='in-progress')
      or exists (select 1 from deposit_extractions d join extraction_worksites w on w.id=d.worksite_id
        and w.world_id=d.world_id and w.village_id=d.village_id where d.world_id=o.world_id
        and d.village_id=o.village_id and w.exploitation_order_id=o.id and d.status='in-progress'))`);
  queries.push(sql<SyncEntityReference>`select 'gardenPlots'::text as component,cell_x::text||','||cell_y::text as key
    from garden_plots where world_id=${worldId} and village_id=${villageId}`);
  queries.push(sql<SyncEntityReference>`select 'roadCells'::text as component,cell_x::text||','||cell_y::text as key
    from road_cells where world_id=${worldId} and village_id=${villageId}`);
  queries.push(sql<SyncEntityReference>`select 'tradeJourneys'::text as component,id::text as key from trade_journeys
    where world_id=${worldId} and (village_id=${villageId} or destination_village_id=${villageId})
    and returns_at > ${context.through}`);
  return queries;
}
const singletonReferences = (villageId: string): SyncEntityReference[] => [
  { component: 'identity', key: villageId },
  { component: 'populationSummary', key: '*' },
  { component: 'infrastructure', key: '*' },
  { component: 'installation', key: '*' },
  { component: 'extractionPools', key: 'wood' },
  { component: 'extractionPools', key: 'stone' },
];
/** Every registry component listed, the empty ones too. A snapshot replaces
 * the entire base; keys of terminal entities need not survive as tombstones
 * after that replacement. */
function completeRegistry(changes: SyncV2Change[]): SyncV2Change[] {
  for (const component of SYNC_V2_PRIVATE_COMPONENTS) {
    if (!changes.some((change) => change.component === component)) changes.push({ component, upsert: [], remove: [] });
  }
  return changes.map((change) => ({ ...change, remove: [] }));
}

/** Single-batch snapshot, for clients without paged snapshots: refused
 * beyond 4096 references, which only a paged snapshot can carry. */
export async function readPrivateScopeSnapshot(
  tx: Transaction<Database>,
  context: VillageEconomy,
): Promise<SyncV2Change[]> {
  const queries = privateReferenceQueries(context);
  const rows = (await sql<SyncEntityReference>`${sql.join(queries, sql` union all `)} limit 4097`.execute(tx)).rows;
  const references: SyncEntityReference[] = [...rows, ...singletonReferences(context.villageId)];
  if (references.length > 4096) throw new RangeError('Private scope snapshot requires pagination');
  return completeRegistry(await readRegisteredPrivateChanges(tx, context, references));
}

/** Every reference a single snapshot would cover, unbounded and unordered:
 * the reference the pages are compared with. */
export async function readPrivateScopeReferences(
  tx: Transaction<Database>,
  context: VillageEconomy,
): Promise<SyncEntityReference[]> {
  const queries = privateReferenceQueries(context);
  const rows = (await sql<SyncEntityReference>`${sql.join(queries, sql` union all `)}`.execute(tx)).rows;
  return [...rows, ...singletonReferences(context.villageId)];
}

export interface SyncSnapshotPosition {
  component: string;
  key: string;
}
/** One page of the private snapshot (docs/DESIGN-PAGINATION-SNAPSHOT-V2.md):
 * references in (component, key) byte order strictly after `after`, at most
 * `limit` and, per component, the bound of its schema. Only this page's
 * entities are read. `last` is where the next page starts, null once the
 * enumeration is exhausted. The first page lists the whole registry. */
export async function readPrivateScopeSnapshotPage(
  tx: Transaction<Database>,
  context: VillageEconomy,
  after: SyncSnapshotPosition | null,
  limit = SYNC_V2_SNAPSHOT_PAGE_REFERENCES,
): Promise<{ changes: SyncV2Change[]; last: SyncSnapshotPosition | null }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SYNC_V2_SNAPSHOT_PAGE_REFERENCES)
    throw new RangeError('Invalid snapshot page size');
  const queries = [
    ...privateReferenceQueries(context),
    ...singletonReferences(context.villageId).map(
      (reference) => sql<SyncEntityReference>`select ${reference.component}::text as component,
        ${reference.key}::text as key`,
    ),
  ];
  // Byte order ("C"): stable whatever the database collation. Components
  // before the cursor are constant columns: the planner drops their branches.
  const position = after
    ? sql`where component collate "C" > ${after.component}::text
      or (component = ${after.component}::text and key collate "C" > ${after.key}::text)`
    : sql``;
  const rows = (
    await sql<SyncEntityReference>`select component,key from (${sql.join(queries, sql` union all `)}) refs ${position}
    order by component collate "C", key collate "C" limit ${limit + 1}`.execute(tx)
  ).rows;
  const page: SyncEntityReference[] = [];
  let more = false,
    component = '',
    count = 0;
  for (const row of rows) {
    if (row.component !== component) {
      component = row.component;
      count = 0;
    }
    const bound = SYNC_V2_COMPONENT_LIMITS[row.component];
    if (!bound) throw Error(`Unregistered private synchronization component: ${row.component}`);
    if (page.length === limit || count === bound) {
      more = true;
      break;
    }
    page.push(row);
    count++;
  }
  const changes = await readRegisteredPrivateChanges(tx, context, page);
  const last = page.at(-1);
  return {
    changes: after ? changes.map((change) => ({ ...change, remove: [] })) : completeRegistry(changes),
    last: more && last ? { component: last.component, key: last.key } : null,
  };
}

/** Called inside the same read-only MVCC capture as the journal/counters.
 * Unsupported components fail closed: a partial registry must never silently
 * turn an incomplete projection into a complete private-stream delta. */
export async function readRegisteredPrivateChanges(
  tx: Transaction<Database>,
  context: VillageEconomy,
  references: readonly SyncEntityReference[],
): Promise<SyncV2Change[]> {
  const selections = new Map<SyncV2Change['component'], Set<string>>();
  if (references.length > 4096) throw new RangeError('Synchronization selection too large');
  for (const reference of references) {
    if (!privateReaderComponents.has(reference.component as SyncV2Change['component']))
      throw new Error(`Unregistered private synchronization component: ${reference.component}`);
    const component = reference.component as SyncV2Change['component'];
    const ids = selections.get(component) ?? new Set<string>();
    ids.add(reference.key);
    selections.set(component, ids);
  }
  const changes: SyncV2Change[] = [];
  const { worldId, villageId, through } = context;
  for (const [component, selected] of selections) {
    const ids = [...selected].sort();
    if (component === 'resources') {
      const rows = await projectVillageResources(tx, worldId, villageId, through, ids);
      if (rows.some((row) => !Number.isSafeInteger(row.amount))) throw new RangeError('Unsafe resource amount');
      changes.push({
        component,
        upsert: rows.map((row) => ({ ...row, productionUpdatedAt: row.productionUpdatedAt?.toISOString() ?? null })),
        remove: ids.filter((id) => !rows.some((row) => row.code === id)),
      });
    } else if (component === 'processingOrders') {
      // A completion is an authoritative terminal order, not a deletion.
      // Presentation may retain its recent history without confusing a lost
      // entity with a successfully finished command.
      const rows = await readProcessingOrders(tx, context, ids, true);
      changes.push({ component, upsert: rows, remove: ids.filter((id) => !rows.some((row) => row.id === id)) });
    } else if (component === 'cohorts') {
      const rows = await readCohortProjection(tx, worldId, villageId, through, ids);
      changes.push({ component, upsert: rows, remove: ids.filter((id) => !rows.some((row) => row.id === id)) });
    } else if (component === 'populationSummary') {
      if (ids.length !== 1 || ids[0] !== '*') throw Error('Invalid population summary key');
      const {
        cohorts: _cohorts,
        restHousing: _housing,
        ...summary
      } = await readPopulationProjection(tx, worldId, villageId, through);
      void _cohorts;
      void _housing;
      changes.push({ component, upsert: [{ id: '*', ...summary }], remove: [] });
    } else if (component === 'restHousing') {
      if (ids.length > 4096) throw new RangeError('Too many housing ids');
      const [homes, cohorts] = await Promise.all([
        tx
          .selectFrom('buildings')
          .select(['id', 'buildingType', 'level'])
          .where('worldId', '=', worldId)
          .where('villageId', '=', villageId)
          .where('id', 'in', ids)
          .where((eb) => eb.or([eb('status', '=', 'completed'), eb('targetLevel', 'is not', null)]))
          .execute(),
        tx
          .selectFrom('populationCohorts')
          .select(['restBuildingId', 'memberCount'])
          .where('worldId', '=', worldId)
          .where('villageId', '=', villageId)
          .where('restBuildingId', 'in', ids)
          .execute(),
      ]);
      const rows = homes
        .filter((home) => housingCapacity(home.buildingType, home.level) > 0)
        .map((home) => ({
          buildingId: home.id,
          capacity: housingCapacity(home.buildingType, home.level),
          restingCount: cohorts
            .filter((cohort) => cohort.restBuildingId === home.id)
            .reduce((sum, cohort) => sum + cohort.memberCount, 0),
        }));
      changes.push({ component, upsert: rows, remove: ids.filter((id) => !rows.some((row) => row.buildingId === id)) });
    } else if (component === 'buildings') {
      if (ids.length > 4096) throw new RangeError('Too many building ids');
      const rows = await tx
        .selectFrom('buildings')
        .selectAll('buildings')
        .select(
          sql<boolean>`exists(select 1 from building_hidden_supplies s
          where s.world_id=buildings.world_id and s.village_id=buildings.village_id and s.building_id=buildings.id and s.claimed_at is null)`.as(
            'hiddenSuppliesAvailable',
          ),
        )
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('id', 'in', ids)
        .orderBy('id')
        .execute();
      changes.push({
        component,
        upsert: rows.map((row) => ({
          id: row.id,
          type: row.buildingType,
          level: row.level,
          targetLevel: row.targetLevel,
          status: row.status,
          constructionStartedAt: row.constructionStartedAt?.toISOString() ?? null,
          constructionCompletesAt: row.constructionCompletesAt?.toISOString() ?? null,
          completedAt: row.completedAt?.toISOString() ?? null,
          hiddenSuppliesAvailable: row.hiddenSuppliesAvailable,
          visualLayout: row.visualLayout,
          quarterTurns: row.visualLayout?.quarterTurns ?? row.quarterTurns,
        })),
        remove: ids.filter((id) => !rows.some((row) => row.id === id)),
      });
    } else if (component === 'accomplishments') {
      if (ids.length > 128) throw new RangeError('Too many accomplishment codes');
      const rows = await tx
        .selectFrom('villageAccomplishments')
        .select(['code', 'completedAt'])
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('code', 'in', ids)
        .orderBy('code')
        .execute();
      changes.push({
        component,
        upsert: rows.map((row) => ({ code: row.code, completedAt: row.completedAt.toISOString() })),
        remove: ids.filter((id) => !rows.some((row) => row.code === id)),
      });
    } else if (component === 'extractionPools') {
      if (ids.some((id) => id !== 'wood' && id !== 'stone')) throw Error('Invalid extraction pool key');
      changes.push({
        component,
        upsert: await readExtractionPools(tx, worldId, villageId, ids as Array<'wood' | 'stone'>),
        remove: [],
      });
    } else if (component === 'extractions') {
      const rows = (await readExtractions(tx, worldId, villageId, undefined, ids)).map((row) => row.extraction);
      changes.push({ component, upsert: rows, remove: ids.filter((id) => !rows.some((row) => row.id === id)) });
    } else if (component === 'worksites') {
      const rows = await readWorksites(tx, worldId, villageId, undefined, ids);
      changes.push({ component, upsert: rows, remove: ids.filter((id) => !rows.some((row) => row.id === id)) });
    } else if (component === 'exploitationOrders') {
      const rows = await readExploitationOrders(tx, context, undefined, ids);
      changes.push({ component, upsert: rows, remove: ids.filter((id) => !rows.some((row) => row.id === id)) });
    } else if (component === 'levelingJobs') {
      const rows = await levelingSnapshot(tx, context, ids);
      changes.push({ component, upsert: rows, remove: ids.filter((id) => !rows.some((row) => row.id === id)) });
    } else if (component === 'tradeOffers') {
      const rows = await ownTradeOffers(tx, context, ids);
      changes.push({ component, upsert: rows, remove: ids.filter((id) => !rows.some((row) => row.id === id)) });
    } else if (component === 'tradeJourneys') {
      const rows = await readPrivateTradeJourneys(tx, context, ids);
      changes.push({ component, upsert: rows, remove: ids.filter((id) => !rows.some((row) => row.id === id)) });
    } else if (component === 'marketExchanges') {
      if (ids.length > 4096) throw new RangeError('Too many exchange ids');
      const rows = await tx
        .selectFrom('marketExchanges')
        .selectAll()
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('id', 'in', ids)
        .orderBy('id')
        .execute();
      changes.push({
        component,
        upsert: rows.map((row) => ({
          id: row.id,
          offeredResource: row.offeredResource,
          requestedResource: row.requestedResource,
          offeredAmount: Number(row.offeredAmount),
          receivedAmount: Number(row.receivedAmount),
          startedAt: row.startedAt.toISOString(),
          completesAt: row.completesAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
        })),
        remove: ids.filter((id) => !rows.some((row) => row.id === id)),
      });
    } else if (component === 'scienceActivities') {
      if (ids.length > 4096) throw new RangeError('Too many science activity ids');
      const rows = await tx
        .selectFrom('scienceActivities')
        .selectAll()
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('id', 'in', ids)
        .where('status', '=', 'in-progress')
        .orderBy('id')
        .execute();
      changes.push({
        component,
        upsert: rows.map((row) => ({
          id: row.id,
          villageId: row.villageId,
          buildingId: row.buildingId,
          kind: row.kind,
          programCode: row.programCode,
          workerCount: row.workerCount,
          startedAt: row.startedAt.toISOString(),
          completesAt: row.completesAt.toISOString(),
          path: row.pathCells,
          target: row.surveyCells[0] ?? null,
        })),
        remove: ids.filter((id) => !rows.some((row) => row.id === id)),
      });
    } else if (component === 'scienceContributions') {
      if (ids.length > 4096) throw new RangeError('Too many science contribution ids');
      const rows = await tx
        .selectFrom('scienceContributions')
        .selectAll()
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('buildingId', 'in', ids)
        .orderBy('buildingId')
        .orderBy('programCode')
        .execute();
      const buildings = new Map<string, SyncV2Contribution['programs'][number][]>();
      for (const row of rows)
        buildings.set(row.buildingId, [
          ...(buildings.get(row.buildingId) ?? []),
          {
            programCode: row.programCode,
            workerCap: row.workerCap,
            requestedAt: row.requestedAt.toISOString(),
            lastStartedAt: row.lastStartedAt?.toISOString() ?? null,
          },
        ]);
      changes.push({
        component,
        upsert: [...buildings].map(([id, programs]) => ({ id, programs })),
        remove: ids.filter((id) => !rows.some((row) => row.buildingId === id)),
      });
    } else if (component === 'identity') {
      if (ids.length !== 1 || ids[0] !== villageId) throw Error('Invalid village identity key');
      const row = await tx
        .selectFrom('villages')
        .select(['id', 'name', 'anchorCellX', 'anchorCellY'])
        .where('worldId', '=', worldId)
        .where('id', '=', villageId)
        .executeTakeFirst();
      changes.push({ component, upsert: row ? [row] : [], remove: row ? [] : ids });
    } else if (component === 'infrastructure') {
      if (ids.length !== 1 || ids[0] !== '*') throw Error('Invalid infrastructure key');
      const row = await tx
        .selectFrom('villageInfrastructure')
        .select('plan')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .executeTakeFirst();
      changes.push({ component, upsert: row ? [{ id: '*', plan: row.plan }] : [], remove: row ? [] : ['*'] });
    } else if (component === 'installation') {
      if (ids.length !== 1 || ids[0] !== '*') throw Error('Invalid installation key');
      const row = await tx
        .selectFrom('villageStarterInstallations')
        .selectAll()
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .executeTakeFirst();
      changes.push({
        component,
        upsert: row
          ? [
              {
                id: '*',
                villageId,
                kit: row.kit,
                remaining: row.remaining,
                anchor: { x: row.anchorX, y: row.anchorY },
                quarterTurns: row.quarterTurns,
                referenceHeight: row.referenceHeight,
              },
            ]
          : [],
        remove: row ? [] : ['*'],
      });
    } else if (component === 'gardenPlots') {
      const cells = ids.map((id) => {
        if (!/^[0-9]+,[0-9]+$/.test(id)) throw Error('Invalid garden plot key');
        const [cellX, cellY] = id.split(',').map(Number) as [number, number];
        if (!Number.isSafeInteger(cellX) || !Number.isSafeInteger(cellY)) throw Error('Invalid garden plot coordinate');
        return { cellX, cellY };
      });
      const rows = await projectGardenPlots(tx, worldId, villageId, through, cells);
      const upsert = rows.map(({ resourceCode: _resource, ...row }) => {
        void _resource;
        return { ...row, id: `${row.cellX},${row.cellY}`, productionUpdatedAt: row.productionUpdatedAt.toISOString() };
      });
      changes.push({ component, upsert, remove: ids.filter((id) => !upsert.some((row) => row.id === id)) });
    } else if (component === 'roadCells') {
      const cells = ids.map((id) => {
        if (!/^[0-9]+,[0-9]+$/.test(id)) throw Error('Invalid road cell key');
        const [cellX, cellY] = id.split(',').map(Number) as [number, number];
        if (!Number.isSafeInteger(cellX) || !Number.isSafeInteger(cellY)) throw Error('Invalid road cell coordinate');
        return { cellX, cellY };
      });
      // A cell keyed here that now belongs to another village is a removal
      // for this stream: the reader filters by owner.
      const rows = await tx
        .selectFrom('roadCells')
        .select(['cellX', 'cellY', 'surface', 'sidewalks', 'gauge', 'revision'])
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where(
          sql<boolean>`(cell_x,cell_y) in (select * from unnest(${cells.map((c) => c.cellX)}::int[],${cells.map((c) => c.cellY)}::int[]))`,
        )
        .orderBy('cellX')
        .orderBy('cellY')
        .execute();
      const upsert = rows.map((row) => ({ id: `${row.cellX},${row.cellY}`, ...row }));
      changes.push({ component, upsert, remove: ids.filter((id) => !upsert.some((row) => row.id === id)) });
    } else if (component === 'gardenHarvests') {
      if (ids.length > 4096) throw new RangeError('Too many harvest ids');
      const rows = await tx
        .selectFrom('gardenHarvests')
        .selectAll()
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('id', 'in', ids)
        .where('status', '=', 'in-progress')
        .orderBy('id')
        .execute();
      changes.push({
        component,
        upsert: rows.map((row) => ({
          id: row.id,
          buildingId: row.buildingId,
          workerCount: row.workerCount,
          startedAt: row.startedAt.toISOString(),
          completesAt: row.completesAt.toISOString(),
          reservedCarrots: Number(row.reservedCarrots),
          transportMs: row.transportMs,
          plotCellX: row.plotCellX,
          plotCellY: row.plotCellY,
          path: row.pathCells ?? [],
          returnPath: row.returnPathCells ?? [],
          stops: row.stops,
        })),
        remove: ids.filter((id) => !rows.some((row) => row.id === id)),
      });
    } else if (component === 'buildingExpansions') {
      if (ids.length > 4096) throw new RangeError('Too many expansion ids');
      const rows = await tx
        .selectFrom('buildingExpansions')
        .selectAll()
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('id', 'in', ids)
        .where('status', '=', 'under-construction')
        .orderBy('id')
        .execute();
      const cells = rows.length
        ? await tx
            .selectFrom('worldCellOccupancies')
            .select(['pendingExpansionId', 'cellX', 'cellY'])
            .where('worldId', '=', worldId)
            .where(
              'pendingExpansionId',
              'in',
              rows.map((row) => row.id),
            )
            .orderBy('cellX')
            .orderBy('cellY')
            .execute()
        : [];
      changes.push({
        component,
        upsert: rows.map((row) => ({
          id: row.id,
          buildingId: row.buildingId,
          startedAt: row.startedAt.toISOString(),
          completesAt: row.completesAt.toISOString(),
          cells: cells
            .filter((cell) => cell.pendingExpansionId === row.id)
            .map(({ cellX, cellY }) => ({ cellX, cellY })),
        })),
        remove: ids.filter((id) => !rows.some((row) => row.id === id)),
      });
    }
  }
  return changes;
}
