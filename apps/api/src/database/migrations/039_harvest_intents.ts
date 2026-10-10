import {sql,type Kysely} from 'kysely';
export async function up(db:Kysely<unknown>):Promise<void>{
  await sql`create table harvest_intents (
    world_id uuid not null, village_id uuid not null, command_id uuid not null,
    request jsonb not null, receipt jsonb not null, order_id uuid, created_at timestamptz not null,
    primary key(world_id,village_id,command_id),
    foreign key(world_id,village_id) references villages(world_id,id) on delete cascade,
    foreign key(world_id,village_id,order_id) references exploitation_orders(world_id,village_id,id) on delete cascade
  ); create index harvest_intents_order on harvest_intents(world_id,village_id,order_id);`.execute(db);
}
