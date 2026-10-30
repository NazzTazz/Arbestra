import { sql, type RawBuilder, type Transaction } from 'kysely';
import type { AdminJourney, AdminJourneyEvent, AdminJourneySession } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import type { JourneyJournalStatus } from './journey-journal.js';

/** Player journey read of the NOC (docs/DESIGN-OBSERVABILITE-PARCOURS.md §2.6).
 * Everything is computed at read time over bounded rows: no session table,
 * no economic recomputation. Until presence minutes exist (sub-slice B), a
 * session is a run of the player's commands separated by less than
 * INACTIVITY_MINUTES. */
export const JOURNEY_INACTIVITY_MINUTES = 15;
export const JOURNEY_EVENT_LIMIT = 500;
const SESSION_LIMIT = 200;
const SUBJECT = /^[a-z0-9-]{1,40}$/;
export interface JourneyQuery {
  accountId: string;
  worldId?: string;
  villageId?: string;
  days: number;
}
type EventRow = {
  id: string;
  at: Date;
  source: AdminJourneyEvent['source'];
  type: string;
  subject: string | null;
  outcome: AdminJourneyEvent['outcome'];
  code: string | null;
  attempts: number;
  commandId: string | null;
  worldId: string;
  villageId: string;
};

export async function readJourney(
  tx: Transaction<Database>,
  at: Date,
  query: JourneyQuery,
  options: { admin: boolean; collection: JourneyJournalStatus | undefined },
): Promise<AdminJourney> {
  const account = await tx
    .selectFrom('accounts')
    .select(['id', 'email'])
    .where('id', '=', query.accountId)
    .executeTakeFirst();
  if (!account) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'Compte introuvable.');
  const villages = await tx
    .selectFrom('villages as v')
    .innerJoin('worlds as w', 'w.id', 'v.worldId')
    .select(['v.id', 'v.worldId', 'w.slug as worldSlug', 'v.name'])
    .where('v.ownerAccountId', '=', query.accountId)
    .orderBy('v.createdAt')
    .orderBy('v.id')
    .limit(100)
    .execute();
  if (query.villageId && !villages.some((v) => v.id === query.villageId && v.worldId === query.worldId))
    throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable pour ce compte.');
  const from = new Date(at.getTime() - query.days * 86_400_000);
  const scope = (alias: 'j'): RawBuilder<unknown> =>
    sql.join(
      [
        sql`true`,
        ...(query.worldId ? [sql`${sql.raw(alias)}.world_id=${query.worldId}::uuid`] : []),
        ...(query.villageId ? [sql`${sql.raw(alias)}.village_id=${query.villageId}::uuid`] : []),
      ],
      sql` and `,
    );
  // Commands of the account in range, numbered into sessions: a gap of
  // INACTIVITY_MINUTES or more starts a new one.
  const commands = sql`with e as (
      select id,type,outcome,code,occurred_at from player_journey_events j
      where j.account_id=${query.accountId}::uuid and j.source='command' and j.occurred_at>=${from} and ${scope('j')}
    ), g as (
      select *, case when occurred_at-lag(occurred_at) over (order by occurred_at,id)
        < make_interval(mins=>${JOURNEY_INACTIVITY_MINUTES}) then 0 else 1 end as brk from e
    ) select *, sum(brk) over (order by occurred_at,id rows unbounded preceding)::integer as sid from g`;
  const sessionRows = (
    await sql<{
      sid: number;
      startedAt: Date;
      lastActivityAt: Date;
      activeMinutes: number;
      actions: number;
      refused: number;
    }>`with c as (${commands}) select sid, min(occurred_at) as started_at, max(occurred_at) as last_activity_at,
      count(distinct date_trunc('minute',occurred_at))::integer as active_minutes, count(*)::integer as actions,
      count(*) filter(where outcome='rejected')::integer as refused
      from c group by sid order by sid desc limit ${SESSION_LIMIT + 1}`.execute(tx)
  ).rows;
  const sessions: AdminJourneySession[] = sessionRows.slice(0, SESSION_LIMIT).map((s) => ({
    index: s.sid,
    startedAt: s.startedAt.toISOString(),
    lastActivityAt: s.lastActivityAt.toISOString(),
    endedAt: new Date(s.lastActivityAt.getTime() + 60_000).toISOString(),
    activeMinutes: s.activeMinutes,
    actions: s.actions,
    refused: s.refused,
    ongoing: at.getTime() - s.lastActivityAt.getTime() < JOURNEY_INACTIVITY_MINUTES * 60_000,
  }));
  const byType = (
    await sql<{
      type: string;
      actions: number;
      refused: number;
      sessions: number;
      firstAt: Date;
    }>`with c as (${commands}) select type, count(*)::integer as actions,
      count(*) filter(where outcome='rejected')::integer as refused, count(distinct sid)::integer as sessions,
      min(occurred_at) as first_at from c group by type order by actions desc, type limit 100`.execute(tx)
  ).rows;
  const refusals = (
    await sql<{ type: string; code: string; count: number }>`select type, coalesce(code,'?') as code,
      count(*)::integer as count from player_journey_events j
      where j.account_id=${query.accountId}::uuid and j.source='command' and j.outcome='rejected'
        and j.occurred_at>=${from} and ${scope('j')}
      group by type, code order by count desc, type, code limit 50`.execute(tx)
  ).rows;

  const limit = JOURNEY_EVENT_LIMIT + 1;
  // Deferred and automatic facts of the account's villages (alias v).
  const owned = sql.join(
    [
      sql`v.owner_account_id=${query.accountId}::uuid`,
      ...(query.worldId ? [sql`v.world_id=${query.worldId}::uuid`] : []),
      ...(query.villageId ? [sql`v.id=${query.villageId}::uuid`] : []),
    ],
    sql` and `,
  );
  const rows: EventRow[] = [];
  rows.push(
    ...(
      await sql<EventRow>`select j.id::text, j.occurred_at as at, 'action' as source, j.type, j.subject, j.outcome,
        j.code, j.attempts, j.command_id, j.world_id, j.village_id from player_journey_events j
        where j.account_id=${query.accountId}::uuid and j.source='command' and j.occurred_at>=${from} and ${scope('j')}
        order by j.occurred_at desc, j.id desc limit ${limit}`.execute(tx)
    ).rows,
    // The latest command on a building owns its completion (construction,
    // upgrade or expansion), completed after that command was received.
    ...(
      await sql<EventRow>`select 'building:'||r.command_id as id, b.completed_at as at, 'deferred' as source,
        'building.complete' as type, b.building_type as subject, 'completed' as outcome, null as code,
        1 as attempts, r.command_id, r.world_id, r.village_id
        from villages v join building_command_receipts r on r.world_id=v.world_id and r.village_id=v.id
        join buildings b on b.world_id=r.world_id and b.id=r.building_id
        where ${owned} and b.completed_at is not null and b.completed_at>=${from} and b.completed_at>=r.created_at
          and not exists(select 1 from building_command_receipts n where n.world_id=r.world_id
            and n.building_id=r.building_id and n.created_at>r.created_at)
        order by b.completed_at desc limit ${limit}`.execute(tx)
    ).rows,
    ...(
      await sql<EventRow>`select 'leveling:'||l.id as id, l.completed_at as at, 'deferred' as source,
        'leveling.complete' as type, l.request->>'buildingType' as subject, 'completed' as outcome, null as code,
        1 as attempts, l.command_id, l.world_id, l.village_id
        from villages v join leveling_jobs l on l.world_id=v.world_id and l.village_id=v.id
        where ${owned} and l.completed_at is not null and l.completed_at>=${from}
        order by l.completed_at desc limit ${limit}`.execute(tx)
    ).rows,
    // A market exchange is only a fact here: no resource, amount or price.
    ...(
      await sql<EventRow>`select 'market:'||m.id as id, m.completed_at as at, 'deferred' as source,
        'market.complete' as type, null as subject, 'completed' as outcome, null as code,
        1 as attempts, m.command_id, m.world_id, m.village_id
        from villages v join market_exchanges m on m.world_id=v.world_id and m.village_id=v.id
        where ${owned} and m.completed_at is not null and m.completed_at>=${from}
        order by m.completed_at desc limit ${limit}`.execute(tx)
    ).rows,
    ...(
      await sql<EventRow>`select 'science:'||s.id as id, s.completed_at as at, 'deferred' as source,
        'science.complete' as type, s.kind as subject, 'completed' as outcome, null as code,
        1 as attempts, null::uuid as command_id, s.world_id, s.village_id
        from villages v join science_activities s on s.world_id=v.world_id and s.village_id=v.id
        where ${owned} and s.completed_at is not null and s.completed_at>=${from}
        order by s.completed_at desc limit ${limit}`.execute(tx)
    ).rows,
    ...(
      await sql<EventRow>`select 'accomplishment:'||a.village_id||':'||a.code as id, a.completed_at as at,
        'automatic' as source, 'accomplishment' as type, a.code as subject, 'completed' as outcome, null as code,
        1 as attempts, null::uuid as command_id, a.world_id, a.village_id
        from villages v join village_accomplishments a on a.world_id=v.world_id and a.village_id=v.id
        where ${owned} and a.completed_at>=${from}
        order by a.completed_at desc limit ${limit}`.execute(tx)
    ).rows,
  );
  rows.sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
  const chronological = [...sessions].reverse();
  const sessionOf = (time: number) =>
    chronological.find((s) => Date.parse(s.startedAt) <= time && time <= Date.parse(s.endedAt))?.index ?? null;
  const events = rows.slice(0, JOURNEY_EVENT_LIMIT).map(
    (r): AdminJourneyEvent => ({
      id: r.id,
      at: r.at.toISOString(),
      source: r.source,
      type: r.type,
      subject: r.subject && SUBJECT.test(r.subject) ? r.subject : null,
      outcome: r.outcome,
      code: r.code,
      attempts: Number(r.attempts),
      commandId: r.commandId,
      worldId: r.worldId,
      villageId: r.villageId,
      session: sessionOf(r.at.getTime()),
    }),
  );
  const oldest = (await sql<{ at: Date | null }>`select min(occurred_at) as at from player_journey_events`.execute(tx))
    .rows[0]!.at;
  return {
    observedAt: at.toISOString(),
    account: { id: account.id, email: account.email, admin: options.admin },
    villages,
    scope: {
      worldId: query.worldId ?? null,
      villageId: query.villageId ?? null,
      from: from.toISOString(),
      days: query.days,
    },
    collection: {
      enabled: options.collection?.enabled ?? false,
      dropped: options.collection?.dropped ?? 0,
      lost: options.collection?.lost ?? 0,
      oldestRetainedAt: oldest?.toISOString() ?? null,
      retentionDays: 90,
      inactivityMinutes: JOURNEY_INACTIVITY_MINUTES,
      note:
        'Sessions déduites des seules commandes du joueur (la présence par minute n’est pas encore collectée) : ' +
        'une pause de 15 min ou plus ouvre une nouvelle session ; durée active = minutes contenant au moins une commande. ' +
        'Les fins différées et accomplissements ne prolongent pas une session.',
    },
    sessions,
    sessionsTruncated: sessionRows.length > SESSION_LIMIT,
    events,
    eventsTruncated: rows.length > JOURNEY_EVENT_LIMIT,
    limit: JOURNEY_EVENT_LIMIT,
    summary: {
      byType: byType.map((t) => ({ ...t, firstAt: t.firstAt.toISOString() })),
      refusals,
    },
  };
}
