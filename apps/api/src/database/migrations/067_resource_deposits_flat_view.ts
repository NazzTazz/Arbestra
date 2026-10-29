import { sql, type Kysely } from 'kysely';

/** Restores indexed lookups of `resource_deposits` inside joins. Migration 065
 * computed the lots due of each wood case with a `cross join lateral`: a union
 * branch with two FROM items is no longer flattened by PostgreSQL, so a join
 * that looks cases up by identifier (worksite targets, running lots, the
 * features of a chunk) evaluated the whole view, every wood case of every world,
 * for each lookup (168 ms for five cases on the test database, against 0.2 ms
 * by key). The same values are computed again with scalar subqueries, as in
 * 062, so the branch has a single FROM item and is flattened again. Same
 * columns, same types, same order: a view replacement only. */
const due = `coalesce((select sum(e.reserved_amount) from deposit_extractions e
  where e.world_id=w.world_id and e.feature_id=w.feature_id and e.resource_code='wood'
    and e.wood_debited_at is null
    and e.completes_at<=coalesce(nullif(current_setting('arbestra.economy_through',true),'')::timestamptz,statement_timestamp())),0)`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create or replace view resource_deposits as
      select world_id,feature_id,cell_x,cell_y,initial_amount,remaining_amount,reserved_amount,revision,updated_at,
        'stone'::text as resource_code, false as cleared, remaining_amount>0 as blocks_cell, 0::bigint as cut_amount
        from stone_deposits
      union all
      select w.world_id,w.feature_id,w.cell_x,w.cell_y,w.initial_amount,
        (floor(w.remaining_amount)-${sql.raw(due)})::bigint,
        (w.reserved_amount-${sql.raw(due)})::bigint,
        w.revision,w.updated_at,'wood'::text,w.cleared,
        not w.cleared,
        (floor(w.cut_amount)+${sql.raw(due)})::bigint
        from woodland_deposits w;
  `.execute(db);
}

export async function down(): Promise<void> {
  throw new Error('The flat resource_deposits view is forward-only.');
}
