import { sql, type Kysely } from 'kysely';
export async function up(db:Kysely<unknown>):Promise<void>{
  await sql`
    alter table worlds add column is_open boolean not null default false, add column opened_at timestamptz;
    -- Preserve access to every existing ready world. Newly inserted worlds remain closed.
    update worlds set is_open=true, opened_at=coalesce(generated_at,created_at) where generation_status='ready';
    create table world_generation_candidates (
      world_id uuid primary key references worlds(id) on delete cascade,
      command_id uuid not null unique,
      owner_account_id uuid not null references accounts(id),
      parameters jsonb not null,
      status text not null default 'pending' check(status in ('pending','running','ready','failed')),
      attempt integer not null default 0, revision integer not null default 1,
      heartbeat_at timestamptz, started_at timestamptz, finished_at timestamptz,
      checksum text check(checksum is null or checksum ~ '^[a-f0-9]{64}$'),
      error text, retained_at timestamptz, duration_ms integer,
      metrics jsonb, artifact jsonb,
      created_at timestamptz not null default statement_timestamp(),
      check(status!='ready' or (checksum is not null and artifact is not null))
    );
    create index world_generation_pending on world_generation_candidates(status,created_at);
  `.execute(db);
}
