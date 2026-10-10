import {sql,type Kysely} from 'kysely';
export async function up(db:Kysely<unknown>):Promise<void>{
  await sql`
    create table village_starter_installations (
      world_id uuid not null, village_id uuid primary key, account_id uuid not null references accounts(id),
      command_id uuid not null, request jsonb not null, kit jsonb not null, remaining jsonb not null,
      anchor_x integer not null, anchor_y integer not null, quarter_turns integer not null check(quarter_turns between 0 and 3),
      reference_height double precision not null, created_at timestamptz not null default statement_timestamp(),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade,
      unique(world_id,account_id), unique(world_id,command_id)
    );
    create table starter_pose_receipts (
      world_id uuid not null, village_id uuid not null, command_id uuid not null, request jsonb not null,
      building_id uuid not null, primary key(world_id,village_id,command_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
    create table world_spawn_terraces (
      world_id uuid not null, village_id uuid not null, cell_x integer not null check(cell_x between 0 and 511),
      cell_y integer not null check(cell_y between 0 and 255), height double precision not null,
      primary key(world_id,cell_x,cell_y),foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
    create table world_rc1_resources (
      world_id uuid not null references worlds(id) on delete cascade, feature_id uuid not null,
      source_key text not null, tree_indices jsonb not null default '[]', removed_indices jsonb not null default '[]',
      primary key(world_id,feature_id),unique(world_id,source_key),
      foreign key(world_id,feature_id) references world_features(world_id,id) on delete cascade
    );
  `.execute(db);
}
