import {sql,type Kysely} from 'kysely';

export async function up<DB>(db:Kysely<DB>):Promise<void>{
  await sql`alter table village_populations add column next_arrival_at timestamptz,
      add column growth_started_at timestamptz not null default statement_timestamp();
    insert into village_populations(world_id,village_id)
      select world_id,id from villages on conflict do nothing;
    create unique index population_arrival_notification on scheduled_tasks(world_id,subject_id,due_at)
      where task_type='population.arrive';
    -- A handler schedules its successor before its claimed notification is
    -- acknowledged. Existing notifications are never updated by reconciliation.
    drop index scheduled_tasks_one_pending_subject;
    create unique index scheduled_tasks_one_pending_subject on scheduled_tasks(world_id,task_type,subject_id)
      where completed_at is null and task_type not in ('building.complete','population.arrive');
    -- Start the legacy catch-up now, never from the age of an old house.
    update village_populations p set next_arrival_at=growth_started_at+interval '1 minute'
      where coalesce((select sum(member_count) from population_cohorts c
        where c.world_id=p.world_id and c.village_id=p.village_id),0)
      < floor(coalesce((select sum(case when b.building_type='town-hall' then 30
        when b.level>=2 then 25 else 5 end) from buildings b
        where b.world_id=p.world_id and b.village_id=p.village_id
          and b.building_type in ('town-hall','dwelling')
          and (b.status='completed' or b.target_level is not null)),0)/2.0);
    insert into scheduled_tasks(world_id,task_type,subject_id,payload,due_at,available_at)
      select world_id,'population.arrive',village_id,'{}'::jsonb,next_arrival_at,next_arrival_at
      from village_populations where next_arrival_at is not null;
  `.execute(db);
}
