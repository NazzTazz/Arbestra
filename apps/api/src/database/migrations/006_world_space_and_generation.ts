import { sql, type Kysely } from 'kysely';

/**
 * Replaces the prototype's pre-created village cells with canonical world-cell
 * occupation. Empty grass is intentionally represented by no database row.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table worlds
      add column generation_version integer not null default 1 check (generation_version > 0),
      add column generation_status text not null default 'pending'
        check (generation_status in ('pending', 'generating', 'ready', 'failed')),
      add column generated_at timestamptz,
      add constraint worlds_generation_chunk_size_check check (chunk_size = 32);

    create table terrain_types (
      code smallint primary key,
      slug text not null unique,
      buildable boolean not null
    );
    insert into terrain_types (code, slug, buildable) values
      (1, 'grassland', true),
      (2, 'water', false),
      (3, 'rocky_ground', false);

    create table world_feature_types (
      code text primary key,
      blocks_construction boolean not null
    );
    insert into world_feature_types (code, blocks_construction) values
      ('woodland', true),
      ('stone_outcrop', true);

    create table world_chunks (
      world_id uuid not null references worlds(id) on delete cascade,
      chunk_x integer not null check (chunk_x >= 0),
      chunk_y integer not null check (chunk_y >= 0),
      generation_version integer not null check (generation_version > 0),
      terrain_codes smallint[] not null check (cardinality(terrain_codes) = 1024),
      elevations smallint[] not null check (cardinality(elevations) = 1024),
      created_at timestamptz not null default transaction_timestamp(),
      primary key (world_id, chunk_x, chunk_y)
    );

    create table world_clearings (
      id uuid primary key,
      world_id uuid not null references worlds(id) on delete cascade,
      center_cell_x integer not null check (center_cell_x >= 0),
      center_cell_y integer not null check (center_cell_y >= 0),
      inner_radius integer not null check (inner_radius > 0),
      transition_radius integer not null check (transition_radius >= 0),
      status text not null check (status in ('protected', 'claimed')),
      claimed_village_id uuid,
      created_at timestamptz not null default transaction_timestamp(),
      unique (world_id, center_cell_x, center_cell_y),
      foreign key (world_id, claimed_village_id)
        references villages(world_id, id) on delete restrict
    );
    create unique index world_clearings_one_claim_per_village
      on world_clearings(world_id, claimed_village_id)
      where claimed_village_id is not null;
    create index world_clearings_status_idx on world_clearings(world_id, status);

    create table world_features (
      id uuid primary key,
      world_id uuid not null references worlds(id) on delete cascade,
      feature_type_code text not null references world_feature_types(code),
      state text not null default 'available' check (state in ('available', 'reserved', 'depleted')),
      variant_seed integer not null,
      created_at timestamptz not null default transaction_timestamp(),
      updated_at timestamptz not null default transaction_timestamp(),
      unique (world_id, id)
    );
    create index world_features_type_idx on world_features(world_id, feature_type_code);

    alter table buildings add constraint buildings_world_id_id_unique unique (world_id, id);

    create table world_cell_occupancies (
      world_id uuid not null references worlds(id) on delete cascade,
      cell_x integer not null check (cell_x >= 0),
      cell_y integer not null check (cell_y >= 0),
      building_id uuid,
      feature_id uuid,
      role text not null check (role in ('anchor', 'extension', 'body')),
      created_at timestamptz not null default transaction_timestamp(),
      primary key (world_id, cell_x, cell_y),
      check ((building_id is not null)::integer + (feature_id is not null)::integer = 1),
      check (feature_id is null or role = 'body'),
      foreign key (world_id, building_id)
        references buildings(world_id, id) on delete cascade,
      foreign key (world_id, feature_id)
        references world_features(world_id, id) on delete cascade
    );
    create index world_cell_occupancies_building_idx
      on world_cell_occupancies(world_id, building_id) where building_id is not null;
    create index world_cell_occupancies_feature_idx
      on world_cell_occupancies(world_id, feature_id) where feature_id is not null;
  `.execute(db);

  // Carry current development saves forward before removing the old cell model.
  await sql`
    insert into world_cell_occupancies (world_id, cell_x, cell_y, building_id, role)
    select village_cells.world_id, village_cells.cell_x, village_cells.cell_y,
           building_cells.building_id, building_cells.role
    from building_cells
    join village_cells on village_cells.id = building_cells.cell_id;

    alter table buildings drop constraint buildings_anchor_cell_fkey;
    drop table building_cells;
    alter table buildings drop column anchor_cell_id;
    drop table village_cells;
  `.execute(db);
}
