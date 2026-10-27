import { sql, type Kysely } from 'kysely';

/** Wood ever cut from a grove (docs/SPEC-BOSQUETS-SOUCHES-REPOUSSE.md): stored
 * on the grove, raised by each debit of a returned lot, so chunk and snapshot
 * readers do not sum lots for every grove. Lots are kept, so the backfill of
 * debited lots is exact. resource_deposits adds the lots returned but not yet
 * debited, as it already does for the stock and the reservation. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table woodland_deposits add column cut_amount numeric not null default 0;
    update woodland_deposits w set cut_amount=c.amount
      from (select world_id,feature_id,sum(reserved_amount) as amount from deposit_extractions
        where resource_code='wood' and wood_debited_at is not null group by world_id,feature_id) c
      where c.world_id=w.world_id and c.feature_id=w.feature_id;
    create or replace view resource_deposits as
      select world_id,feature_id,cell_x,cell_y,initial_amount,remaining_amount,reserved_amount,revision,updated_at,
        'stone'::text as resource_code, false as cleared, remaining_amount>0 as blocks_cell, 0::bigint as cut_amount
        from stone_deposits
      union all
      select w.world_id,w.feature_id,w.cell_x,w.cell_y,w.initial_amount,
        floor(woodland_stock_at(w,coalesce(nullif(current_setting('arbestra.economy_through',true),'')::timestamptz,statement_timestamp())))::bigint,
        w.reserved_amount-coalesce((select sum(e.reserved_amount) from deposit_extractions e
          where e.world_id=w.world_id and e.feature_id=w.feature_id and e.resource_code='wood'
            and e.wood_debited_at is null and e.completes_at<=coalesce(nullif(current_setting('arbestra.economy_through',true),'')::timestamptz,statement_timestamp())),0)::bigint,
        w.revision,w.updated_at,'wood'::text,w.cleared,
        not w.cleared and woodland_stock_at(w,coalesce(nullif(current_setting('arbestra.economy_through',true),'')::timestamptz,statement_timestamp()))>w.initial_amount::numeric/10,
        floor(w.cut_amount+coalesce((select sum(e.reserved_amount) from deposit_extractions e
          where e.world_id=w.world_id and e.feature_id=w.feature_id and e.resource_code='wood'
            and e.wood_debited_at is null and e.completes_at<=coalesce(nullif(current_setting('arbestra.economy_through',true),'')::timestamptz,statement_timestamp())),0))::bigint
        from woodland_deposits w;
  `.execute(db);
}

export async function down(): Promise<void> {
  throw new Error('Woodland cut amount migration is forward-only.');
}
