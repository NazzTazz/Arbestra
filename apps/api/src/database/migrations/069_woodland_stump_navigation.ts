import { sql, type Kysely } from 'kysely';

/** A trunk leaves the navigation when its stump is removed, tree by tree
 * (slice 2e of docs/PLAN-BOIS-ARBRE-TRANCHE-2.md; docs/SPEC-BOIS-ARBRE-UNITE.md:
 * only trunks block, a felled tree stays an obstacle until its stump goes),
 * even while its case still holds other trees or stumps and stays occupied.
 *
 * Only the removal (or return) of a stump moves the navigation: felling a tree
 * or debiting a lot changes nothing physical. RC1 trees touch their own trunk
 * box (same radius as the clearing of 046); the three trees of a starter
 * supplement touch the box of their case. A world without RC1 forest has no
 * trunk in its navigation (its case blocks its cell until cleared): nothing to
 * do there. The partial index serves the per-world reads of removed stumps
 * (RC1 ground, its version, the navigation context). Additive only. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create index woodland_trees_removed_stumps on woodland_trees(world_id, feature_id, tree_index)
      where stump_removed_at is not null;
    create function woodland_stump_navigation_change() returns trigger language plpgsql as $$
    declare row record; resource record; t jsonb; cell record;
    begin
      if TG_OP = 'UPDATE' and (OLD.stump_removed_at is null) = (NEW.stump_removed_at is null) then return null; end if;
      if TG_OP = 'INSERT' and NEW.stump_removed_at is null then return null; end if;
      if TG_OP = 'DELETE' and OLD.stump_removed_at is null then return null; end if;
      if TG_OP = 'DELETE' then row := OLD; else row := NEW; end if;
      -- A world being deleted cascades here: nothing to invalidate.
      if not exists (select 1 from worlds where id = row.world_id) then return null; end if;
      select r.tree_indices into resource from world_rc1_resources r
        where r.world_id = row.world_id and r.feature_id = row.feature_id;
      if not found then return null; end if;
      if jsonb_array_length(coalesce(resource.tree_indices, '[]')) > 0 then
        select candidate.artifact->'forest'->'trees'->(row.tree_index) into t
          from world_generation_candidates candidate where candidate.world_id = row.world_id;
        if t is null or t = 'null'::jsonb then return null; end if;
        perform navigation_touch_box(row.world_id, (t->>'x')::float8, (t->>'y')::float8,
          .19/2.5*(t->>'crown')::float8*(t->>'size')::float8+1.0/8);
      else
        select d.cell_x, d.cell_y into cell from woodland_deposits d
          where d.world_id = row.world_id and d.feature_id = row.feature_id;
        if found then perform navigation_touch_box(row.world_id, cell.cell_x, cell.cell_y, 1); end if;
      end if;
      insert into village_sync_changes(world_id, transaction_id, navigation_changed)
        values (row.world_id, txid_current(), true)
        on conflict (world_id, transaction_id) do update set navigation_changed = true;
      return null;
    end $$;
    create trigger woodland_stump_navigation_change after insert or update of stump_removed_at or delete on woodland_trees
      for each row execute function woodland_stump_navigation_change();
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger woodland_stump_navigation_change on woodland_trees;
    drop function woodland_stump_navigation_change();
    drop index woodland_trees_removed_stumps;
  `.execute(db);
}
