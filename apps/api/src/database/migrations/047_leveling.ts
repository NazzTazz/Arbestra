import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>) {
  await sql`
    insert into world_feature_types(code,blocks_construction) values('leveling-site',true);
    create table leveling_jobs (
      id uuid primary key default gen_random_uuid(), world_id uuid not null, village_id uuid not null,
      feature_id uuid not null, command_id uuid not null, request jsonb not null, quote jsonb not null,
      path jsonb not null, worker_count integer not null check(worker_count between 1 and 3),
      started_at timestamptz not null, completes_at timestamptz not null, completed_at timestamptz,
      unique(world_id,village_id,id), unique(world_id,village_id,command_id), unique(world_id,feature_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade,
      check(completes_at>started_at)
    );
    create index leveling_jobs_due on leveling_jobs(world_id,village_id,completes_at,id) where completed_at is null;
    alter table population_cohorts add column leveling_job_id uuid;
    alter table population_cohorts add constraint population_leveling_job_fkey
      foreign key(world_id,village_id,leveling_job_id) references leveling_jobs(world_id,village_id,id);
    alter table population_cohorts add constraint population_leveling_exclusive_check
      check(num_nonnulls(harvest_id,extraction_id,science_activity_id,processing_lot_id,trade_journey_id,leveling_job_id)<=1);
    create trigger village_sync_change after insert or update or delete on leveling_jobs for each row execute function mark_village_sync_change();
  `.execute(db);
}
