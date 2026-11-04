/** Removes the load-test bots, and only them (docs/TEST-DE-CHARGE.md §3).
 * A bot is an account whose e-mail matches `bot-NNN@load.arbestra.test`
 * exactly; its villages and everything they own go with it. Dry run by
 * default: it prints what would be deleted, table by table. `--apply`
 * deletes in one transaction and checks that nothing is left.
 *
 *   tsx src/cleanup.ts --target local [--world charge] [--apply]
 *
 * Tables, from the schema's foreign keys (081): nearly everything cascades
 * from `villages` (ON DELETE CASCADE) and `accounts`. Deleted explicitly
 * first, because a cascade would hit a RESTRICT or NO ACTION key, or there
 * is no key at all: scheduled notifications (no key: subject or payload
 * naming a bot row), population cohorts (RESTRICT towards extractions),
 * deposit extractions (RESTRICT towards worksites), harvest submissions
 * (village_id without key) and the bots' private V2 streams (keyed by the
 * village id, no key). Refused, never deleted: rows of a real player that
 * point at a bot (a cohort born in a bot village, a convoy towards a bot
 * offer, a clearing claimed by a bot). World data the bots changed stays:
 * terrain heights, felled trees, consumed deposits. */
import { parseArgs } from 'node:util';
import { sql, type Kysely } from 'kysely';
import { createDatabase } from '../../api/src/database/connection.js';
import type { Database } from '../../api/src/database/schema.js';
import { BOT_EMAIL_LIKE, BOT_EMAIL_PATTERN } from './bots.js';
import { databaseUrl, describeDatabase, guard, main } from './cli.js';
import { LoadTargetRefused } from './target.js';

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    'database-url': { type: 'string' },
    world: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'confirm-staging': { type: 'boolean', default: false },
  },
});

interface Selection {
  accounts: string[];
  villages: string[];
  worlds: string[];
}

/** Every row tied to the selection, per table, read from the live schema. */
async function inventory(db: Kysely<Database>, s: Selection) {
  const villageTables = (
    await sql<{ table: string }>`select c.table_name as "table" from information_schema.columns c
      join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name = 'village_id'
      order by 1`.execute(db)
  ).rows.map((r) => r.table);
  const counts: Record<string, number> = {};
  const count = async (label: string, query: ReturnType<typeof sql<{ n: number }>>) => {
    const n = (await query.execute(db)).rows[0]!.n;
    if (n) counts[label] = n;
  };
  for (const table of villageTables)
    await count(
      table,
      sql<{
        n: number;
      }>`select count(*)::int as n from ${sql.table(table)} where village_id = any(${s.villages}::uuid[])`,
    );
  await count(
    'villages',
    sql<{ n: number }>`select count(*)::int as n from villages where id = any(${s.villages}::uuid[])`,
  );
  await count(
    'world_cell_occupancies',
    sql<{ n: number }>`select count(*)::int as n from world_cell_occupancies o join buildings b
      on b.world_id = o.world_id and b.id = o.building_id where b.village_id = any(${s.villages}::uuid[])`,
  );
  await count(
    'scheduled_tasks',
    sql<{ n: number }>`select count(*)::int as n from scheduled_tasks where ${botTasks(s)}`,
  );
  await count(
    'game_sync_streams (flux privés)',
    sql<{ n: number }>`select count(*)::int as n from game_sync_streams
      where stream_kind = 'village' and scope_key = any(${s.villages}::text[])`,
  );
  for (const table of [
    'sessions',
    'world_memberships',
    'harvest_submissions',
    'expedition_submissions',
    'player_journey_events',
  ])
    await count(
      table + ' (par compte)',
      sql<{
        n: number;
      }>`select count(*)::int as n from ${sql.table(table)} where account_id = any(${s.accounts}::uuid[])`,
    );
  counts.accounts = s.accounts.length;
  return counts;
}

/** Notifications of bot rows: no foreign key, so by subject or payload. */
function botTasks(s: Selection) {
  return sql<boolean>`world_id = any(${s.worlds}::uuid[]) and (
    subject_id = any(${s.villages}::uuid[])
    or payload->>'villageId' = any(${s.villages}::text[])
    or subject_id in (select id from bot_rows) or payload->>'worksiteId' in (select id::text from bot_rows)
    or payload->>'exploitationOrderId' in (select id::text from bot_rows))`;
}

/** Real players' rows that point at a bot: never deleted, they block the cleanup. */
async function blockers(db: Kysely<Database>, s: Selection) {
  const rows = (
    await sql<{ label: string; n: number }>`
      select 'population_cohorts nées dans un village bot, hors bots' as label, count(*)::int as n
        from population_cohorts where origin_village_id = any(${s.villages}::uuid[]) and not village_id = any(${s.villages}::uuid[])
      union all
      select 'trade_journeys de joueurs vers une offre bot', count(*)::int
        from trade_journeys where destination_village_id = any(${s.villages}::uuid[]) and not village_id = any(${s.villages}::uuid[])
      union all
      select 'world_clearings réservées par un bot', count(*)::int
        from world_clearings where claimed_village_id = any(${s.villages}::uuid[])
      union all
      select 'world_generation_candidates d''un compte bot', count(*)::int
        from world_generation_candidates where owner_account_id = any(${s.accounts}::uuid[])`.execute(db)
  ).rows;
  return rows.filter((r) => r.n > 0);
}

