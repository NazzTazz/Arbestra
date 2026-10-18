import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>) {
  await sql`
    create table trade_offers (
      id uuid primary key default gen_random_uuid(), world_id uuid not null, village_id uuid not null,
      requested_resource text not null references resource_types(code), requested_amount integer not null check(requested_amount between 1 and 1000000000),
      offered_resource text not null references resource_types(code), offered_amount integer not null check(offered_amount between 1 and 1000000000),
      max_travel_seconds integer not null check(max_travel_seconds between 1 and 3600),
      status text not null check(status in ('open','cancelled','accepted','oracle')),
      created_at timestamptz not null, oracle_at timestamptz not null, oracle_eligible boolean not null,
      unique(world_id,village_id,id), check(requested_resource<>offered_resource),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
    create index trade_offers_open on trade_offers(world_id,id) where status='open';
    create index trade_offers_due on trade_offers(world_id,village_id,oracle_at,id) where status='open' and oracle_eligible;
    create table trade_journeys (
      id uuid primary key default gen_random_uuid(), world_id uuid not null, village_id uuid not null,
      destination_village_id uuid not null, offer_id uuid not null,
      worker_count integer not null check(worker_count>0), path jsonb not null,
      started_at timestamptz not null, arrives_at timestamptz not null, returns_at timestamptz not null,
      unique(world_id,village_id,id), unique(offer_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade,
      foreign key(world_id,destination_village_id,offer_id) references trade_offers(world_id,village_id,id) on delete cascade,
      check(arrives_at>started_at and returns_at>arrives_at)
    );
    create index trade_journeys_active on trade_journeys(world_id,returns_at);
    create table trade_deliveries (
      id uuid primary key default gen_random_uuid(), world_id uuid not null, village_id uuid not null,
      journey_id uuid not null, resource_code text not null references resource_types(code), amount integer not null check(amount>0),
      due_at timestamptz not null, completed_at timestamptz, release_workers boolean not null,
      unique(journey_id,release_workers),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade,
      foreign key(journey_id) references trade_journeys(id) on delete cascade
    );
    create index trade_deliveries_due on trade_deliveries(world_id,village_id,due_at,id) where completed_at is null;
    create table trade_receipts (
      world_id uuid not null, village_id uuid not null, command_id uuid not null, request jsonb not null,
      primary key(world_id,village_id,command_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
    alter table population_cohorts add column trade_journey_id uuid;
    alter table population_cohorts add constraint population_trade_journey_fkey
      foreign key(world_id,village_id,trade_journey_id) references trade_journeys(world_id,village_id,id);
    alter table population_cohorts add constraint population_trade_exclusive_check
      check(num_nonnulls(harvest_id,extraction_id,science_activity_id,processing_lot_id,trade_journey_id)<=1);
    create trigger village_sync_change after insert or update or delete on trade_offers for each row execute function mark_village_sync_change();
    create trigger village_sync_change after insert or update or delete on trade_journeys for each row execute function mark_village_sync_change();
    create trigger village_sync_change after insert or update or delete on trade_deliveries for each row execute function mark_village_sync_change();
  `.execute(db);
}
