import { sql, type Kysely } from 'kysely';

/** Energy and rest housing advance through the worker, not through client
 * reads (inventory of 29 October, « Autonomie des workers »). A village keeps a
 * pending `population.energy` notification no later than the next activity
 * change of its unassigned inhabitants; the handler schedules its successor
 * before the scheduler acknowledges it, like `population.arrive` (043).
 * Additive: two partial indexes and one notification due now per village that
 * has inhabitants, which applies every change already due and starts the chain.
 * Existing notifications are neither read for update nor modified. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create unique index population_energy_notification on scheduled_tasks(world_id,subject_id,due_at)
      where task_type='population.energy' and completed_at is null;
    drop index scheduled_tasks_one_pending_subject;
    create unique index scheduled_tasks_one_pending_subject on scheduled_tasks(world_id,task_type,subject_id)
      where completed_at is null and task_type not in ('building.complete','population.arrive','population.energy');
    insert into scheduled_tasks(world_id,task_type,subject_id,payload,due_at,available_at)
      select v.world_id,'population.energy',v.id,jsonb_build_object('villageId',v.id),
        statement_timestamp(),statement_timestamp()
      from villages v
      where exists(select 1 from population_cohorts c where c.world_id=v.world_id and c.village_id=v.id)
      on conflict do nothing;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    delete from scheduled_tasks where task_type='population.energy';
    drop index scheduled_tasks_one_pending_subject;
    create unique index scheduled_tasks_one_pending_subject on scheduled_tasks(world_id,task_type,subject_id)
      where completed_at is null and task_type not in ('building.complete','population.arrive');
    drop index population_energy_notification;
  `.execute(db);
}
