import { createHash } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { SYNC_V2_SPATIAL_COMPONENTS, type SyncV2Change } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { naturalFeaturesQuery } from '../worlds/natural-features.js';
import { knownGeography } from '../science/knowledge.js';
import { readSelectedGround } from '../worlds/selected-ground.js';
import { buildingExterior } from '../worlds/building-exterior.js';
import { normalizeCell, wrappedDelta } from '../worlds/coordinates.js';
import { safeAmount } from '../deposits/stone-extractions.js';
import { readSelectedRc1FeatureGeometry } from '../worlds/rc1-ground.js';
import type { SyncEntityReference } from './sync-v2-readers.js';

export interface SpatialReadContext {
  worldId: string;
  worldSlug: string;
  accountId: string;
  widthCells: number;
  heightCells: number;
  chunkSize: number;
  generationVersion: number;
  chunkX: number;
  chunkY: number;
}
const exteriorKey = (worldId: string, buildingId: string) =>
  createHash('sha256').update(`${worldId}:exterior:${buildingId}`).digest('hex');

export async function readSpatialScopeSnapshot(
  tx: Transaction<Database>,
  context: SpatialReadContext,
): Promise<SyncV2Change[]> {
  const { worldId, chunkX, chunkY, chunkSize: size } = context;
  const area = { minX: chunkX * size, maxX: (chunkX + 1) * size, minY: chunkY * size, maxY: (chunkY + 1) * size };
  const [occupancies, woods, features] = await Promise.all([
    tx
      .selectFrom('worldCellOccupancies')
      .select(['cellX', 'cellY', 'buildingId'])
      .where('worldId', '=', worldId)
      .where('cellX', '>=', area.minX)
      .where('cellX', '<', area.maxX)
      .where('cellY', '>=', area.minY)
      .where('cellY', '<', area.maxY)
      .execute(),
    tx
      .selectFrom('woodlandDeposits')
      .select(['cellX', 'cellY'])
      .where('worldId', '=', worldId)
      .where('cellX', '>=', area.minX)
      .where('cellX', '<', area.maxX)
      .where('cellY', '>=', area.minY)
      .where('cellY', '<', area.maxY)
      .execute(),
    naturalFeaturesQuery(tx, worldId, [area]).execute(),
  ]);
  const references: SyncEntityReference[] = [
    { component: 'spatialGround', key: '*' },
    ...[...new Set([...occupancies, ...woods].map((cell) => `${cell.cellX},${cell.cellY}`))].map((key) => ({
      component: 'spatialCells',
      key,
    })),
    ...[...new Set(features.map((feature) => feature.id))].map((key) => ({ component: 'spatialFeatures', key })),
    ...[...new Set(occupancies.flatMap((cell) => (cell.buildingId ? [cell.buildingId] : [])))].map((key) => ({
      component: 'spatialExteriors',
      key,
    })),
  ];
  const changes = await readSpatialChanges(tx, context, references);
  for (const component of SYNC_V2_SPATIAL_COMPONENTS)
    if (!changes.some((change) => change.component === component)) changes.push({ component, upsert: [], remove: [] });
  return changes.map((change) => ({ ...change, remove: [] }));
}

/** Typed reads for one canonical chunk. Private building identifiers are
 * emitted only to their owner; public exterior identities are opaque. */
