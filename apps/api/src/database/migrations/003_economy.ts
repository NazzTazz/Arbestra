import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('villages')
    .alterColumn('wood', (column) => column.setDataType(sql`numeric(20, 6)`))
    .addColumn('carrots', sql`numeric(20, 6)`, (column) => column.notNull().defaultTo(50))
    .addColumn('woodProductionUpdatedAt', 'timestamptz', (column) => column.notNull().defaultTo(db.fn('now')))
    .execute();

  await db.schema
    .alterTable('buildings')
    .addColumn('level', 'integer', (column) => column.notNull().defaultTo(1))
    .addColumn('targetLevel', 'integer')
    .execute();
  await db.schema.alterTable('buildings').dropConstraint('buildings_type_check').execute();
  await db.schema
    .alterTable('buildings')
    .addCheckConstraint('buildings_type_check', sql`building_type in ('town-hall', 'dwelling', 'sawmill', 'garden')`)
    .execute();
  await db.schema
    .alterTable('buildings')
    .addCheckConstraint('buildings_level_check', sql`level >= 1 and (target_level is null or target_level > level)`)
    .execute();

  await db.schema.alterTable('buildingSites').addColumn('gardenId', 'uuid').execute();

  await db.schema
    .createTable('gardens')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(db.fn('gen_random_uuid')))
    .addColumn('worldId', 'uuid', (column) => column.notNull().references('worlds.id').onDelete('cascade'))
    .addColumn('villageId', 'uuid', (column) => column.notNull().references('villages.id').onDelete('cascade'))
    .addColumn('buildingId', 'uuid', (column) => column.notNull().unique().references('buildings.id').onDelete('cascade'))
    .addColumn('storedCarrots', sql`numeric(20, 6)`, (column) => column.notNull().defaultTo(0).check(sql`stored_carrots >= 0`))
    .addColumn('productionUpdatedAt', 'timestamptz', (column) => column.notNull())
    .addColumn('extensionSiteId', 'uuid', (column) => column.unique().references('buildingSites.id').onDelete('restrict'))
    .addColumn('pendingExtensionSiteId', 'uuid', (column) => column.unique().references('buildingSites.id').onDelete('restrict'))
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(db.fn('now')))
    .execute();
  await db.schema.createIndex('gardens_world_village_index').on('gardens').columns(['worldId', 'villageId']).execute();
  await db.schema.createIndex('building_sites_garden_id_index').on('buildingSites').column('gardenId').execute();
  await db.schema
    .alterTable('buildingSites')
    .addForeignKeyConstraint('building_sites_garden_id_fkey', ['gardenId'], 'gardens', ['id'], (constraint) => constraint.onDelete('restrict'))
    .execute();

  await db.schema.alterTable('scheduledTasks').dropConstraint('scheduled_tasks_subject_unique').execute();
  await db.schema
    .alterTable('scheduledTasks')
    .addUniqueConstraint('scheduled_tasks_action_unique', ['worldId', 'taskType', 'subjectId', 'dueAt'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('scheduledTasks').dropConstraint('scheduled_tasks_action_unique').execute();
  await db.schema.alterTable('scheduledTasks').addUniqueConstraint('scheduled_tasks_subject_unique', ['worldId', 'taskType', 'subjectId']).execute();
  await db.schema.alterTable('buildingSites').dropConstraint('building_sites_garden_id_fkey').execute();
  await db.schema.dropIndex('building_sites_garden_id_index').execute();
  await db.schema.dropTable('gardens').execute();
  await db.schema.alterTable('buildingSites').dropColumn('gardenId').execute();
  await db.schema.alterTable('buildings').dropConstraint('buildings_level_check').execute();
  await db.schema.alterTable('buildings').dropConstraint('buildings_type_check').execute();
  await db.schema.alterTable('buildings').addCheckConstraint('buildings_type_check', sql`building_type in ('town-hall', 'dwelling')`).execute();
  await db.schema.alterTable('buildings').dropColumn('targetLevel').execute();
  await db.schema.alterTable('buildings').dropColumn('level').execute();
  await db.schema.alterTable('villages').dropColumn('woodProductionUpdatedAt').execute();
  await db.schema.alterTable('villages').dropColumn('carrots').execute();
  await db.schema.alterTable('villages').alterColumn('wood', (column) => column.setDataType('integer')).execute();
}
