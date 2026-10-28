import { sql, type Kysely } from 'kysely';

/** The tree as the wood harvest unit (docs/SPEC-BOIS-ARBRE-UNITE.md). A row
 * exists from a tree's first lot on: without one, the tree stands with its
 * full 500 units. Felled, its trunk on the ground holds what remains; at 0
 * only a stump is left, still an obstacle until it is removed. Lots and
 * worksite targets name the trees they aim at; null keeps the historical
 * meaning (every tree of the cell, in RC1 order). Schema only: nothing
 * writes or reads it until the switch (slice 2b). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table woodland_trees (
      world_id uuid not null,
      feature_id uuid not null,
      tree_index integer not null check (tree_index >= 0),
      remaining_amount integer not null check (remaining_amount between 0 and 500),
      reserved_amount integer not null default 0
        check (reserved_amount >= 0 and reserved_amount <= remaining_amount),
      felled_at timestamptz not null,
      stump_removed_at timestamptz,
      revision bigint not null default 1,
      updated_at timestamptz not null default statement_timestamp(),
      primary key (world_id, feature_id, tree_index),
      foreign key (world_id, feature_id) references woodland_deposits(world_id, feature_id) on delete cascade,
      check (stump_removed_at is null or (remaining_amount = 0 and reserved_amount = 0))
    );
    alter table deposit_extractions add column tree_index integer check (tree_index >= 0);
    alter table extraction_worksite_targets add column tree_indices integer[];
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table extraction_worksite_targets drop column tree_indices;
    alter table deposit_extractions drop column tree_index;
    drop table woodland_trees;
  `.execute(db);
}
