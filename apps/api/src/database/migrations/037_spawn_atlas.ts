import { sql, type Kysely } from 'kysely';
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table world_atlas_presentations (
      world_id uuid primary key references worlds(id) on delete cascade,
      title text not null check(length(title) between 1 and 80),
      slogan text not null check(length(slogan) <= 180)
    );
    create table village_spawn_territories (
      village_id uuid primary key,
      world_id uuid not null references worlds(id) on delete cascade,
      points jsonb not null check(jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 3 and 32),
      foreign key(world_id, village_id) references villages(world_id, id) on delete cascade
    );
    create index village_spawn_territories_world on village_spawn_territories(world_id);
  `.execute(db);
}
