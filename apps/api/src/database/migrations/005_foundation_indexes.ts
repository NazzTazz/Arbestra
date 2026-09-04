import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create index world_memberships_world_idx on world_memberships(world_id);
    create index villages_owner_idx on villages(owner_account_id);
    create index buildings_building_type_idx on buildings(building_type)
  `.execute(db);
}
