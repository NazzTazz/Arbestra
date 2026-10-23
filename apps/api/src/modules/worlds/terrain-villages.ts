import { sql, type Kysely } from 'kysely';
import type { TerrainOverview, TerrainVillageOverview } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { readVillageExteriorBlocks } from './building-exterior.js';

/** Nearby public exteriors, bounded independently of economic reconciliation. */
export async function getTerrainVillages(
  db: Kysely<Database>,
  world: TerrainOverview['world'],
  x: number,
  y: number,
  accountId: string,
  preview = false,
): Promise<TerrainVillageOverview> {
  const normalize = (n: number, size: number) => ((n % size) + size) % size;
  x = normalize(x, world.widthCells);
  y = normalize(y, world.heightCells);
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      await sql`set transaction read only`.execute(tx);
      await sql`set local statement_timeout = '5s'`.execute(tx);
      const current = await tx
        .selectFrom('worlds')
        .select(['generationVersion', 'generationStatus'])
        .where('id', '=', world.id)
        .executeTakeFirstOrThrow();
      if (current.generationStatus !== 'ready' || current.generationVersion !== world.generationVersion)
        throw new HttpError(409, 'WORLD_NOT_READY', 'Terrain modifié pendant la lecture.');
      const rows = await sql<{ id: string; anchorCellX: number; anchorCellY: number; own: boolean }>`
      select id, anchor_cell_x, anchor_cell_y, owner_account_id = ${accountId} as own from villages where world_id = ${world.id}
      and least(abs(anchor_cell_x - ${x}), ${world.widthCells} - abs(anchor_cell_x - ${x})) <= 320
      and least(abs(anchor_cell_y - ${y}), ${world.heightCells} - abs(anchor_cell_y - ${y})) <= 320
      order by greatest(least(abs(anchor_cell_x - ${x}), ${world.widthCells} - abs(anchor_cell_x - ${x})),
        least(abs(anchor_cell_y - ${y}), ${world.heightCells} - abs(anchor_cell_y - ${y}))), id limit 33`.execute(tx);
      const reports =
        accountId && !preview
          ? await tx
              .selectFrom('scienceVillageReports')
              .selectAll()
              .where('worldId', '=', world.id)
              .where('accountId', '=', accountId)
              .execute()
          : [];
      const distance = (n: number, centre: number, size: number) =>
        Math.min(Math.abs(n - centre), size - Math.abs(n - centre));
      const nearbyReports = reports
        .filter(
          (r) =>
            distance(r.anchorCellX, x, world.widthCells) <= 320 && distance(r.anchorCellY, y, world.heightCells) <= 320,
        )
        .sort(
          (a, b) =>
            Math.max(distance(a.anchorCellX, x, world.widthCells), distance(a.anchorCellY, y, world.heightCells)) -
              Math.max(distance(b.anchorCellX, x, world.widthCells), distance(b.anchorCellY, y, world.heightCells)) ||
            a.villageId.localeCompare(b.villageId),
        );
      const reportsById = new Map(nearbyReports.map((r) => [r.villageId, r]));
      const candidates = new Map(rows.rows.map((v) => [v.id, v]));
      for (const r of nearbyReports)
        if (!candidates.get(r.villageId)?.own)
          candidates.set(r.villageId, {
            id: r.villageId,
            anchorCellX: r.anchorCellX,
            anchorCellY: r.anchorCellY,
            own: false,
          });
      const villages = [...candidates.values()]
        .sort(
          (a, b) =>
            Math.max(distance(a.anchorCellX, x, world.widthCells), distance(a.anchorCellY, y, world.heightCells)) -
              Math.max(distance(b.anchorCellX, x, world.widthCells), distance(b.anchorCellY, y, world.heightCells)) ||
            a.id.localeCompare(b.id),
        )
        .slice(0, 32);
      if (!villages.length) return { world, sampledAt: new Date().toISOString(), truncated: false, villages: [] };
      const blocks = await readVillageExteriorBlocks(
        tx,
        world,
        villages.map((v) => v.id),
      );
      const liveIds = new Set(rows.rows.map((v) => v.id));
      return {
        world,
        sampledAt: new Date().toISOString(),
        truncated: candidates.size > 32,
        villages: villages.map((v) => {
          const report = !v.own && reportsById.get(v.id);
          // Reports remain dated knowledge. They must not downgrade today's public
          // exterior to old cuboids while the actual village is visible nearby.
          if (report && !liveIds.has(v.id))
            return {
              id: report.villageId,
              anchorCellX: report.anchorCellX,
              anchorCellY: report.anchorCellY,
              blocks: report.blocks,
            };
          const detailed = v.own || preview;
          return {
            ...(detailed || report ? { id: v.id } : {}),
            anchorCellX: v.anchorCellX,
            anchorCellY: v.anchorCellY,
            blocks: blocks
              .filter((b) => b.villageId === v.id)
              .map((b) => {
                const { garden, underConstruction, x, y, width, depth } = b;
                return {
                  x,
                  y,
                  width,
                  depth,
                  ...(b.exterior ? { exterior: b.exterior } : {}),
                  ...(detailed ? { garden, ...(underConstruction ? { underConstruction: true } : {}) } : {}),
                };
              }),
          };
        }),
      };
    });
}
