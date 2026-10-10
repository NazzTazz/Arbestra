import {sql,type Kysely} from 'kysely';
export async function up(db:Kysely<unknown>):Promise<void>{
  // An inbox is not an economic mutation: do not contend with FOR UPDATE on
  // villages merely to receive a gesture. Ownership is checked at intake and execution.
  await sql`create table harvest_submissions (
    world_id uuid not null references worlds(id) on delete cascade, village_id uuid not null,
    command_id uuid not null, account_id uuid not null references accounts(id) on delete cascade,
    request jsonb not null, receipt jsonb, created_at timestamptz not null default statement_timestamp(),
    primary key(world_id,village_id,command_id)
  );`.execute(db);
}
