import { sql, type Kysely } from 'kysely';

/** The wood queue in cut or clear mode, and the cancellation of a gesture
 * (slice 2e of docs/PLAN-BOIS-ARBRE-TRANCHE-2.md). Additive only.
 *
 * A queued wood target names, beside its trees (`tree_indices`), those it
 * clears (`clear_tree_indices`, null: none) and the share of each gesture
 * that queued them (`designations`: [{ commandId, mode, treeIndices }], null
 * for a target queued before this migration). The shares follow the target
 * when another consumer of the queue takes it over, and die with it.
 *
 * A cancellation is stored once per gesture, with its receipt: a replay
 * answers it unchanged. A gesture cancelled before it was processed never
 * queues its wood. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table extraction_worksite_targets add column clear_tree_indices integer[];
    alter table extraction_worksite_targets add column designations jsonb;
    create table harvest_intent_cancellations (
      world_id uuid not null,
      village_id uuid not null,
      command_id uuid not null,
      receipt jsonb not null,
      created_at timestamptz not null default statement_timestamp(),
      primary key (world_id, village_id, command_id),
      foreign key (world_id, village_id) references villages(world_id, id) on delete cascade
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop table harvest_intent_cancellations;
    alter table extraction_worksite_targets drop column designations;
    alter table extraction_worksite_targets drop column clear_tree_indices;
  `.execute(db);
}
