import { sql, type Kysely } from 'kysely';

/** Additive: no scientific mastery is granted to existing players. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    insert into building_types(code,display_name,progression_mode,production_mode,instance_limit_per_village,visual_key,buildable)
      values ('university','Université','vertical','none',null,'university',true);
    insert into building_type_levels(building_type_code,level,construction_duration_seconds,additional_cells_required,visual_variant)
      values ('university',1,600,0,'university-1'),('university',2,1200,0,'university-2'),('university',3,2400,0,'university-3');
    insert into building_level_costs(building_type_code,level,resource_code,amount)
      values ('university',1,'wood',500),('university',1,'stone',300),
        ('university',2,'wood',1000),('university',2,'stone',600),('university',3,'wood',2000),('university',3,'stone',1200);
    create table player_science (
      world_id uuid not null, account_id uuid not null,
      observations_since timestamptz, solar_report jsonb,
      primary key(world_id,account_id),
      foreign key(account_id,world_id) references world_memberships(account_id,world_id) on delete cascade
    );
    create table science_programs (
      world_id uuid not null, account_id uuid not null, code text not null,
      discipline text not null check(discipline in ('mathematics','geography','astronomy')),
      level integer not null check(level > 0), work_done_ms bigint not null default 0 check(work_done_ms >= 0),
      paused boolean not null default false, acquired_at timestamptz,
      created_at timestamptz not null, worker_cap integer not null check(worker_cap between 1 and 15),
      primary key(world_id,account_id,code),
      unique(world_id,account_id,discipline,level),
      foreign key(world_id,account_id) references player_science(world_id,account_id) on delete cascade
    );
    create unique index science_one_active_discipline on science_programs(world_id,account_id,discipline) where acquired_at is null;
    create table science_activities (
      id uuid primary key default gen_random_uuid(), world_id uuid not null, village_id uuid not null,
      account_id uuid not null, building_id uuid, program_code text,
      kind text not null check(kind in ('research','training','survey','exploration')),
      status text not null default 'in-progress' check(status in ('in-progress','completed')),
      worker_count integer not null check(worker_count between 1 and 15),
      work_ms bigint not null default 0 check(work_ms >= 0),
      started_at timestamptz not null, completes_at timestamptz not null check(completes_at >= started_at), completed_at timestamptz,
      path_cells jsonb not null default '[]', survey_cells jsonb not null default '[]',
      unique(world_id,id), unique(world_id,village_id,id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade,
      foreign key(world_id,village_id,building_id) references buildings(world_id,village_id,id),
      foreign key(world_id,account_id,program_code) references science_programs(world_id,account_id,code),
      foreign key(world_id,account_id) references player_science(world_id,account_id),
      check((status='completed')=(completed_at is not null)),
      check((kind='research')=(program_code is not null)),
      check((kind in ('research','training'))=(building_id is not null))
    );
    create index science_activities_due on science_activities(world_id,village_id,completes_at) where status='in-progress';
    create table science_contributions (
      world_id uuid not null, village_id uuid not null, building_id uuid not null,
      account_id uuid not null, program_code text not null, worker_cap integer not null check(worker_cap between 1 and 15),
      requested_at timestamptz not null, last_started_at timestamptz,
      primary key(world_id,building_id,program_code),
      foreign key(world_id,village_id,building_id) references buildings(world_id,village_id,id) on delete cascade,
      foreign key(world_id,account_id,program_code) references science_programs(world_id,account_id,code) on delete cascade
    );
    create table science_places (
      world_id uuid not null, account_id uuid not null, cell_x integer not null check(cell_x>=0), cell_y integer not null check(cell_y>=0),
      terrain_code integer not null, elevation integer not null,
      observed_at timestamptz not null, surveyed boolean not null,
      source_activity_id uuid,
      primary key(world_id,account_id,cell_x,cell_y),
      foreign key(world_id,account_id) references player_science(world_id,account_id) on delete cascade,
      foreign key(world_id,source_activity_id) references science_activities(world_id,id)
    );
    create table science_village_reports (
      world_id uuid not null, account_id uuid not null, village_id uuid not null,
      name text not null, anchor_cell_x integer not null, anchor_cell_y integer not null,
      observed_at timestamptz not null, blocks jsonb not null default '[]',
      primary key(world_id,account_id,village_id),
      foreign key(world_id,account_id) references player_science(world_id,account_id) on delete cascade
    );
    alter table population_cohorts add column science_activity_id uuid,
      add column cartographer boolean not null default false,
      add constraint population_science_activity_fk foreign key(world_id,village_id,science_activity_id)
        references science_activities(world_id,village_id,id),
      drop constraint population_cohorts_one_work_check,
      add constraint population_cohorts_one_work_check check(num_nonnulls(harvest_id,extraction_id,science_activity_id)<=1),
      drop constraint population_rest_building_activity,
      add constraint population_rest_building_activity check(rest_building_id is null or (activity='resting'
        and harvest_id is null and extraction_id is null and science_activity_id is null));
    create index population_science_activity_idx on population_cohorts(world_id,science_activity_id) where science_activity_id is not null;
    create unique index science_wake_unique on scheduled_tasks(world_id,task_type,subject_id,due_at) where task_type='science.wake';
  `.execute(db);
}
