import { sql, type Kysely } from 'kysely';

/** A completed construction can retain its notification while the same building
 * starts another construction. Economic state, not the notification, decides what is due. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop index scheduled_tasks_one_pending_subject;
    create unique index scheduled_tasks_one_pending_subject
      on scheduled_tasks(world_id, task_type, subject_id)
      where completed_at is null and task_type <> 'building.complete'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  void db;
  throw new Error('Economic task notifications are intentionally forward-only.');
}
