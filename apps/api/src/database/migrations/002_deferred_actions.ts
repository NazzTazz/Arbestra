import { sql, type Kysely, type SqlBool } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('buildings')
    .addColumn('worldId', 'uuid')
    .addColumn('status', 'text', (column) => column.notNull().defaultTo('completed'))
    .addColumn('constructionStartedAt', 'timestamptz')
    .addColumn('constructionCompletesAt', 'timestamptz')
    .addColumn('completedAt', 'timestamptz')
    .execute();

  await sql`
    update buildings
    set world_id = villages.world_id,
        completed_at = buildings.created_at
    from building_sites
    join villages on villages.id = building_sites.village_id
    where buildings.site_id = building_sites.id
  `.execute(db);

  await db.schema
    .alterTable('buildings')
    .alterColumn('worldId', (column) => column.setNotNull())
    .execute();
  await db.schema
    .alterTable('buildings')
    .addForeignKeyConstraint('buildings_world_id_fkey', ['worldId'], 'worlds', ['id'], (constraint) => constraint.onDelete('cascade'))
    .execute();
  await db.schema
    .alterTable('buildings')
    .addCheckConstraint('buildings_status_check', sql`status in ('under-construction', 'completed')`)
    .execute();
  await db.schema
    .alterTable('buildings')
    .addCheckConstraint('buildings_construction_times_check', sql`
      (status = 'under-construction'
        and construction_started_at is not null
        and construction_completes_at is not null
        and completed_at is null
        and construction_completes_at >= construction_started_at)
      or
      (status = 'completed' and completed_at is not null)
    `)
    .execute();

  await db.schema.createIndex('buildings_world_id_index').on('buildings').column('worldId').execute();
  await db.schema.createIndex('buildings_due_index')
    .on('buildings')
    .columns(['worldId', 'constructionCompletesAt'])
    .where(sql<SqlBool>`status = 'under-construction'`)
    .execute();

  await db.schema
    .createTable('scheduledTasks')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(db.fn('gen_random_uuid')))
    .addColumn('worldId', 'uuid', (column) => column.notNull().references('worlds.id').onDelete('cascade'))
    .addColumn('taskType', 'text', (column) => column.notNull())
    .addColumn('subjectId', 'uuid', (column) => column.notNull())
    .addColumn('payload', 'jsonb', (column) => column.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('dueAt', 'timestamptz', (column) => column.notNull())
    .addColumn('availableAt', 'timestamptz', (column) => column.notNull())
    .addColumn('attempts', 'integer', (column) => column.notNull().defaultTo(0).check(sql`attempts >= 0`))
    .addColumn('lastError', 'text')
    .addColumn('completedAt', 'timestamptz')
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(db.fn('now')))
    .addUniqueConstraint('scheduled_tasks_subject_unique', ['worldId', 'taskType', 'subjectId'])
    .execute();

  await db.schema.createIndex('scheduled_tasks_world_id_index').on('scheduledTasks').column('worldId').execute();
  await db.schema.createIndex('scheduled_tasks_pending_global_index')
    .on('scheduledTasks')
    .columns(['availableAt', 'id'])
    .where(sql<SqlBool>`completed_at is null`)
    .execute();
  await db.schema.createIndex('scheduled_tasks_pending_world_index')
    .on('scheduledTasks')
    .columns(['worldId', 'availableAt', 'id'])
    .where(sql<SqlBool>`completed_at is null`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('scheduledTasks').execute();
  await db.schema.dropIndex('buildings_due_index').execute();
  await db.schema.dropIndex('buildings_world_id_index').execute();
  await db.schema.alterTable('buildings').dropConstraint('buildings_construction_times_check').execute();
  await db.schema.alterTable('buildings').dropConstraint('buildings_status_check').execute();
  await db.schema.alterTable('buildings').dropConstraint('buildings_world_id_fkey').execute();
  await db.schema.alterTable('buildings').dropColumn('completedAt').execute();
  await db.schema.alterTable('buildings').dropColumn('constructionCompletesAt').execute();
  await db.schema.alterTable('buildings').dropColumn('constructionStartedAt').execute();
  await db.schema.alterTable('buildings').dropColumn('status').execute();
  await db.schema.alterTable('buildings').dropColumn('worldId').execute();
}
