import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>) {
  await sql`
    alter table building_variant_costs add column replaces_resource_code text references resource_types(code);
    insert into building_variant_costs(building_type_code,level,variant,resource_code,amount,replaces_resource_code)
      values ('dwelling',1,'logs','wood',25,'timber'),('dwelling',2,'logs','wood',300,'timber');
  `.execute(db);
}
