import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>) {
  await sql`
    alter table processing_orders drop constraint processing_orders_requested_lots_check;
    alter table processing_orders add constraint processing_orders_requested_lots_check check(requested_lots>0);
    alter table processing_lots drop constraint processing_lots_lot_number_check;
    alter table processing_lots add constraint processing_lots_lot_number_check check(lot_number>0);
  `.execute(db);
}
