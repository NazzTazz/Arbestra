import { sql, type Kysely } from 'kysely';

/** A tree row alone (first lot, debit, felling, stump removal) now reaches the V2
 * journal: it touches the same references as its case row (woodland_deposits in
 * 054), the features and cells of the case, which the spatial readers rebuild
 * `deposit.trees` from. Until now this relied on every server write also
 * updating the case row in the same transaction. A case already gone (cascade
 * of its deletion) has nothing to publish. Additive only. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create function game_sync_woodland_tree_change() returns trigger language plpgsql as $$
    declare row record; place record;
    begin
      if TG_OP='UPDATE' and to_jsonb(OLD)=to_jsonb(NEW) then return null; end if;
      if TG_OP='DELETE' then row:=OLD; else row:=NEW; end if;
      select d.cell_x,d.cell_y into place from woodland_deposits d
        where d.world_id=row.world_id and d.feature_id=row.feature_id;
      if not found then return null; end if;
      perform game_sync_spatial_touch(row.world_id,place.cell_x,place.cell_y,'spatialFeatures',row.feature_id::text);
      perform game_sync_spatial_touch(row.world_id,place.cell_x,place.cell_y,'spatialCells','@cell');
      perform set_config('arbestra.sync_auto_publish','yes',true);
      return null;
    end $$;
    create trigger game_sync_shared after insert or update or delete on woodland_trees
      for each row execute function game_sync_woodland_tree_change();
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger game_sync_shared on woodland_trees;
    drop function game_sync_woodland_tree_change();
  `.execute(db);
}
