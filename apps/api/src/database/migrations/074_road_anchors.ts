import { sql, type Kysely } from 'kysely';

/** Road anchors (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §5, S4a): one row
 * per vertex of the cell grid that a village set explicitly, a single owner per
 * world vertex. `accessory` is a manual accessory (`brazier` for now) or `none`
 * (the village emptied the anchor, suppressing its automatic brazier, which is
 * derived from the road cells and never stored). The legacy JSONB equipment of
 * 028 stays in place until the conversion (S3). Each changed row reaches the
 * private V2 journal through the generic private writer of 053, keyed by its
 * vertex (`anchor_key`, `x,y`). Additive only. */
export const roadAnchorSyncSource = ['road_anchors', 'roadAnchors', 'anchor_key'] as const;

export async function installRoadAnchorSync(db: Kysely<unknown>): Promise<void> {
  const [table, component, key] = roadAnchorSyncSource;
  await sql`create trigger ${sql.id('game_sync_' + component)} after insert or update or delete on ${sql.id(table)}
    for each row execute function game_sync_private_change(${sql.lit(component)}, ${sql.lit(key)})`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table road_anchors(
      world_id uuid not null,
      village_id uuid not null,
      vertex_x integer not null check(vertex_x >= 0),
      vertex_y integer not null check(vertex_y >= 0),
      anchor_key text generated always as (vertex_x::text || ',' || vertex_y::text) stored,
      accessory text not null check(accessory in ('brazier','none')),
      revision integer not null default 1 check(revision >= 1),
      created_at timestamptz not null default statement_timestamp(),
      updated_at timestamptz not null default statement_timestamp(),
      primary key(world_id,vertex_x,vertex_y),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
    create index road_anchors_village on road_anchors(world_id,village_id);
    create table road_anchor_receipts(
      world_id uuid not null,
      village_id uuid not null,
      command_id uuid not null,
      request jsonb not null,
      result jsonb not null,
      created_at timestamptz not null,
      primary key(world_id,village_id,command_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
  `.execute(db);
  await installRoadAnchorSync(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table road_anchor_receipts; drop table road_anchors;`.execute(db);
}
