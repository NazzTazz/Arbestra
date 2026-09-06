import { sql, type Kysely } from 'kysely';

/** Additive first vertical slice for authoritative world stone deposits. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await validateStoneDepositBackfill(db);
  await sql`
    insert into resource_types (code, display_name, icon_key)
      values ('stone', 'Pierre', 'stone') on conflict (code) do nothing;

    create table stone_deposits (
      world_id uuid not null,
      feature_id uuid not null,
      cell_x integer not null check (cell_x >= 0),
      cell_y integer not null check (cell_y >= 0),
      initial_amount bigint not null check (initial_amount > 0),
      remaining_amount bigint not null check (remaining_amount >= 0),
      reserved_amount bigint not null default 0 check (reserved_amount >= 0),
      revision bigint not null default 1 check (revision > 0),
      updated_at timestamptz not null default transaction_timestamp(),
      primary key (world_id, feature_id),
      unique (world_id, cell_x, cell_y),
      check (reserved_amount <= remaining_amount and remaining_amount <= initial_amount),
      foreign key (world_id, feature_id) references world_features(world_id, id) on delete restrict
    );
    create index stone_deposits_available_idx on stone_deposits(world_id, feature_id)
      where remaining_amount > reserved_amount;

    create table deposit_extractions (
      id uuid primary key default gen_random_uuid(),
      world_id uuid not null,
      village_id uuid not null,
      feature_id uuid not null,
      command_id uuid not null,
      status text not null check (status in ('in-progress', 'completed')),
      started_at timestamptz not null,
      completes_at timestamptz not null check (completes_at > started_at),
      completed_at timestamptz,
      worker_count integer not null check (worker_count between 1 and 10),
      reserved_amount bigint not null check (reserved_amount between 1 and 100),
      unique (world_id, id),
      unique (world_id, village_id, id),
      unique (world_id, village_id, command_id),
      check ((status = 'completed') = (completed_at is not null)),
      foreign key (world_id, village_id) references villages(world_id, id) on delete cascade,
      foreign key (world_id, feature_id) references stone_deposits(world_id, feature_id) on delete restrict
    );
    create index deposit_extractions_due_idx on deposit_extractions(world_id, village_id, completes_at, id)
      where status = 'in-progress';
    create index deposit_extractions_feature_idx on deposit_extractions(world_id, feature_id)
      where status = 'in-progress';

    alter table population_cohorts add column extraction_id uuid;
    alter table population_cohorts add constraint population_cohorts_extraction_fkey
      foreign key (world_id, village_id, extraction_id)
      references deposit_extractions(world_id, village_id, id) on delete restrict;
    alter table population_cohorts add constraint population_cohorts_one_work_check
      check (not (harvest_id is not null and extraction_id is not null));

    insert into stone_deposits (world_id, feature_id, cell_x, cell_y, initial_amount, remaining_amount)
    select feature.world_id, feature.id, occupancy.cell_x, occupancy.cell_y,
      750 + mod(abs(feature.variant_seed::bigint), 501),
      750 + mod(abs(feature.variant_seed::bigint), 501)
    from world_features feature
    join world_cell_occupancies occupancy
      on occupancy.world_id = feature.world_id and occupancy.feature_id = feature.id
    where feature.feature_type_code = 'stone_outcrop' and feature.state = 'available'
    on conflict (world_id, feature_id) do nothing;

    insert into village_resources (world_id, village_id, resource_code, amount)
      select world_id, id, 'stone', 0 from villages
      on conflict (world_id, village_id, resource_code) do nothing;
  `.execute(db);
}

/** Fail before writing anything instead of choosing one cell or inventing stock. */
export async function validateStoneDepositBackfill(db: Kysely<unknown>): Promise<void> {
  const invalid = await sql<{ id: string }>`
    select f.id from world_features f
    left join world_cell_occupancies o on o.world_id = f.world_id and o.feature_id = f.id
    where f.feature_type_code = 'stone_outcrop'
    group by f.world_id, f.id, f.state
    having f.state <> 'available' or count(o.feature_id) <> 1
    limit 1
  `.execute(db);
  if (invalid.rows.length) throw new Error(`Stone backfill requires one available cell per feature: ${invalid.rows[0]!.id}`);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  void db;
  throw new Error('Stone deposit migration is intentionally forward-only.');
}
