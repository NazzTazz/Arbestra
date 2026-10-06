import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>) {
  await sql`
    insert into building_type_levels(building_type_code,level,construction_duration_seconds,additional_cells_required,visual_variant)
      values ('town-hall',2,600,0,'town-hall-1');
    insert into building_level_costs values ('town-hall',2,'timber',500),('town-hall',2,'cut-stone',120);
    insert into resource_types(code,display_name,icon_key) values ('rings','Anneaux','rings');
    insert into village_resources(world_id,village_id,resource_code,amount) select world_id,id,'rings',0 from villages;
    create function initialize_currency_resources() returns trigger language plpgsql as $$
      begin
        insert into village_resources(world_id,village_id,resource_code,amount) values(new.world_id,new.id,'rings',0);
        return new;
      end;
    $$;
    create trigger initialize_currency_resources after insert on villages for each row execute function initialize_currency_resources();
    create table oracle_market_resources (
      resource_code text primary key references resource_types(code),
      value_units integer not null check(value_units between 1 and 1000000)
    );
    insert into oracle_market_resources values ('wood',4),('stone',4),('timber',6),('cut-stone',6),('carrot',1);
    create table market_exchanges (
      id uuid primary key default gen_random_uuid(),world_id uuid not null,village_id uuid not null,
      command_id uuid not null,request jsonb not null,
      offered_resource text not null references resource_types(code),requested_resource text not null references resource_types(code),
      offered_amount bigint not null check(offered_amount>0),received_amount bigint not null check(received_amount>0),
      started_at timestamptz not null,completes_at timestamptz not null,completed_at timestamptz,
      unique(world_id,village_id,command_id),unique(world_id,village_id,id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade,
      check(offered_resource<>requested_resource),check(completes_at=started_at+interval '10 minutes'),
      check(completed_at is null or completed_at=completes_at)
    );
    create index market_exchanges_due on market_exchanges(world_id,village_id,completes_at,id) where completed_at is null;
  `.execute(db);
}
