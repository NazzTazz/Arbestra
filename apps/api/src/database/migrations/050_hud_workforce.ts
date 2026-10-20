import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table extraction_pools (
      world_id uuid not null, village_id uuid not null, resource_code text not null check(resource_code in ('wood','stone')),
      site_count integer not null check(site_count between 0 and 8), worker_cap integer not null check(worker_cap between 1 and 80),
      primary key(world_id,village_id,resource_code),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade,
      check(site_count=0 or worker_cap between site_count and 10*site_count)
    );
    alter table extraction_worksites add column pool_resource text;
    alter table extraction_worksites add constraint extraction_pool_owner foreign key(world_id,village_id,pool_resource)
      references extraction_pools(world_id,village_id,resource_code);
    alter table extraction_worksites add constraint extraction_pool_resource check(pool_resource is null or pool_resource=resource_code and mode in ('cut','extract'));
    create index extraction_worksites_pool on extraction_worksites(world_id,village_id,pool_resource);
    alter table population_cohorts add column pending_release text check(pending_release in ('idle','resting'));
    alter table population_cohorts add column avoid_worksite_id uuid;
    create table hud_workforce_receipts (
      world_id uuid not null, village_id uuid not null, command_id uuid not null,
      request jsonb not null, affected integer not null, carrots integer not null,
      primary key(world_id,village_id,command_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
    -- Preserve engaged lots and targets. Only running automatic harvesting is adopted.
    insert into extraction_pools(world_id,village_id,resource_code,site_count,worker_cap)
      select s.world_id,s.village_id,s.resource_code,count(*)::integer,sum(least(s.worker_cap,10))::integer
      from extraction_worksites s where s.status='running' and s.mode in ('cut','extract')
      and exists(select 1 from harvest_intents h where h.world_id=s.world_id and h.village_id=s.village_id and h.order_id=s.exploitation_order_id)
      group by s.world_id,s.village_id,s.resource_code;
    update extraction_worksites s set pool_resource=s.resource_code,exploitation_order_id=null,worker_cap=least(s.worker_cap,10)
      where s.status='running' and s.mode in ('cut','extract')
      and exists(select 1 from harvest_intents h where h.world_id=s.world_id and h.village_id=s.village_id and h.order_id=s.exploitation_order_id);
    create trigger village_sync_change after insert or update or delete on extraction_pools
      for each row execute function mark_village_sync_change();
  `.execute(db);
}
