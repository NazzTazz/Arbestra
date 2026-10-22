import { sql, type Kysely } from 'kysely';

/** Frozen source-to-projection mapping. A trigger observes every writer,
 * including workers, savepoints and administrative SQL. Readers/activation
 * are separate: installing collection is not a declaration of V2 readiness. */
export const privateSyncSources = [
  ['villages', 'identity', 'id'],
  ['village_resources', 'resources', 'resource_code'],
  ['village_resource_flows', 'resources', 'resource_code'],
  ['population_cohorts', 'cohorts', 'id'],
  ['population_cohorts', 'populationSummary', '*'],
  ['population_cohorts', 'restHousing', '?rest_building_id'],
  ['village_populations', 'populationSummary', '*'],
  ['buildings', 'buildings', 'id'],
  ['buildings', 'populationSummary', '*'],
  ['buildings', 'restHousing', 'id'],
  ['building_expansions', 'buildings', 'building_id'],
  ['building_expansions', 'buildingExpansions', 'id'],
  ['building_resource_buffers', 'buildings', 'building_id'],
  ['building_hidden_supplies', 'buildings', 'building_id'],
  ['garden_plots', 'gardenPlots', '@cell'],
  ['garden_harvests', 'gardenHarvests', 'id'],
  ['garden_harvests', 'exploitationOrders', '?exploitation_order_id'],
  ['deposit_extractions', 'extractions', 'id'],
  ['deposit_extractions', 'worksites', '?worksite_id'],
  ['extraction_worksites', 'worksites', 'id'],
  ['extraction_worksites', 'exploitationOrders', '?exploitation_order_id'],
  ['extraction_worksites', 'extractionPools', '?pool_resource'],
  ['extraction_worksite_targets', 'worksites', 'worksite_id'],
  ['extraction_pools', 'extractionPools', 'resource_code'],
  ['exploitation_orders', 'exploitationOrders', 'id'],
  ['leveling_jobs', 'levelingJobs', 'id'],
  ['processing_orders', 'processingOrders', 'id'],
  ['processing_lots', 'processingOrders', 'order_id'],
  ['market_exchanges', 'marketExchanges', 'id'],
  ['trade_offers', 'tradeOffers', 'id'],
  ['trade_journeys', 'tradeJourneys', 'id'],
  ['trade_deliveries', 'tradeJourneys', 'journey_id'],
  ['science_contributions', 'scienceContributions', 'building_id'],
  ['science_activities', 'scienceActivities', 'id'],
  ['village_accomplishments', 'accomplishments', 'code'],
  ['village_infrastructure', 'infrastructure', '*'],
  ['village_starter_installations', 'installation', '*'],
  // Idempotency receipts are queried separately. Their insertion alone does
  // not change a rendered entity; the same transaction's business writes do.
  // Pending intent workflows keep their own receipt/status transport until
  // their command family migrates, rather than masquerading as village state.
] as const;
export const privateSyncIndirectSources = ['world_cell_occupancies', 'stone_deposits', 'woodland_deposits'] as const;
export const privateSyncLookupTables = ['building_level_production'] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create function game_sync_private_change() returns trigger language plpgsql as $$
    declare item jsonb; wid uuid; vid text; entity text; site record; derived record;
    begin
      if TG_OP='UPDATE' and to_jsonb(OLD)=to_jsonb(NEW) then return null; end if;
      if TG_OP='UPDATE' and TG_TABLE_NAME='villages' and
        to_jsonb(OLD)->'economy_activated_at' is distinct from to_jsonb(NEW)->'economy_activated_at' then
        perform game_sync_touch((to_jsonb(NEW)->>'world_id')::uuid,'village',to_jsonb(NEW)->>'id','resources','wood');
        perform set_config('arbestra.sync_auto_publish','yes',true);
      end if;
      if TG_OP='UPDATE' and TG_TABLE_NAME='villages' and
        (to_jsonb(OLD)->'name',to_jsonb(OLD)->'anchor_cell_x',to_jsonb(OLD)->'anchor_cell_y',to_jsonb(OLD)->'owner_account_id')
        is not distinct from
        (to_jsonb(NEW)->'name',to_jsonb(NEW)->'anchor_cell_x',to_jsonb(NEW)->'anchor_cell_y',to_jsonb(NEW)->'owner_account_id')
      then return null; end if;
      if TG_TABLE_NAME='buildings' and TG_ARGV[0] in ('populationSummary','restHousing') then
        if TG_OP='UPDATE' and
          (to_jsonb(OLD)->'building_type',to_jsonb(OLD)->'level',to_jsonb(OLD)->'status',to_jsonb(OLD)->'target_level',to_jsonb(OLD)->'village_id')
          is not distinct from
          (to_jsonb(NEW)->'building_type',to_jsonb(NEW)->'level',to_jsonb(NEW)->'status',to_jsonb(NEW)->'target_level',to_jsonb(NEW)->'village_id')
        then return null; end if;
        if coalesce(to_jsonb(NEW)->>'building_type','') not in ('town-hall','dwelling')
          and coalesce(to_jsonb(OLD)->>'building_type','') not in ('town-hall','dwelling') then return null; end if;
      end if;
      -- Touch both owners/keys on a move. A deletion is retained as a key;
      -- the coherent reader returns its tombstone if the entity is absent.
      for item in select value from jsonb_array_elements(case TG_OP
        when 'INSERT' then jsonb_build_array(to_jsonb(NEW))
        when 'DELETE' then jsonb_build_array(to_jsonb(OLD))
        else jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) end)
      loop
        wid := (item->>'world_id')::uuid;
        vid := case when TG_TABLE_NAME='villages' then item->>'id' else item->>'village_id' end;
        entity := case when TG_ARGV[1]='*' then '*'
          when TG_ARGV[1]='@cell' then (item->>'cell_x')||','||(item->>'cell_y')
          when left(TG_ARGV[1],1)='?' then item->>substring(TG_ARGV[1] from 2)
          else item->>TG_ARGV[1] end;
        if entity is null and left(TG_ARGV[1],1)='?' then continue; end if;
        if wid is null or vid is null or entity is null then
          raise exception 'Incomplete synchronization source: %', TG_TABLE_NAME;
        end if;
        perform game_sync_touch(wid,'village',vid,TG_ARGV[0],entity);
        if TG_TABLE_NAME='buildings' and TG_ARGV[0]='buildings' then
          for derived in select g.village_id,g.cell_x,g.cell_y from garden_plots g
            where g.world_id=wid and g.building_id=(item->>'id')::uuid
          loop
            perform game_sync_touch(wid,'village',derived.village_id::text,'gardenPlots',derived.cell_x::text||','||derived.cell_y::text);
          end loop;
          if item->>'status'='completed' or item->>'target_level' is not null then
            for derived in select f.resource_code from village_resource_flows f
              join villages v on v.world_id=f.world_id and v.id=f.village_id
              join building_level_production p on p.resource_code=f.resource_code
                and p.building_type_code=item->>'building_type' and p.level=(item->>'level')::int
              where f.world_id=wid and f.village_id=vid::uuid and f.production_updated_at is not null
                and (f.resource_code<>'wood' or v.economy_activated_at is null)
            loop perform game_sync_touch(wid,'village',vid,'resources',derived.resource_code); end loop;
          end if;
        end if;
        if TG_ARGV[0]='worksites' and TG_TABLE_NAME in ('deposit_extractions','extraction_worksite_targets') then
          select pool_resource,exploitation_order_id into site from extraction_worksites
            where world_id=wid and village_id=vid::uuid and id=(item->>'worksite_id')::uuid;
          if site.pool_resource is not null then
            perform game_sync_touch(wid,'village',vid,'extractionPools',site.pool_resource);
          end if;
          if site.exploitation_order_id is not null then
            perform game_sync_touch(wid,'village',vid,'exploitationOrders',site.exploitation_order_id::text);
          end if;
        end if;
        -- A convoy is also rendered by its destination, without sharing the
        -- originating village's stocks or other private components.
        if TG_TABLE_NAME='trade_journeys' and item->>'destination_village_id' <> vid then
          perform game_sync_touch(wid,'village',item->>'destination_village_id','tradeJourneys',entity);
        end if;
      end loop;
      perform set_config('arbestra.sync_auto_publish','yes',true);
      return null;
    end $$;
    create or replace function game_sync_assert_published() returns trigger language plpgsql as $$
    begin
      -- One deferred event exists per distinct touched key. After terminal
      -- publication, later business writes are rejected by game_sync_touch;
      -- do not rescan the just-deleted pending index for every queued event.
      if current_setting('arbestra.sync_published',true)='yes' then return null; end if;
      if exists(select 1 from game_sync_pending where transaction_id=txid_current()) then
        if current_setting('arbestra.sync_auto_publish',true)='yes' then
          -- Deferred until COMMIT: all ordinary business writes and deferred
          -- checks precede publication, or a later writer aborts the transaction.
          perform game_sync_publish();
        else
          raise exception 'Synchronization changes were not published';
        end if;
      end if;
      return null;
    end $$;
    create function game_sync_private_indirect_change() returns trigger language plpgsql as $$
    declare item jsonb; wid uuid; affected record;
    begin
      if TG_OP='UPDATE' and to_jsonb(OLD)=to_jsonb(NEW) then return null; end if;
      for item in select value from jsonb_array_elements(case TG_OP
        when 'INSERT' then jsonb_build_array(to_jsonb(NEW)) when 'DELETE' then jsonb_build_array(to_jsonb(OLD))
        else jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) end)
      loop
        wid := (item->>'world_id')::uuid;
        if TG_TABLE_NAME='world_cell_occupancies' then
          for affected in select village_id,id from building_expansions
            where world_id=wid and id=(item->>'pending_expansion_id')::uuid
          loop
            perform game_sync_touch(wid,'village',affected.village_id::text,'buildingExpansions',affected.id::text);
          end loop;
        else
          -- These projections embed deposit coordinates. A direct admin
          -- update must invalidate them even without changing the mission.
          for affected in select village_id,id from deposit_extractions
            where world_id=wid and feature_id=(item->>'feature_id')::uuid and status='in-progress'
          loop
            perform game_sync_touch(wid,'village',affected.village_id::text,'extractions',affected.id::text);
          end loop;
          for affected in select distinct village_id,worksite_id from extraction_worksite_targets
            where world_id=wid and feature_id=(item->>'feature_id')::uuid
          loop
            perform game_sync_touch(wid,'village',affected.village_id::text,'worksites',affected.worksite_id::text);
          end loop;
        end if;
      end loop;
      perform set_config('arbestra.sync_auto_publish','yes',true);
      return null;
    end $$;
  `.execute(db);
  for (const [table, component, key] of privateSyncSources) {
    // Identifiers are from the frozen migration registry, never user input.
    await sql`create trigger ${sql.id('game_sync_' + component)} after insert or update or delete on ${sql.id(table)}
      for each row execute function game_sync_private_change(${sql.lit(component)}, ${sql.lit(key)})`.execute(db);
  }
  for (const table of privateSyncIndirectSources) {
    await sql`create trigger game_sync_private_indirect after insert or update or delete on ${sql.id(table)}
      for each row execute function game_sync_private_indirect_change()`.execute(db);
  }
}
