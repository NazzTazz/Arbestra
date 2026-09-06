import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table village_populations (
      world_id uuid not null,
      village_id uuid not null,
      initialized_at timestamptz not null default transaction_timestamp(),
      primary key (world_id, village_id),
      foreign key (world_id, village_id) references villages(world_id, id) on delete cascade
    );
    create table population_cohorts (
      id uuid primary key default gen_random_uuid(),
      world_id uuid not null,
      village_id uuid not null,
      origin_village_id uuid not null,
      member_count integer not null check (member_count > 0),
      activity text not null check (activity in ('idle', 'working', 'resting')),
      energy integer not null check (energy between 0 and 10),
      energy_progress integer not null default 0 check (energy_progress between 0 and 79199999),
      energy_updated_at timestamptz not null,
      resting_since timestamptz,
      food_used_since_rest integer not null default 0 check (food_used_since_rest between 0 and 2),
      harvest_id uuid,
      created_at timestamptz not null default transaction_timestamp(),
      unique (world_id, id),
      foreign key (world_id, village_id) references villages(world_id, id) on delete cascade,
      foreign key (world_id, origin_village_id) references villages(world_id, id) on delete restrict
    );
    create index population_cohorts_village_idx on population_cohorts(world_id, village_id);
    create table building_hidden_supplies (
      world_id uuid not null,
      village_id uuid not null,
      building_id uuid not null,
      resource_code text not null references resource_types(code),
      amount bigint not null check (amount > 0),
      claimed_at timestamptz,
      primary key (world_id, building_id),
      foreign key (world_id, village_id, building_id) references buildings(world_id, village_id, id) on delete cascade
    );
    create table garden_harvests (
      id uuid primary key default gen_random_uuid(),
      world_id uuid not null,
      village_id uuid not null,
      building_id uuid not null,
      command_id uuid not null,
      status text not null check (status in ('in-progress', 'completed')),
      started_at timestamptz not null,
      completes_at timestamptz not null check (completes_at >= started_at),
      completed_at timestamptz,
      worker_count integer not null check (worker_count > 0),
      reserved_carrots bigint not null check (reserved_carrots >= 0),
      unique (world_id, id),
      unique (world_id, village_id, command_id),
      foreign key (world_id, village_id, building_id) references buildings(world_id, village_id, id) on delete cascade,
      check ((status = 'completed') = (completed_at is not null))
    );
    alter table population_cohorts add constraint population_cohorts_harvest_fkey
      foreign key (world_id, harvest_id) references garden_harvests(world_id, id) on delete set null;
    create unique index garden_harvests_one_active_building
      on garden_harvests(world_id, building_id) where status = 'in-progress';
    create index garden_harvests_due_idx on garden_harvests(world_id, completes_at) where status = 'in-progress';
    insert into village_populations (world_id, village_id)
      select world_id, id from villages on conflict do nothing;
    insert into population_cohorts (world_id, village_id, origin_village_id, member_count, activity, energy, energy_updated_at)
      select world_id, id, id, 15, 'idle', 10, transaction_timestamp() from villages;
    insert into building_hidden_supplies (world_id, village_id, building_id, resource_code, amount)
      select world_id, village_id, id, 'carrot', 2000 from buildings
      where building_type = 'town-hall' and status = 'completed';
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  void db;
  throw new Error('Population and harvest migration is intentionally forward-only.');
}
