import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('accounts')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(db.fn('gen_random_uuid')))
    .addColumn('email', 'text', (column) => column.notNull().unique())
    .addColumn('passwordHash', 'text', (column) => column.notNull())
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(db.fn('now')))
    .execute();

  await db.schema
    .createTable('worlds')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(db.fn('gen_random_uuid')))
    .addColumn('slug', 'text', (column) => column.notNull().unique())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(db.fn('now')))
    .execute();

  await db.schema
    .createTable('worldMemberships')
    .addColumn('accountId', 'uuid', (column) => column.notNull().references('accounts.id').onDelete('cascade'))
    .addColumn('worldId', 'uuid', (column) => column.notNull().references('worlds.id').onDelete('cascade'))
    .addColumn('playerName', 'text', (column) => column.notNull())
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(db.fn('now')))
    .addPrimaryKeyConstraint('world_memberships_pkey', ['accountId', 'worldId'])
    .execute();

  await db.schema
    .createTable('villages')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(db.fn('gen_random_uuid')))
    .addColumn('worldId', 'uuid', (column) => column.notNull().references('worlds.id').onDelete('cascade'))
    .addColumn('ownerAccountId', 'uuid', (column) => column.notNull().references('accounts.id').onDelete('cascade'))
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('wood', 'integer', (column) => column.notNull().defaultTo(100).check(sql`wood >= 0`))
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(db.fn('now')))
    .execute();

  await db.schema.createIndex('villages_world_owner_index').on('villages').columns(['worldId', 'ownerAccountId']).execute();

  await db.schema
    .createTable('buildingSites')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(db.fn('gen_random_uuid')))
    .addColumn('villageId', 'uuid', (column) => column.notNull().references('villages.id').onDelete('cascade'))
    .addColumn('positionX', 'double precision', (column) => column.notNull())
    .addColumn('positionZ', 'double precision', (column) => column.notNull())
    .addUniqueConstraint('building_sites_position_unique', ['villageId', 'positionX', 'positionZ'])
    .execute();

  await db.schema
    .createTable('buildings')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(db.fn('gen_random_uuid')))
    .addColumn('siteId', 'uuid', (column) => column.notNull().unique().references('buildingSites.id').onDelete('cascade'))
    .addColumn('buildingType', 'text', (column) => column.notNull())
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(db.fn('now')))
    .addCheckConstraint('buildings_type_check', sql`building_type in ('town-hall', 'dwelling')`)
    .execute();

  await db.schema
    .createTable('sessions')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(db.fn('gen_random_uuid')))
    .addColumn('tokenHash', 'char(64)', (column) => column.notNull().unique())
    .addColumn('accountId', 'uuid', (column) => column.notNull().references('accounts.id').onDelete('cascade'))
    .addColumn('expiresAt', 'timestamptz', (column) => column.notNull())
    .addColumn('createdAt', 'timestamptz', (column) => column.notNull().defaultTo(db.fn('now')))
    .execute();

  await db.schema.createIndex('sessions_account_id_index').on('sessions').column('accountId').execute();
  await db.schema.createIndex('sessions_expires_at_index').on('sessions').column('expiresAt').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('sessions').execute();
  await db.schema.dropTable('buildings').execute();
  await db.schema.dropTable('buildingSites').execute();
  await db.schema.dropTable('villages').execute();
  await db.schema.dropTable('worldMemberships').execute();
  await db.schema.dropTable('worlds').execute();
  await db.schema.dropTable('accounts').execute();
}
