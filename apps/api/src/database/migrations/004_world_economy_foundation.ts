import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table worlds
      add column topology text not null default 'torus',
      add column width_cells integer not null default 2048,
      add column height_cells integer not null default 1024,
      add column chunk_size integer not null default 32,
      add column seed bigint not null default 1,
      add constraint worlds_topology_check check (topology = 'torus'),
      add constraint worlds_dimensions_check check (
        width_cells > 0 and height_cells > 0 and chunk_size > 0
        and width_cells % chunk_size = 0 and height_cells % chunk_size = 0
      )
  `.execute(db);

  await sql`
    create table resource_types (
      code text primary key,
      display_name text not null,
      icon_key text not null
    );

    create table building_types (
      code text primary key,
      display_name text not null,
      progression_mode text not null check (progression_mode in ('vertical', 'spatial', 'fixed-footprint')),
      production_mode text not null check (production_mode in ('none', 'direct', 'buffered')),
      instance_limit_per_village integer check (instance_limit_per_village is null or instance_limit_per_village > 0),
      visual_key text not null,
      buildable boolean not null default true
    );

    create table building_type_levels (
      building_type_code text not null references building_types(code) on delete cascade,
      level integer not null check (level > 0),
      construction_duration_seconds integer not null check (construction_duration_seconds >= 0),
      additional_cells_required integer not null default 0 check (additional_cells_required >= 0),
      visual_variant text not null,
      primary key (building_type_code, level)
    );

    create table building_level_costs (
      building_type_code text not null,
      level integer not null,
      resource_code text not null references resource_types(code),
      amount bigint not null check (amount >= 0),
      primary key (building_type_code, level, resource_code),
      foreign key (building_type_code, level)
        references building_type_levels(building_type_code, level) on delete cascade
    );

    create table building_level_production (
      building_type_code text not null,
      level integer not null,
      resource_code text not null references resource_types(code),
      rate_per_hour numeric(20, 6) not null check (rate_per_hour >= 0),
      capacity bigint check (capacity is null or capacity >= 0),
      primary key (building_type_code, level, resource_code),
      foreign key (building_type_code, level)
        references building_type_levels(building_type_code, level) on delete cascade
    )
  `.execute(db);

  await sql`
    insert into resource_types (code, display_name, icon_key) values
      ('wood', 'Bois', 'wood'),
      ('carrot', 'Carottes', 'carrot');

    insert into building_types
      (code, display_name, progression_mode, production_mode, instance_limit_per_village, visual_key, buildable)
    values
      ('town-hall', 'Hôtel de ville', 'fixed-footprint', 'none', 1, 'town-hall', false),
      ('dwelling', 'Habitation', 'fixed-footprint', 'none', null, 'dwelling', true),
      ('sawmill', 'Scierie', 'vertical', 'direct', 1, 'sawmill', true),
      ('garden', 'Jardin', 'spatial', 'buffered', null, 'garden', true);

    insert into building_type_levels
      (building_type_code, level, construction_duration_seconds, additional_cells_required, visual_variant)
    values
      ('town-hall', 1, 0, 0, 'town-hall-1'),
      ('dwelling', 1, 60, 0, 'dwelling-1'),
      ('sawmill', 1, 60, 0, 'sawmill-1'),
      ('sawmill', 2, 120, 0, 'sawmill-2'),
      ('sawmill', 3, 240, 0, 'sawmill-3'),
      ('garden', 1, 60, 0, 'garden-1'),
      ('garden', 2, 120, 1, 'garden-2');

    insert into building_level_costs (building_type_code, level, resource_code, amount) values
      ('dwelling', 1, 'wood', 25),
      ('sawmill', 1, 'wood', 50),
      ('sawmill', 2, 'wood', 75),
      ('sawmill', 3, 'wood', 113),
      ('garden', 1, 'wood', 50),
      ('garden', 2, 'wood', 100);

    insert into building_level_production
      (building_type_code, level, resource_code, rate_per_hour, capacity)
    values
      ('sawmill', 1, 'wood', 60, null),
      ('sawmill', 2, 'wood', 108, null),
      ('sawmill', 3, 'wood', 194.4, null),
      ('garden', 1, 'carrot', 60, 600),
      ('garden', 2, 'carrot', 120, 1200)
  `.execute(db);

  await sql`
    alter table villages
      add column anchor_cell_x integer,
      add column anchor_cell_y integer;

    update villages
    set anchor_cell_x = worlds.width_cells / 2,
        anchor_cell_y = worlds.height_cells / 2
    from worlds
    where worlds.id = villages.world_id;

    alter table villages
      alter column anchor_cell_x set not null,
      alter column anchor_cell_y set not null,
      add constraint villages_owner_membership_fkey
        foreign key (owner_account_id, world_id)
        references world_memberships(account_id, world_id),
      add constraint villages_anchor_nonnegative_check
        check (anchor_cell_x >= 0 and anchor_cell_y >= 0);

    create unique index villages_world_id_id_unique on villages(world_id, id)
  `.execute(db);

  await sql`
    create table village_resources (
      world_id uuid not null,
      village_id uuid not null,
      resource_code text not null references resource_types(code),
      amount bigint not null check (amount >= 0),
      primary key (world_id, village_id, resource_code),
      foreign key (world_id, village_id) references villages(world_id, id) on delete cascade
    );

    create table village_resource_flows (
      world_id uuid not null,
      village_id uuid not null,
      resource_code text not null references resource_types(code),
      base_rate_per_hour numeric(20, 6) not null default 0 check (base_rate_per_hour >= 0),
      remainder numeric(20, 12) not null default 0 check (remainder >= 0 and remainder < 1),
      production_updated_at timestamptz not null,
      primary key (world_id, village_id, resource_code),
      foreign key (world_id, village_id, resource_code)
        references village_resources(world_id, village_id, resource_code) on delete cascade
    );

    insert into village_resources (world_id, village_id, resource_code, amount)
    select world_id, id, 'wood', floor(wood)::bigint from villages
    union all
    select world_id, id, 'carrot', floor(carrots)::bigint from villages;

    insert into village_resource_flows
      (world_id, village_id, resource_code, base_rate_per_hour, remainder, production_updated_at)
    select world_id, id, 'wood', 60, wood - floor(wood), wood_production_updated_at
    from villages
  `.execute(db);

  await sql`
    alter table building_sites
      add column world_id uuid,
      add column cell_x integer,
      add column cell_y integer;

    update building_sites
    set world_id = villages.world_id,
        cell_x = mod(villages.anchor_cell_x + round(building_sites.position_x / 3)::integer, worlds.width_cells),
        cell_y = mod(villages.anchor_cell_y + round(building_sites.position_z / 3)::integer, worlds.height_cells)
    from villages
    join worlds on worlds.id = villages.world_id
    where villages.id = building_sites.village_id;

    alter table building_sites
      alter column world_id set not null,
      alter column cell_x set not null,
      alter column cell_y set not null;

    alter table building_sites rename to village_cells;
    alter table village_cells drop constraint building_sites_position_unique;
    alter table village_cells add constraint village_cells_coordinates_unique unique (world_id, cell_x, cell_y);
    alter table village_cells add constraint village_cells_coordinates_nonnegative check (cell_x >= 0 and cell_y >= 0);
    alter table village_cells add constraint village_cells_world_village_id_unique unique (world_id, village_id, id);
    alter table village_cells add constraint village_cells_world_village_fkey
      foreign key (world_id, village_id) references villages(world_id, id) on delete cascade
    ;
    create index village_cells_village_idx on village_cells(world_id, village_id)
  `.execute(db);

  await sql`
    alter table buildings add column village_id uuid;
    update buildings
    set village_id = village_cells.village_id
    from village_cells
    where village_cells.id = buildings.site_id;
    alter table buildings alter column village_id set not null;
    alter table buildings rename column site_id to anchor_cell_id;
    alter table buildings drop constraint buildings_type_check;
    alter table buildings add constraint buildings_type_fkey
      foreign key (building_type) references building_types(code);
    alter table buildings add constraint buildings_world_village_fkey
      foreign key (world_id, village_id) references villages(world_id, id) on delete cascade;
    alter table buildings add constraint buildings_anchor_cell_fkey
      foreign key (world_id, village_id, anchor_cell_id)
      references village_cells(world_id, village_id, id);
    alter table buildings add constraint buildings_world_village_id_unique unique (world_id, village_id, id);
    create temporary table migration_004_duplicate_singletons on commit drop as
      select id
      from (
        select id, row_number() over (
          partition by world_id, village_id, building_type
          order by coalesce(target_level, level) desc, created_at asc, id
        ) as instance_rank
        from buildings
        where building_type = 'sawmill'
      ) ranked
      where instance_rank > 1;
    delete from scheduled_tasks
      where subject_id in (select id from migration_004_duplicate_singletons);
    delete from buildings
      where id in (select id from migration_004_duplicate_singletons);
    create unique index buildings_one_sawmill_per_village
      on buildings(world_id, village_id) where building_type = 'sawmill';
    create index buildings_village_idx on buildings(world_id, village_id)
  `.execute(db);

  await sql`
    create table building_cells (
      world_id uuid not null,
      village_id uuid not null,
      building_id uuid not null,
      cell_id uuid not null,
      role text not null check (role in ('anchor', 'extension')),
      primary key (world_id, cell_id),
      unique (world_id, village_id, building_id, cell_id),
      foreign key (world_id, village_id, building_id)
        references buildings(world_id, village_id, id) on delete cascade,
      foreign key (world_id, village_id, cell_id)
        references village_cells(world_id, village_id, id)
    );

    insert into building_cells (world_id, village_id, building_id, cell_id, role)
    select world_id, village_id, id, anchor_cell_id, 'anchor' from buildings;

    insert into building_cells (world_id, village_id, building_id, cell_id, role)
    select gardens.world_id, gardens.village_id, gardens.building_id,
           coalesce(gardens.pending_extension_site_id, gardens.extension_site_id), 'extension'
    from gardens
    where coalesce(gardens.pending_extension_site_id, gardens.extension_site_id) is not null;
    create index building_cells_building_idx on building_cells(world_id, village_id, building_id)
  `.execute(db);

  await sql`
    create table building_resource_buffers (
      world_id uuid not null,
      village_id uuid not null,
      building_id uuid not null,
      resource_code text not null references resource_types(code),
      stored_amount bigint not null default 0 check (stored_amount >= 0),
      remainder numeric(20, 12) not null default 0 check (remainder >= 0 and remainder < 1),
      production_updated_at timestamptz not null,
      primary key (world_id, building_id, resource_code),
      foreign key (world_id, village_id, building_id)
        references buildings(world_id, village_id, id) on delete cascade
    );

    insert into building_resource_buffers
      (world_id, village_id, building_id, resource_code, stored_amount, remainder, production_updated_at)
    select world_id, village_id, building_id, 'carrot', floor(stored_carrots)::bigint,
           stored_carrots - floor(stored_carrots), production_updated_at
    from gardens;
    create index building_resource_buffers_village_idx on building_resource_buffers(world_id, village_id)
  `.execute(db);

  await sql`
    alter table village_cells drop constraint building_sites_garden_id_fkey;
    alter table village_cells drop column garden_id;
    drop table gardens;

    alter table village_cells
      drop column position_x,
      drop column position_z;

    alter table villages
      drop column wood,
      drop column carrots,
      drop column wood_production_updated_at
  `.execute(db);

  await sql`
    alter table scheduled_tasks drop constraint scheduled_tasks_action_unique;
    create unique index scheduled_tasks_one_pending_subject
      on scheduled_tasks(world_id, task_type, subject_id)
      where completed_at is null
  `.execute(db);
}
