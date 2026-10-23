import type { TerrainBuildingExterior, TerrainOverview } from '@arbestra/contracts';
import type { BuildingsTable, Database } from '../../database/schema.js';
import { sql, type Selectable, type Transaction } from 'kysely';

/** Explicit allowlist: never serialize a building row into a public exterior. */
export function buildingExterior(
  b: Pick<
    Selectable<BuildingsTable>,
    'buildingType' | 'level' | 'targetLevel' | 'status' | 'quarterTurns' | 'visualLayout'
  >,
): TerrainBuildingExterior | undefined {
  const models = ['town-hall', 'dwelling', 'university', 'sawmill', 'stonemason', 'barracks', 'garden'];
  if (!models.includes(b.buildingType)) return undefined;
  const layout = b.visualLayout;
  const model =
    b.buildingType === 'dwelling' && layout?.recipe === 'log-house'
      ? 'dwelling-logs'
      : b.buildingType === 'dwelling' && layout?.recipe === 'beam-house'
        ? 'dwelling-beams'
        : b.buildingType;
  return {
    model,
    level: Math.max(1, Math.min(3, b.targetLevel ?? b.level)),
    phase: b.status === 'under-construction' ? 'works' : 'finished',
    quarterTurns: layout?.quarterTurns ?? b.quarterTurns,
    ...(layout ? { entranceFace: layout.entranceFace, offset: layout.offset } : {}),
  };
}

/** Same bounded exterior capture for live scenery and new dated reports. */
export async function readVillageExteriorBlocks(
  tx: Transaction<Database>,
  world: Pick<TerrainOverview['world'], 'id' | 'widthCells' | 'heightCells'>,
  villageIds: string[],
) {
  if (!villageIds.length) return [];
  type Block = Pick<
    Selectable<BuildingsTable>,
    'buildingType' | 'level' | 'targetLevel' | 'status' | 'quarterTurns' | 'visualLayout'
  > & {
    villageId: string;
    garden: boolean;
    underConstruction: boolean;
    x: number;
    y: number;
    width: number;
    depth: number;
  };
  const blocks = await sql<Block>`
      with cells as (
        select b.id, b.village_id, b.building_type, b.level, b.target_level, b.status, b.quarter_turns, b.visual_layout,
          b.building_type = 'garden' as garden, b.status='under-construction' as under_construction,
          case when o.cell_x-v.anchor_cell_x > ${world.widthCells / 2} then o.cell_x-v.anchor_cell_x-${world.widthCells}
            when o.cell_x-v.anchor_cell_x < ${-world.widthCells / 2} then o.cell_x-v.anchor_cell_x+${world.widthCells}
            else o.cell_x-v.anchor_cell_x end as dx,
          case when o.cell_y-v.anchor_cell_y > ${world.heightCells / 2} then o.cell_y-v.anchor_cell_y-${world.heightCells}
            when o.cell_y-v.anchor_cell_y < ${-world.heightCells / 2} then o.cell_y-v.anchor_cell_y+${world.heightCells}
            else o.cell_y-v.anchor_cell_y end as dy
        from buildings b join villages v on v.id=b.village_id and v.world_id=b.world_id
        join world_cell_occupancies o on o.building_id=b.id and o.world_id=b.world_id
        where b.world_id=${world.id} and b.village_id in (${sql.join(villageIds)})
      ), grouped as (
        select id, village_id, building_type, level, target_level, status, quarter_turns, visual_layout,
          garden, under_construction, (min(dx)+max(dx))::float8/2 as x, (min(dy)+max(dy))::float8/2 as y,
          (max(dx)-min(dx)+1)::float8 as width, (max(dy)-min(dy)+1)::float8 as depth,
          row_number() over(partition by village_id order by id) as rank
        from cells group by id, village_id, building_type, level, target_level, status, quarter_turns, visual_layout, garden, under_construction
      ) select village_id, building_type, level, target_level, status, quarter_turns, visual_layout,
        garden, under_construction, x, y, width, depth from grouped where rank <= 64`.execute(tx);
  return blocks.rows.map((b) => ({
    villageId: b.villageId,
    x: b.x,
    y: b.y,
    width: b.width,
    depth: b.depth,
    garden: b.garden,
    underConstruction: b.underConstruction,
    exterior: buildingExterior(b),
  }));
}
