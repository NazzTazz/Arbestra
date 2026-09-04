import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { Database } from './schema.js';

const { Pool } = pg;

export function createDatabase(databaseUrl: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: databaseUrl, max: 10 }),
    }),
    plugins: [new CamelCasePlugin()],
  });
}
