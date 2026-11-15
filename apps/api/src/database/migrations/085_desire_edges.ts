import { sql, type Kysely } from 'kysely';

/** Desire lines observed (docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §4.3 and §17,
 * slice T3a). Three tables and one scheduled task per open world:
 *
 * - `world_desire_edges`: passages per cell edge, owned by the ground (no
 *   village). Direction 0 is eastward, 1 southward; the origin is the wrapped
 *   canonical cell of `desireEdges` (packages/contracts). One passage is one
 *   admitted mission.
 * - `world_desire_missions`: the missions already counted, by source (`deposit`,
 *   `garden`, `science`). Missions are re-read over a margin window because
 *   `started_at` is not in COMMIT order; this ledger makes the re-reading
 *   count each mission once. Pruned beyond the margin.
 * - `world_desire_state`: when counting started for the world (`counting_from`,
 *   the migration or the world's opening: no backfill of earlier missions) and
 *   the lower bound of the next window (`watermark`).
 *
 * The task `world.desire-paths` (subject: the world) aggregates the missions
 * of its world. Like `population.energy` (071) it schedules its successor
 * before the scheduler acknowledges it, so the one-pending-per-subject index
 * excludes its type; its own unique index keeps a world from holding two
 * notifications due at the same instant. Existing notifications are neither
 * read for update nor modified. Indexes on the missions' `started_at` serve the
 * window. Additive: nothing is written to an existing table but the seed tasks.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table world_desire_edges(
      world_id uuid not null references worlds(id) on delete cascade,
      cell_x integer not null check (cell_x >= 0),
      cell_y integer not null check (cell_y >= 0),
      direction smallint not null check (direction in (0, 1)),
      passages integer not null check (passages >= 1),
      last_passage_at timestamptz not null,
      primary key (world_id, cell_x, cell_y, direction)
    );
    create table world_desire_missions(
      world_id uuid not null references worlds(id) on delete cascade,
      source text not null check (source in ('deposit', 'garden', 'science')),
      mission_id uuid not null,
      started_at timestamptz not null,
      primary key (world_id, source, mission_id)
    );
    create index world_desire_missions_started on world_desire_missions(world_id, started_at);
    create table world_desire_state(
      world_id uuid primary key references worlds(id) on delete cascade,
      counting_from timestamptz not null,
      watermark timestamptz not null,
      check (watermark >= counting_from)
    );
    create index deposit_extractions_started on deposit_extractions(world_id, started_at);
    create index garden_harvests_started on garden_harvests(world_id, started_at);
    create index science_activities_trips_started on science_activities(world_id, started_at)
      where kind in ('survey', 'exploration');

    create unique index desire_paths_notification on scheduled_tasks(world_id, subject_id, due_at)
      where task_type = 'world.desire-paths' and completed_at is null;
    drop index scheduled_tasks_one_pending_subject;
    create unique index scheduled_tasks_one_pending_subject on scheduled_tasks(world_id, task_type, subject_id)
      where completed_at is null
        and task_type not in ('building.complete', 'population.arrive', 'population.energy', 'world.desire-paths');

    -- Counting starts now, in every open world; worlds opened later start at their opening.
    insert into world_desire_state(world_id, counting_from, watermark)
      select id, statement_timestamp(), statement_timestamp() from worlds where is_open
      on conflict do nothing;
    insert into scheduled_tasks(world_id, task_type, subject_id, payload, due_at, available_at)
      select w.id, 'world.desire-paths', w.id, jsonb_build_object('worldId', w.id),
        statement_timestamp(), statement_timestamp()
      from worlds w where w.is_open
      on conflict do nothing;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    delete from scheduled_tasks where task_type = 'world.desire-paths';
    drop index scheduled_tasks_one_pending_subject;
    create unique index scheduled_tasks_one_pending_subject on scheduled_tasks(world_id, task_type, subject_id)
      where completed_at is null and task_type not in ('building.complete', 'population.arrive', 'population.energy');
    drop index desire_paths_notification;
    drop index science_activities_trips_started;
    drop index garden_harvests_started;
    drop index deposit_extractions_started;
    drop table world_desire_state;
    drop table world_desire_missions;
    drop table world_desire_edges;
  `.execute(db);
}
