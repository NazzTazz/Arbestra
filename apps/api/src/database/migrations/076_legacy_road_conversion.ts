import { sql, type Kysely, type Transaction } from 'kysely';

import type { Database } from '../schema.js';
import { convertLegacyRoads, revertLegacyRoadConversion } from '../../modules/villages/road-conversion.js';

/** Conversion of the legacy road plans (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md
 * §7, S3). 075 is never used: migrations stay strictly ordered.
 *
 * Each village plan of 028 holding roads, equipment, lighting or a stone
 * reserve becomes road cells (073) and road anchors (074); the reserve is
 * dropped without refund (Tristan, 30 October) and the plan is emptied with a new revision, so it
 * is neither drawn nor navigated twice. All writes go through the V2 triggers
 * and are published at commit. The former plan, the created cells, the
 * anchors written or cleaned and the credit are kept in
 * `road_conversion_backups` for the rollback window: `down` restores them. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table road_conversion_backups(
      world_id uuid not null,
      village_id uuid not null,
      plan jsonb not null,
      created_cells jsonb not null,
      anchors jsonb not null,
      stone_credit integer not null check(stone_credit >= 0),
      report jsonb not null,
      converted_at timestamptz not null default statement_timestamp(),
      primary key(world_id,village_id),
      foreign key(world_id,village_id) references villages(world_id,id) on delete cascade
    );
  `.execute(db);
  // The migrator runs every migration inside one transaction (transactional DDL).
  const reports = await convertLegacyRoads(db as unknown as Transaction<Database>);
  const cells = reports.reduce((n, r) => n + r.cells.created, 0);
  console.info(`076_legacy_road_conversion: ${reports.length} village(s), ${cells} road cell(s) created`);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await revertLegacyRoadConversion(db as unknown as Transaction<Database>);
  await sql`drop table road_conversion_backups`.execute(db);
}
