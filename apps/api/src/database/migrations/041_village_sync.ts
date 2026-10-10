import { sql, type Kysely } from 'kysely';

// Append-only commit markers avoid a shared world counter lock after deposit
// locks. COUNT, not MAX(sequence), remains correct when commits are reordered.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table village_sync_changes (
    world_id uuid not null references worlds(id) on delete cascade,
    transaction_id bigint not null,
    primary key (world_id, transaction_id)
  );
  create function mark_village_sync_change() returns trigger language plpgsql as $$
  declare wid uuid;
  begin
    if TG_OP = 'UPDATE' and to_jsonb(OLD) = to_jsonb(NEW) then return NEW; end if;
    if TG_TABLE_NAME = 'worlds' then wid := NEW.id;
    elsif TG_OP = 'DELETE' then wid := OLD.world_id;
    else wid := NEW.world_id; end if;
    -- Cascaded cleanup of a deleted world must not resurrect its marker.
    if exists(select 1 from worlds where id = wid) then
      insert into village_sync_changes(world_id, transaction_id)
      values(wid, txid_current()) on conflict do nothing;
    end if;
    return null;
  end $$;
  do $$ declare tab text; begin
    foreach tab in array array[
      'villages','buildings','world_chunks','world_clearings','world_features','world_cell_occupancies',
      'village_resources','village_resource_flows','building_resource_buffers','building_expansions',
      'population_cohorts','village_populations','stone_deposits','woodland_deposits','deposit_extractions',
      'extraction_worksites','extraction_worksite_targets','building_hidden_supplies','garden_harvests',
      'garden_plots','village_accomplishments','player_science','science_programs','science_contributions',
      'science_activities','science_places','science_village_reports','exploitation_orders',
      'processing_orders','processing_lots','market_exchanges','village_infrastructure','world_factory_settings',
      'world_spawn_terraces','world_rc1_resources','village_starter_installations','world_generation_candidates'
    ] loop
      execute format('create trigger village_sync_change after insert or update or delete on %I for each row execute function mark_village_sync_change()', tab);
    end loop;
  end $$;
  create trigger village_sync_change after insert or update on worlds for each row execute function mark_village_sync_change();
  `.execute(db);
  // Catalogues have no world_id. A change invalidates each world's projection;
  // receipts, sessions and scheduler notifications intentionally do not.
  await sql`create function mark_village_sync_catalog() returns trigger language plpgsql as $$
  begin
    insert into village_sync_changes(world_id,transaction_id)
      select id,txid_current() from worlds on conflict do nothing;
    return null;
  end $$;
  do $$ declare tab text; begin
    foreach tab in array array['resource_types','building_types','building_type_levels','building_level_costs',
      'building_level_production','building_variant_costs','processing_recipes','oracle_market_resources'] loop
      execute format('create trigger village_sync_catalog after insert or update or delete on %I for each statement execute function mark_village_sync_catalog()',tab);
    end loop;
  end $$;`.execute(db);
}
