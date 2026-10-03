import { sql, type Kysely } from 'kysely';
import type { TerrainOverview, TerrainVillageOverview } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';

/** Nearby public exteriors, bounded independently of economic reconciliation. */
export async function getTerrainVillages(db: Kysely<Database>, world: TerrainOverview['world'], x: number, y: number): Promise<TerrainVillageOverview> {
  const normalize = (n: number, size: number) => ((n % size) + size) % size;
  x = normalize(x, world.widthCells); y = normalize(y, world.heightCells);
  return db.transaction().setIsolationLevel('repeatable read').execute(async tx => {
    await sql`set transaction read only`.execute(tx);
    await sql`set local statement_timeout = '5s'`.execute(tx);
    const current = await tx.selectFrom('worlds').select(['generationVersion', 'generationStatus']).where('id', '=', world.id).executeTakeFirstOrThrow();
    if (current.generationStatus !== 'ready' || current.generationVersion !== world.generationVersion)
      throw new HttpError(409, 'WORLD_NOT_READY', 'Terrain modifié pendant la lecture.');
    const rows = await sql<{ id: string; anchorCellX: number; anchorCellY: number }>`
      select id, anchor_cell_x, anchor_cell_y from villages where world_id = ${world.id}
      and least(abs(anchor_cell_x - ${x}), ${world.widthCells} - abs(anchor_cell_x - ${x})) <= 320
      and least(abs(anchor_cell_y - ${y}), ${world.heightCells} - abs(anchor_cell_y - ${y})) <= 320
      order by greatest(least(abs(anchor_cell_x - ${x}), ${world.widthCells} - abs(anchor_cell_x - ${x})),
        least(abs(anchor_cell_y - ${y}), ${world.heightCells} - abs(anchor_cell_y - ${y}))), id limit 33`.execute(tx);
    const villages = rows.rows.slice(0, 32);
    if (!villages.length) return { world, sampledAt: new Date().toISOString(), truncated: false, villages: [] };
    const blocks = await sql<{ villageId: string; garden: boolean; underConstruction:boolean; x: number; y: number; width: number; depth: number }>`
      with cells as (
        select b.id, b.village_id, b.building_type = 'garden' as garden, b.status='under-construction' as under_construction,
          case when o.cell_x-v.anchor_cell_x > ${world.widthCells / 2} then o.cell_x-v.anchor_cell_x-${world.widthCells}
            when o.cell_x-v.anchor_cell_x < ${-world.widthCells / 2} then o.cell_x-v.anchor_cell_x+${world.widthCells}
            else o.cell_x-v.anchor_cell_x end as dx,
          case when o.cell_y-v.anchor_cell_y > ${world.heightCells / 2} then o.cell_y-v.anchor_cell_y-${world.heightCells}
            when o.cell_y-v.anchor_cell_y < ${-world.heightCells / 2} then o.cell_y-v.anchor_cell_y+${world.heightCells}
            else o.cell_y-v.anchor_cell_y end as dy
        from buildings b join villages v on v.id=b.village_id and v.world_id=b.world_id
        join world_cell_occupancies o on o.building_id=b.id and o.world_id=b.world_id
        where b.world_id=${world.id} and b.village_id in (${sql.join(villages.map(v => v.id))})
      ), grouped as (
        select id, village_id, garden, under_construction, (min(dx)+max(dx))::float8/2 as x, (min(dy)+max(dy))::float8/2 as y,
          (max(dx)-min(dx)+1)::float8 as width, (max(dy)-min(dy)+1)::float8 as depth,
          row_number() over(partition by village_id order by id) as rank
        from cells group by id, village_id, garden, under_construction
      ) select village_id, garden, under_construction, x, y, width, depth from grouped where rank <= 64`.execute(tx);
    return { world, sampledAt: new Date().toISOString(), truncated: rows.rows.length > 32,
      villages: villages.map(v => ({ id: v.id, anchorCellX: v.anchorCellX, anchorCellY: v.anchorCellY,
        blocks: blocks.rows.filter(b => b.villageId === v.id).map(({ garden, underConstruction, x, y, width, depth }) => ({ garden, x, y, width, depth, ...(underConstruction?{underConstruction:true}:{}) })) })) };
  });
}
