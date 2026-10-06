import {sql,type Kysely} from 'kysely';
export async function up(db:Kysely<unknown>){
  await sql`
    create table building_variant_costs (
      building_type_code text not null, level integer not null,
      variant text not null check(variant in ('stone','logs','beams')),
      resource_code text not null references resource_types(code), amount bigint not null check(amount>0),
      primary key(building_type_code,level,variant,resource_code),
      foreign key(building_type_code,level) references building_type_levels(building_type_code,level)
    );
    insert into building_variant_costs values ('dwelling',1,'stone','cut-stone',10);

  `.execute(db);
}
