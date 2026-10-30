import { sql, type Kysely } from 'kysely';

/** Road cells (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §4): one row per
 * road cell, owned by one village, a single owner per world cell. The JSONB
 * plan of 028 stays in place until the conversion (S3); both feed navigation.
 * Each changed cell reaches the private V2 journal through the generic private
 * writer of 053, keyed by its cell. Additive only. */
export const roadCellSyncSource = ['road_cells', 'roadCells', '@cell'] as const;

export async function installRoadCellSync(db: Kysely<unknown>): Promise<void> {
  const [table, component, key] = roadCellSyncSource;
  await sql`create trigger ${sql.id('game_sync_' + component)} after insert or update or delete on ${sql.id(table)}
    for each row execute function game_sync_private_change(${sql.lit(component)}, ${sql.lit(key)})`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table road_cells(
      world_id uuid not null,
      village_id uuid not null,
      cell_x integer not null check(cell_x >= 0),
      cell_y integer not null check(cell_y >= 0),
      surface text not null check(surface in ('earth','rubble','stone-1','stone-2')),
      sidewalks boolean not null,
      gauge text not null default 'chemin' check(gauge in ('chemin','charretiere')),
      revision integer not null default 1 check(revision >= 1),
      created_at timestamptz not null default statement_timestamp(),
      updated_at timestamptz not null default statement_timestamp(),
      primary key(world_id,cell_x,cell_y),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
    create index road_cells_village on road_cells(world_id,village_id);
    create table road_cell_receipts(
      world_id uuid not null,
      village_id uuid not null,
      command_id uuid not null,
      request jsonb not null,
      result jsonb not null,
      created_at timestamptz not null,
      primary key(world_id,village_id,command_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
  `.execute(db);
  await installRoadCellSync(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table road_cell_receipts; drop table road_cells;`.execute(db);
}
