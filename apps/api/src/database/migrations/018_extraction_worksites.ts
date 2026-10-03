import { sql, type Kysely } from 'kysely';

/** Durable orders; individual deposit_extractions remain the economic ledger. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table extraction_worksites (
      id uuid primary key default gen_random_uuid(),
      world_id uuid not null,
      village_id uuid not null,
      command_id uuid not null,
      resource_code text not null check (resource_code in ('stone','wood')),
      mode text not null check (mode in ('extract','cut','clear')),
      status text not null default 'running' check (status in ('running','paused','stopping','stopped','completed')),
      worker_cap integer not null check (worker_cap between 1 and 10),
      delivered_amount bigint not null default 0 check (delivered_amount >= 0),
      wait_reason text,
      next_wake_at timestamptz,
      wake_version integer not null default 0,
      last_departure_at timestamptz,
      created_at timestamptz not null default statement_timestamp(),
      updated_at timestamptz not null default statement_timestamp(),
      unique(world_id,id),
      unique(world_id,village_id,command_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
    create index extraction_worksites_village on extraction_worksites(world_id,village_id,created_at,id);
    create table extraction_worksite_commands (
      world_id uuid not null,
      village_id uuid not null,
      command_id uuid not null,
      worksite_id uuid not null references extraction_worksites(id) on delete cascade,
      action text not null check(action in ('pause','resume','stop','set-cap')),
      worker_cap integer,
      primary key(world_id,village_id,command_id)
    );
    create table extraction_worksite_targets (
      worksite_id uuid not null references extraction_worksites(id) on delete cascade,
      world_id uuid not null,
      village_id uuid not null,
      feature_id uuid not null,
      ordinal integer not null,
      status text not null default 'pending' check(status in ('pending','completed','external','abandoned')),
      admitted_at timestamptz,
      threshold_reached_at timestamptz,
      completed_at timestamptz,
      reason text,
      primary key(worksite_id,feature_id),
      unique(worksite_id,ordinal),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade,
      foreign key(world_id,feature_id) references world_features(world_id,id) on delete restrict
    );
    create unique index extraction_worksite_target_owner on extraction_worksite_targets(world_id,village_id,feature_id)
      where status='pending';
    create index extraction_worksite_targets_feature on extraction_worksite_targets(world_id,feature_id)
      where status='pending';
    alter table deposit_extractions add column worksite_id uuid references extraction_worksites(id) on delete restrict;
    create index deposit_extractions_worksite on deposit_extractions(worksite_id,completes_at)
      where worksite_id is not null;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  void db;
  throw new Error('Extraction worksite migration is intentionally forward-only.');
}
