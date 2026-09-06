import { sql, type Kysely } from 'kysely';

/** Adds the first vertical upgrade for dwellings without changing existing buildings. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    insert into building_type_levels
      (building_type_code, level, construction_duration_seconds, additional_cells_required, visual_variant)
    values ('dwelling', 2, 120, 0, 'dwelling-2');

    insert into building_level_costs (building_type_code, level, resource_code, amount)
    values ('dwelling', 2, 'wood', 300);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    delete from building_level_costs where building_type_code = 'dwelling' and level = 2;
    delete from building_type_levels where building_type_code = 'dwelling' and level = 2;
  `.execute(db);
}