export async function readSpatialChanges(
  tx: Transaction<Database>,
  context: SpatialReadContext,
  references: readonly SyncEntityReference[],
): Promise<SyncV2Change[]> {
  const { worldId, accountId, widthCells: width, heightCells: height, chunkSize: size, chunkX, chunkY } = context;
  if (
    ![width, height, size, chunkX, chunkY].every(Number.isSafeInteger) ||
    size < 1 ||
    width % size ||
    height % size ||
    chunkX < 0 ||
    chunkY < 0 ||
    chunkX >= width / size ||
    chunkY >= height / size
  )
    throw Error('Non-canonical spatial scope');
  if (references.length > 4096) throw new RangeError('Spatial selection too large');
  const area = { minX: chunkX * size, maxX: (chunkX + 1) * size, minY: chunkY * size, maxY: (chunkY + 1) * size };
  const inside = (cell: { cellX: number; cellY: number }) =>
    cell.cellX >= area.minX && cell.cellX < area.maxX && cell.cellY >= area.minY && cell.cellY < area.maxY;
  const selections = new Map<string, Set<string>>();
  for (const reference of references) {
    if (!['spatialCells', 'spatialFeatures', 'spatialGround', 'spatialExteriors'].includes(reference.component))
      throw Error('Unknown spatial component');
    const keys = selections.get(reference.component) ?? new Set<string>();
    keys.add(reference.key);
    selections.set(reference.component, keys);
  }
  const changes: SyncV2Change[] = [];
  for (const [component, selected] of selections) {
    const ids = [...selected].sort();
    if (ids.length > 4096) throw new RangeError('Spatial component selection too large');
    if (component === 'spatialGround') {
      if (ids.length !== 1 || ids[0] !== '*') throw Error('Invalid ground key');
      const data = await readSelectedGround(tx, worldId, chunkX, chunkY);
      changes.push({ component, upsert: [{ id: '*', data }], remove: [] });
    } else if (component === 'spatialCells') {
      const cells = ids.map((id) => {
        if (!/^[0-9]+,[0-9]+$/.test(id)) throw Error('Invalid spatial cell key');
        const [cellX, cellY] = id.split(',').map(Number) as [number, number];
        if (!inside({ cellX, cellY })) throw Error('Cell outside spatial scope');
        return { cellX, cellY };
      });
      const knowledge = await knownGeography(
        tx,
        worldId,
        accountId,
        width,
        height,
        cells.map((c) => ({ minX: c.cellX, maxX: c.cellX + 1, minY: c.cellY, maxY: c.cellY + 1 })),
      );
      const rows = (
        await sql<{
          cellX: number;
          cellY: number;
          buildingId: string | null;
          ownerAccountId: string | null;
          role: 'anchor' | 'extension' | 'body' | null;
          pendingExpansionId: string | null;
          occupied: boolean;
        }>`
        select c."cellX" as cell_x,c."cellY" as cell_y,o.building_id,v.owner_account_id,o.role,o.pending_expansion_id,
          case when o.building_id is not null then v.owner_account_id=${accountId}::uuid
            when w.feature_id is not null then w.blocks_cell else o.feature_id is not null end as occupied
        from jsonb_to_recordset(${JSON.stringify(cells)}::jsonb) c("cellX" int,"cellY" int)
        left join world_cell_occupancies o on o.world_id=${worldId} and o.cell_x=c."cellX" and o.cell_y=c."cellY"
        left join buildings b on b.world_id=o.world_id and b.id=o.building_id
        left join villages v on v.world_id=b.world_id and v.id=b.village_id
        left join lateral (select feature_id,blocks_cell from resource_deposits d where d.world_id=${worldId}
          and d.cell_x=c."cellX" and d.cell_y=c."cellY" and d.resource_code='wood' limit 1) w on true
      `.execute(tx)
      ).rows;
      const upsert = rows.filter(knowledge.known).map((row) => ({
        id: `${row.cellX},${row.cellY}`,
        cellX: row.cellX,
        cellY: row.cellY,
        occupied: row.occupied,
        ...(row.buildingId && row.ownerAccountId === accountId
          ? { buildingId: row.buildingId, role: row.role!, pendingExpansionId: row.pendingExpansionId }
          : {}),
      }));
      changes.push({ component, upsert, remove: ids.filter((id) => !upsert.some((row) => row.id === id)) });
    } else if (component === 'spatialFeatures') {
      const rows = await naturalFeaturesQuery(tx, worldId, [area], false, ids).execute();
      const knowledge = await knownGeography(tx, worldId, accountId, width, height, [area]);
      const geometry =
        context.generationVersion === 3 && rows.length
          ? await readSelectedRc1FeatureGeometry(
              tx,
              worldId,
              rows.map((row) => row.id),
            )
          : new Map();
      const upsert = ids.flatMap((id) => {
        const locations = rows
          .filter((row) => row.id === id)
          .map((row) => ({
            id,
            type: row.featureTypeCode,
            cellX: row.cellX,
            cellY: row.cellY,
            variantSeed: row.variantSeed,
            ...(geometry.has(id) ? { rc1: geometry.get(id)! } : {}),
            deposit:
              !knowledge.known(row) || row.remainingAmount === null
                ? null
                : {
                    featureId: id,
                    resourceCode: row.resourceCode!,
                    blocksCell: row.blocksCell!,
                    cleared: row.cleared ?? false,
                    cellX: row.cellX,
                    cellY: row.cellY,
                    initialAmount: safeAmount(row.initialAmount!),
                    remainingAmount: safeAmount(row.remainingAmount),
                    reservedAmount: safeAmount(row.reservedAmount!),
                    availableAmount: safeAmount(row.remainingAmount) - safeAmount(row.reservedAmount!),
                    ...(row.resourceCode === 'wood' ? { cutAmount: safeAmount(row.cutAmount!) } : {}),
                    // A wood case stays until its last stump is removed.
                    state: (row.resourceCode === 'wood' ? row.cleared : safeAmount(row.remainingAmount) === 0)
                      ? ('depleted' as const)
                      : ('available' as const),
                    revision: safeAmount(row.revision!),
                    updatedAt: row.updatedAt!.toISOString(),
                  },
          }));
        return locations.length ? [{ id, locations }] : [];
      });
      changes.push({ component, upsert, remove: ids.filter((id) => !upsert.some((row) => row.id === id)) });
    } else if (component === 'spatialExteriors') {
      const rows = await tx
        .selectFrom('buildings as b')
        .innerJoin('worldCellOccupancies as o', (join) =>
          join.onRef('o.worldId', '=', 'b.worldId').onRef('o.buildingId', '=', 'b.id'),
        )
        .select([
          'b.id',
          'b.buildingType',
          'b.level',
          'b.targetLevel',
          'b.status',
          'b.quarterTurns',
          'b.visualLayout',
          'o.cellX',
          'o.cellY',
          'o.role',
        ])
        .where('b.worldId', '=', worldId)
        .where('b.id', 'in', ids)
        .orderBy('b.id')
        .orderBy('o.cellX')
        .orderBy('o.cellY')
        .execute();
      const upsert = ids.flatMap((id) => {
        const footprint = rows.filter((row) => row.id === id);
        if (!footprint.some(inside)) return [];
        const anchor = footprint.find((row) => row.role === 'anchor') ?? footprint[0]!;
        const exterior = buildingExterior(anchor);
        if (!exterior) return [];
        const dx = footprint.map((row) => wrappedDelta(row.cellX, anchor.cellX, width));
        const dy = footprint.map((row) => wrappedDelta(row.cellY, anchor.cellY, height));
        return [
          {
            id: exteriorKey(worldId, id),
            cellX: normalizeCell(anchor.cellX + Math.min(...dx), width),
            cellY: normalizeCell(anchor.cellY + Math.min(...dy), height),
            width: Math.max(...dx) - Math.min(...dx) + 1,
            depth: Math.max(...dy) - Math.min(...dy) + 1,
            exterior,
          },
        ];
      });
      changes.push({
        component,
        upsert,
        remove: ids.map((id) => exteriorKey(worldId, id)).filter((id) => !upsert.some((row) => row.id === id)),
      });
    }
  }
  return changes;
}