/** Ids of every bot-owned row that has an `id` column (notification subjects). */
async function createBotRows(db: Kysely<Database>, s: Selection) {
  const tables = (
    await sql<{ table: string }>`select c.table_name as "table" from information_schema.columns c
      join information_schema.columns i on i.table_schema = c.table_schema and i.table_name = c.table_name and i.column_name = 'id'
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name = 'village_id'
        and i.data_type = 'uuid' order by 1`.execute(db)
  ).rows.map((r) => r.table);
  await sql`create temporary table bot_rows (id uuid primary key) on commit drop`.execute(db);
  for (const table of tables)
    await sql`insert into bot_rows select id from ${sql.table(table)} where village_id = any(${s.villages}::uuid[])
      on conflict do nothing`.execute(db);
}

class DryRun extends Error {}

await main(async () => {
  const url = databaseUrl(values);
  const checked = guard({
    target: values.target,
    databaseUrl: url,
    ...(values.world ? { worldSlug: values.world } : {}),
  });
  const db = createDatabase(url);
  let removed: Selection | null = null;
  try {
    await db.transaction().execute(async (tx) => {
      await sql`set local lock_timeout = '10s'`.execute(tx);
      const accounts = (
        await sql<{ id: string; email: string }>`select id, email from accounts where email like ${BOT_EMAIL_LIKE}
          order by id`.execute(tx)
      ).rows.filter((a) => BOT_EMAIL_PATTERN.test(a.email));
      if (!accounts.length)
        throw new LoadTargetRefused(`Aucun compte ne correspond au motif ${BOT_EMAIL_PATTERN} : rien à nettoyer.`);
      const world = values.world
        ? await tx.selectFrom('worlds').select('id').where('slug', '=', values.world).executeTakeFirst()
        : undefined;
      if (values.world && !world) throw new LoadTargetRefused(`Monde ${values.world} introuvable.`);
      // The bots' villages, locked in id order before the shared spatial lock (activateTerrainVertices order).
      const villages = await tx
        .selectFrom('villages')
        .select(['id', 'worldId', 'ownerAccountId', 'name'])
        .where(
          'ownerAccountId',
          'in',
          accounts.map((a) => a.id),
        )
        .$if(Boolean(world), (q) => q.where('worldId', '=', world!.id))
        .orderBy('id')
        .forUpdate()
        .execute();
      const selection: Selection = {
        accounts: accounts.map((a) => a.id),
        villages: villages.map((v) => v.id),
        worlds: [...new Set(villages.map((v) => v.worldId))],
      };
      // A world filter keeps the bot accounts that still own a village in another world.
      if (world) {
        const elsewhere = new Set(
          (
            await tx
              .selectFrom('villages')
              .select('ownerAccountId')
              .where('ownerAccountId', 'in', selection.accounts)
              .where('worldId', '<>', world.id)
              .execute()
          ).map((v) => v.ownerAccountId),
        );
        selection.accounts = selection.accounts.filter((id) => !elsewhere.has(id));
      }
      await createBotRows(tx, selection);
      console.info(
        `Cible ${checked.target}, base ${describeDatabase(url)} : ${accounts.length} comptes bot, ${villages.length} villages` +
          (values.world ? ` dans ${values.world}` : '') +
          `, ${selection.accounts.length} comptes à supprimer.`,
      );
      const before = await inventory(tx, selection);
      console.table(before);
      const blocking = await blockers(tx, selection);
      if (blocking.length) {
        console.table(blocking);
        throw new LoadTargetRefused('Des données de joueurs réels pointent vers des bots : rien n’est supprimé.');
      }
      if (!values.apply) {
        console.info('Essai à blanc : rien n’a été supprimé. Relancez avec --apply pour supprimer ces lignes.');
        // Rolls the read transaction (and its temporary table) back.
        throw new DryRun();
      }
      for (const worldId of selection.worlds)
        await sql`select pg_advisory_xact_lock(hashtextextended(${'infrastructure:' + worldId}, 0))`.execute(tx);
      await sql`delete from scheduled_tasks where ${botTasks(selection)}`.execute(tx);
      await sql`delete from population_cohorts where village_id = any(${selection.villages}::uuid[])`.execute(tx);
      await sql`delete from deposit_extractions where village_id = any(${selection.villages}::uuid[])`.execute(tx);
      await sql`delete from harvest_submissions where village_id = any(${selection.villages}::uuid[])`.execute(tx);
      await sql`delete from villages where id = any(${selection.villages}::uuid[])`.execute(tx);
      await sql`delete from accounts where id = any(${selection.accounts}::uuid[])`.execute(tx);
      // The deletions above queue changes of the private streams, published at
      // commit by a deferred trigger (051, 053), which would recreate the streams:
      // publish them now, then remove the bots' private streams.
      await sql`select game_sync_publish()`.execute(tx);
      await sql`delete from game_sync_streams where stream_kind = 'village' and scope_key = any(${selection.villages}::text[])`.execute(
        tx,
      );
      const after = await inventory(tx, selection);
      delete after.accounts;
      const left = (
        await sql<{
          n: number;
        }>`select count(*)::int as n from accounts where id = any(${selection.accounts}::uuid[])`.execute(tx)
      ).rows[0]!.n;
      if (Object.keys(after).length || left) {
        console.table({ ...after, accounts: left });
        throw new Error('Des lignes des bots restent après suppression : transaction annulée.');
      }
      removed = selection;
    });
    if (removed) {
      // After commit: the deferred publication must not have recreated anything.
      const selection = removed;
      const after = await db.transaction().execute(async (tx) => {
        await createBotRows(tx, selection);
        return inventory(tx, selection);
      });
      delete after.accounts;
      if (Object.keys(after).length) {
        console.table(after);
        throw new Error('Des lignes des bots sont réapparues après la validation.');
      }
      console.info('Supprimé. Vérification après validation : plus aucune ligne des bots sélectionnés.');
    }
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
  } finally {
    await db.destroy();
  }
});
