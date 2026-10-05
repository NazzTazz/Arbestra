import {sql,type Kysely} from 'kysely';
export async function up(db:Kysely<unknown>){
  await sql`alter table buildings add column quarter_turns integer not null default 0 check(quarter_turns between 0 and 3);
    create table world_factory_settings(world_id uuid primary key references worlds(id) on delete cascade, enabled boolean not null default false);
    create table village_infrastructure(world_id uuid not null,village_id uuid not null,plan jsonb not null,
      primary key(world_id,village_id),foreign key(world_id,village_id) references villages(world_id,id) on delete cascade);
    create table infrastructure_receipts(world_id uuid not null,village_id uuid not null,command_id uuid not null,session_id uuid not null,
      request jsonb not null,before_plan jsonb not null,after_plan jsonb not null,quote jsonb not null,undone boolean not null default false,
      created_at timestamptz not null default statement_timestamp(),primary key(world_id,village_id,command_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade);
    create index infrastructure_receipts_session on infrastructure_receipts(world_id,village_id,session_id,created_at)` .execute(db);
}
export async function down():Promise<never>{throw new Error('Infrastructure migration is forward-only.');}
