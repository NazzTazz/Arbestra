import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>) {
  await sql`
    insert into resource_types(code, display_name, icon_key) values
      ('timber', 'Bois d’œuvre', 'timber'), ('cut-stone', 'Pierre taillée', 'cut-stone');
    update resource_types set display_name = 'Bois brut' where code = 'wood';
    update resource_types set display_name = 'Pierre brute' where code = 'stone';
    alter table villages add column economy_activated_at timestamptz;
    alter table villages alter column economy_activated_at set default statement_timestamp();
    insert into village_resources(world_id, village_id, resource_code, amount)
      select world_id, id, resource_code, 0 from villages cross join
      (values ('timber'), ('cut-stone')) as resources(resource_code);
    create function initialize_refined_resources() returns trigger language plpgsql as $$
      begin
        insert into village_resources(world_id,village_id,resource_code,amount)
          values(new.world_id,new.id,'timber',0),(new.world_id,new.id,'cut-stone',0);
        return new;
      end;
    $$;
    create trigger initialize_refined_resources after insert on villages
      for each row execute function initialize_refined_resources();

    alter table building_types drop constraint building_types_production_mode_check;
    alter table building_types add constraint building_types_production_mode_check
      check(production_mode in ('none','direct','buffered','processing'));
    update building_types set production_mode='processing' where code in ('sawmill','stonemason');
    update building_types set instance_limit_per_village=null where code='sawmill';
    drop index buildings_one_sawmill_per_village;
    update building_types set buildable=true where code='stonemason';
    update building_type_levels set construction_duration_seconds=60 where building_type_code='stonemason';
    insert into building_level_costs values ('stonemason',1,'wood',50),('stonemason',1,'stone',25);
    update building_level_costs set resource_code=case resource_code when 'wood' then 'timber' else 'cut-stone' end
      where (building_type_code='dwelling' and resource_code in ('wood','stone'))
        or (building_type_code='sawmill' and level>1 and resource_code='wood');
    create table processing_recipes (
      building_type_code text not null, level integer not null,
      version integer not null check(version>0),
      input_resource text not null references resource_types(code), input_amount integer not null check(input_amount>0),
      output_resource text not null references resource_types(code), output_amount integer not null check(output_amount>0),
      work_ms integer not null check(work_ms>0), worker_cap integer not null check(worker_cap between 1 and 3),
      primary key(building_type_code,level),
      foreign key(building_type_code,level) references building_type_levels(building_type_code,level)
    );
    insert into processing_recipes values
      ('sawmill',1,1,'wood',25,'timber',20,600000,1),
      ('sawmill',2,1,'wood',25,'timber',20,600000,2),
      ('sawmill',3,1,'wood',25,'timber',20,600000,3),
      ('stonemason',1,1,'stone',25,'cut-stone',20,600000,3);

    create table processing_orders (
      id uuid primary key default gen_random_uuid(), world_id uuid not null, village_id uuid not null,
      building_id uuid not null,
      status text not null check(status in ('running','pause-requested','cancel-requested','paused','blocked','completed','cancelled')),
      blocked_reason text check(blocked_reason in ('missing-input','missing-workers')),
      requested_lots integer not null check(requested_lots between 1 and 20),
      completed_lots integer not null default 0 check(completed_lots between 0 and requested_lots),
      worker_count integer not null check(worker_count between 1 and 3),
      worker_ids jsonb not null default '[]',
      created_at timestamptz not null, finished_at timestamptz,
      unique(world_id,village_id,id),
      foreign key(world_id,village_id,building_id) references buildings(world_id,village_id,id) on delete cascade,
      check((status in ('completed','cancelled')) = (finished_at is not null))
    );
    create unique index processing_one_open_order on processing_orders(world_id,building_id)
      where status not in ('completed','cancelled');
    create table processing_lots (
      id uuid primary key default gen_random_uuid(), world_id uuid not null, village_id uuid not null,
      order_id uuid not null, lot_number integer not null check(lot_number between 1 and 20),
      recipe_version integer not null, input_resource text not null references resource_types(code),
      input_amount integer not null check(input_amount>0), output_resource text not null references resource_types(code),
      output_amount integer not null check(output_amount>0), worker_count integer not null check(worker_count between 1 and 3),
      started_at timestamptz not null, completes_at timestamptz not null check(completes_at>started_at), completed_at timestamptz,
      unique(world_id,village_id,id), unique(order_id,lot_number),
      foreign key(world_id,village_id,order_id) references processing_orders(world_id,village_id,id) on delete cascade
    );
    create index processing_due_lots on processing_lots(world_id,village_id,completes_at,id) where completed_at is null;
    alter table population_cohorts add column processing_lot_id uuid;
    alter table population_cohorts add constraint population_processing_lot_fkey
      foreign key(world_id,village_id,processing_lot_id) references processing_lots(world_id,village_id,id);
    alter table population_cohorts add constraint population_processing_exclusive_check
      check(num_nonnulls(harvest_id,extraction_id,science_activity_id,processing_lot_id)<=1);
    create table processing_command_receipts (
      world_id uuid not null, village_id uuid not null, command_id uuid not null, request jsonb not null,
      primary key(world_id,village_id,command_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
  `.execute(db);
}
