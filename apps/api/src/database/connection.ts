import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { Database } from './schema.js';

const { Pool } = pg;

export function createDatabase(databaseUrl: string, onConnectionError: (error:Error)=>void = error=>console.error('PostgreSQL connection interrupted:',error.message)): Kysely<Database> {
  const pool=new Pool({connectionString:databaseUrl,max:10});
  const reported=new WeakSet<Error>();
  const report=(error:Error)=>{if(!reported.has(error)){reported.add(error);onConnectionError(error);}};
  // PostgreSQL transaction_timeout may close a checked-out client between two
  // queries. Observe its background error; the next query rejects normally and
  // pg-pool discards the non-queryable client when Kysely releases it.
  pool.on('connect',client=>client.on('error',report));
  pool.on('error',report);
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool,
    }),
    plugins: [new CamelCasePlugin()],
  });
}
