import { sql, type Kysely } from 'kysely';

/** Road cells and road anchors enter the world navigation (navigation T1,
 * docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §3): trade and expeditions now plan
 * over them (a road shortens travel, decision 8; an accessory blocks), so a
 * change must invalidate what was prepared over the old ground, as 069 does for
 * stumps. Each changed row touches the chunk versions around it (route
 * certificates of trade, 046) and marks the transaction's navigation change
 * (the revision of the navigation context, expeditions). A road cell paints
 * its arms up to the neighbouring cells: radius 1. An anchor is a cell corner
 * whose accessory blocks at its sub-point: radius 1 around the corner.
 * Writers of road cells and anchors already hold their zones exclusively;
 * both writes are keyed by the transaction, so they add no contention between
 * transactions. Additive only. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create function road_navigation_change() returns trigger language plpgsql as $$
    declare row record;
    begin
      if TG_OP = 'DELETE' then row := OLD; else row := NEW; end if;
      -- A world being deleted cascades here: nothing to invalidate.
      if not exists (select 1 from worlds where id = row.world_id) then return null; end if;
      if TG_TABLE_NAME = 'road_cells' then
        perform navigation_touch_box(row.world_id, row.cell_x, row.cell_y, 1);
        if TG_OP = 'UPDATE' and (OLD.cell_x, OLD.cell_y) is distinct from (NEW.cell_x, NEW.cell_y) then
          perform navigation_touch_box(OLD.world_id, OLD.cell_x, OLD.cell_y, 1);
        end if;
      else
        perform navigation_touch_box(row.world_id, row.vertex_x - 0.5, row.vertex_y - 0.5, 1);
        if TG_OP = 'UPDATE' and (OLD.vertex_x, OLD.vertex_y) is distinct from (NEW.vertex_x, NEW.vertex_y) then
          perform navigation_touch_box(OLD.world_id, OLD.vertex_x - 0.5, OLD.vertex_y - 0.5, 1);
        end if;
      end if;
      insert into village_sync_changes(world_id, transaction_id, navigation_changed)
        values (row.world_id, txid_current(), true)
        on conflict (world_id, transaction_id) do update set navigation_changed = true;
      return null;
    end $$;
    create trigger road_cell_navigation_change after insert or update or delete on road_cells
      for each row execute function road_navigation_change();
    create trigger road_anchor_navigation_change after insert or update or delete on road_anchors
      for each row execute function road_navigation_change();
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger road_anchor_navigation_change on road_anchors;
    drop trigger road_cell_navigation_change on road_cells;
    drop function road_navigation_change();
  `.execute(db);
}
