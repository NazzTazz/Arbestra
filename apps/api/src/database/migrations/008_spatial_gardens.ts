import { sql, type Kysely } from 'kysely';

/**
 * Gardens are spatial buildings: their active surface, not a synthetic level,
 * defines their production. Reserved extension cells remain occupied but are
 * deliberately excluded from the active surface until their own task settles.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table building_expansions (
      id uuid primary key default gen_random_uuid(),
      world_id uuid not null references worlds(id) on delete cascade,
      village_id uuid not null,
      building_id uuid not null,
      status text not null check (status in ('under-construction', 'completed')),
      started_at timestamptz not null,
      completes_at timestamptz not null check (completes_at >= started_at),
      completed_at timestamptz,
      created_at timestamptz not null default transaction_timestamp(),
      unique (world_id, id),
      unique (world_id, building_id, id),
      foreign key (world_id, village_id) references villages(world_id, id) on delete cascade,
      foreign key (world_id, village_id, building_id)
        references buildings(world_id, village_id, id) on delete cascade,
      check ((status = 'completed') = (completed_at is not null))
    );
    create index building_expansions_building_idx
      on building_expansions(world_id, building_id);
    create unique index building_expansions_one_pending_per_building
      on building_expansions(world_id, building_id)
      where status = 'under-construction';

    alter table world_cell_occupancies
      add column pending_expansion_id uuid;
    alter table world_cell_occupancies
      add constraint world_cell_occupancies_pending_expansion_fkey
      foreign key (world_id, building_id, pending_expansion_id)
      references building_expansions(world_id, building_id, id) on delete cascade;
    alter table world_cell_occupancies
      add constraint world_cell_occupancies_pending_expansion_shape_check
      check (
        pending_expansion_id is null
        or (building_id is not null and feature_id is null and role = 'extension')
      );
    create index world_cell_occupancies_pending_expansion_idx
      on world_cell_occupancies(world_id, pending_expansion_id)
      where pending_expansion_id is not null;
  `.execute(db);

  /* Carry the old one-cell garden L2 migration forward without altering its
     already-accounted resources. It becomes an L1 garden plus an expansion. */
  await sql`
    with pending as (
      select b.id, b.world_id, b.village_id, b.construction_started_at,
             b.construction_completes_at
      from buildings b
      where b.building_type = 'garden'
        and b.status = 'under-construction'
        and b.target_level = 2
    ), inserted as (
      insert into building_expansions
        (world_id, village_id, building_id, status, started_at, completes_at)
      select world_id, village_id, id, 'under-construction',
             coalesce(construction_started_at, transaction_timestamp()),
             coalesce(construction_completes_at, transaction_timestamp())
      from pending
      returning id, world_id, building_id
    )
    update world_cell_occupancies o
    set pending_expansion_id = inserted.id
    from inserted
    where o.world_id = inserted.world_id
      and o.building_id = inserted.building_id
      and o.role = 'extension';

    update buildings b
    set level = 1,
        target_level = null,
        status = 'completed',
        completed_at = coalesce(completed_at, construction_started_at, created_at)
    where exists (
      select 1 from building_expansions e
      where e.world_id = b.world_id and e.building_id = b.id
    );

    update buildings
    set level = 1, target_level = null
    where building_type = 'garden' and level > 1;

    delete from building_level_costs
      where building_type_code = 'garden' and level > 1;
    delete from building_level_production
      where building_type_code = 'garden' and level > 1;
    delete from building_type_levels
      where building_type_code = 'garden' and level > 1;

    update scheduled_tasks t
    set task_type = 'building-expansion.complete',
        subject_id = e.id
    from building_expansions e
    where t.world_id = e.world_id
      and t.task_type = 'building.complete'
      and t.subject_id = e.building_id
      and e.status = 'under-construction'
      and t.completed_at is null;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  void db;
  throw new Error('The spatial garden migration is intentionally forward-only.');
}
