import { sql, type Kysely } from 'kysely';
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table village_sync_changes add column navigation_changed boolean not null default false;
 create index village_navigation_changes on village_sync_changes(world_id) where navigation_changed;
 create table expedition_submissions(
 world_id uuid not null references worlds(id) on delete cascade,
 village_id uuid not null references villages(id) on delete cascade,
 account_id uuid not null references accounts(id) on delete cascade,
 command_id uuid not null, request jsonb not null, receipt jsonb not null,
 received_order bigserial not null, created_at timestamptz not null default statement_timestamp(),
 expires_at timestamptz not null default statement_timestamp()+interval '30 seconds',
 attempt integer not null default 0, attempt_token uuid, lease_until timestamptz,
 primary key(world_id,village_id,command_id));
 create index expedition_pending on expedition_submissions(received_order) where receipt->>'status'='pending';
 create index expedition_history on expedition_submissions(world_id,village_id,received_order);
 create function mark_navigation_change() returns trigger language plpgsql as $$
 declare wid uuid; a jsonb; b jsonb; changed boolean := true;
 begin
  if TG_OP='UPDATE' then
   a:=to_jsonb(OLD); b:=to_jsonb(NEW);
   if TG_TABLE_NAME='woodland_deposits' then
    changed:=jsonb_build_array(a->'cleared',a->'cell_x',a->'cell_y',a->'initial_amount',(a->>'remaining_amount')::numeric<=(a->>'initial_amount')::numeric*.1)
     is distinct from jsonb_build_array(b->'cleared',b->'cell_x',b->'cell_y',b->'initial_amount',(b->>'remaining_amount')::numeric<=(b->>'initial_amount')::numeric*.1);
   elsif TG_TABLE_NAME='buildings' then
    changed:=(a-'level'-'target_level'-'status'-'construction_started_at'-'construction_completes_at'-'completed_at') is distinct from (b-'level'-'target_level'-'status'-'construction_started_at'-'construction_completes_at'-'completed_at');
   elsif TG_TABLE_NAME='worlds' then
    changed:=jsonb_build_array(a->'seed',a->'width_cells',a->'height_cells',a->'generation_version',a->'generation_status') is distinct from
     jsonb_build_array(b->'seed',b->'width_cells',b->'height_cells',b->'generation_version',b->'generation_status');
   elsif TG_TABLE_NAME='world_features' then
    changed:=jsonb_build_array(a->'cell_x',a->'cell_y',a->'variant_seed',a->'feature_type_code') is distinct from jsonb_build_array(b->'cell_x',b->'cell_y',b->'variant_seed',b->'feature_type_code');
   elsif TG_TABLE_NAME='village_infrastructure' then
    changed:=jsonb_build_array(a->'plan'->'roads',a->'plan'->'equipment') is distinct from jsonb_build_array(b->'plan'->'roads',b->'plan'->'equipment');
   else changed:=a is distinct from b;
   end if;
  end if;
  if not changed then return null; end if;
  if TG_TABLE_NAME='worlds' then wid:=coalesce(NEW.id,OLD.id);
  elsif TG_OP='DELETE' then wid:=OLD.world_id; else wid:=NEW.world_id; end if;
  if exists(select 1 from worlds where id=wid) then
   insert into village_sync_changes(world_id,transaction_id,navigation_changed) values(wid,txid_current(),true)
    on conflict(world_id,transaction_id) do update set navigation_changed=true;
  end if;
  return null;
 end $$;
 do $$ declare tab text; begin
  foreach tab in array array['worlds','buildings','world_chunks','world_cell_occupancies','world_clearings','world_features','woodland_deposits','village_infrastructure','world_spawn_terraces','world_rc1_resources','world_generation_candidates','world_factory_settings'] loop
   execute format('create trigger navigation_change after insert or update or delete on %I for each row execute function mark_navigation_change()',tab);
  end loop;
 end $$;
 create function notify_expedition_receipt() returns trigger language plpgsql as $$
 begin
  if TG_OP='INSERT' or NEW.receipt is distinct from OLD.receipt then
   perform pg_notify('arbestra_expeditions',json_build_object('worldId',NEW.world_id,'villageId',NEW.village_id)::text);
  end if; return null;
 end $$;
 create trigger expedition_receipt_changed after insert or update on expedition_submissions for each row execute function notify_expedition_receipt();
 `.execute(db);
}
