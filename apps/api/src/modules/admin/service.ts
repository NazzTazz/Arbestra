import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely';
import type {
  AdminAccount,
  AdminAccountDetail,
  AdminAccounts,
  AdminActivities,
  AdminActivity,
  AdminActivityDetail,
  AdminDiagnostic,
  AdminJourney,
  AdminOverview,
  AdminVillage,
  AdminVillageDetail,
  AdminWorld,
  AdminWorldDetail,
  AdminWorlds,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { readJourney, type JourneyQuery } from './journey-reads.js';
import type { JourneyJournalStatus } from './journey-journal.js';

export const ADMIN_CACHE_MS = 15_000;
const LIST_LIMIT = 100;
const ACTIVITY_LIMIT = 50;
const EXPEDITION_SAMPLE = 1_000;
const ACTIVITY_NOTE =
  'Reçus d’expédition récents, activités scientifiques en cours et notifications en attente. Liste bornée, sans historique exhaustif des activités achevées.';
type Reader = Transaction<Database>;
type Scope = { worldId?: string; villageId?: string; accountId?: string };
export type ActivityFilter = Scope & { kind?: AdminActivity['kind'] };
type ActivityRow = Omit<AdminActivity, 'startedAt' | 'dueAt' | 'completedAt'> & {
  startedAt: Date;
  dueAt: Date | null;
  completedAt: Date | null;
};
const iso = (value: Date | null) => value?.toISOString() ?? null;
const activity = (row: ActivityRow): AdminActivity => ({
  ...row,
  startedAt: row.startedAt.toISOString(),
  dueAt: iso(row.dueAt),
  completedAt: iso(row.completedAt),
});

/** A failed load never becomes a successful zero. Shared reads and retained values are bounded. */
export class AdminReadCache {
  private readonly values = new Map<string, { expiresAt: number; value: unknown }>();
  private readonly flights = new Map<string, Promise<unknown>>();
  constructor(
    private readonly now = Date.now,
    private readonly ttl = ADMIN_CACHE_MS,
  ) {}
  async read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const prior = this.values.get(key);
    if (prior && prior.expiresAt > this.now()) return prior.value as T;
    const flight = this.flights.get(key);
    if (flight) return flight as Promise<T>;
    if (this.flights.size >= 4)
      throw new HttpError(503, 'ADMIN_BUSY', 'Diagnostics occupés. Réessayez dans quelques secondes.');
    const next = Promise.resolve()
      .then(load)
      .then((value) => {
        this.values.delete(key);
        this.values.set(key, { expiresAt: this.now() + this.ttl, value });
        while (this.values.size > 128) this.values.delete(this.values.keys().next().value!);
        return value;
      })
      .finally(() => this.flights.delete(key));
    this.flights.set(key, next);
    return next;
  }
}

function conditions(scope: Scope, alias: string): RawBuilder<unknown> {
  const parts: RawBuilder<unknown>[] = [];
  if (scope.worldId) parts.push(sql`${sql.ref(alias + '.worldId')} = ${scope.worldId}::uuid`);
  if (scope.villageId) parts.push(sql`${sql.ref(alias + '.villageId')} = ${scope.villageId}::uuid`);
  if (scope.accountId) parts.push(sql`${sql.ref(alias + '.accountId')} = ${scope.accountId}::uuid`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

// Only identifiers and typed metadata cross this boundary. Payloads, hashes,
// paths, SQL errors and receipt messages are deliberately never selected.
function expeditionRows(scope: Scope, id?: string) {
  return sql<ActivityRow>`select e.command_id as id, 'expedition'::text as kind, e.world_id, e.village_id, e.account_id,
    case when e.request->>'action'='survey' then 'survey' else 'explore' end as label,
    case when e.receipt->>'status'='admitted' and a.id is not null then a.status else e.receipt->>'status' end as status,
    e.receipt->>'status' as receipt_status, e.created_at as started_at,
    case when e.receipt->>'status'='pending' then e.expires_at else a.completes_at end as due_at,
    a.completed_at, e.attempt as attempts,
    case when e.receipt->>'code' ~ '^[A-Z][A-Z0-9_]{0,79}$' then e.receipt->>'code' else null end as error_code,
    a.id as related_activity_id
    from expedition_submissions e left join science_activities a
      on a.world_id=e.world_id and a.village_id=e.village_id and a.id::text=e.receipt->>'activityId'
    where ${conditions(scope, 'e')} ${id ? sql`and e.command_id=${id}::uuid` : sql``}
    order by e.received_order desc limit ${id ? 2 : ACTIVITY_LIMIT + 1}`;
}
function scienceRows(scope: Scope, id?: string) {
  return sql<ActivityRow>`select s.id, 'science'::text as kind, s.world_id, s.village_id, s.account_id,
    s.kind as label, s.status, null::text as receipt_status, s.started_at, s.completes_at as due_at, s.completed_at,
    0::integer as attempts, null::text as error_code, null::uuid as related_activity_id
    from science_activities s where ${conditions(scope, 's')} ${id ? sql`and s.id=${id}::uuid` : sql`and s.status='in-progress'`}
    order by s.started_at desc,s.id desc limit ${id ? 1 : ACTIVITY_LIMIT + 1}`;
}
function taskRows(scope: Scope, id?: string) {
  // Resolve each subject within its world, exactly as handlers do. Missing
  // historical subjects remain unknown instead of being assigned to a village.
  return sql<ActivityRow>`select t.id, 'task'::text as kind, t.world_id, v.id as village_id,
    v.owner_account_id as account_id, t.task_type as label,
    case when t.completed_at is not null then 'completed' when t.last_error is not null then 'retrying' else 'pending' end as status,
    null::text as receipt_status, t.created_at as started_at, t.due_at, t.completed_at, t.attempts,
    case when t.last_error is not null then 'TASK_HANDLER_FAILED' else null end as error_code,
    null::uuid as related_activity_id
    from scheduled_tasks t left join villages v on v.world_id=t.world_id and v.id=coalesce(
      (select b.village_id from buildings b where b.world_id=t.world_id and b.id=t.subject_id and t.task_type='building.complete'),
      (select b.village_id from building_expansions b where b.world_id=t.world_id and b.id=t.subject_id and t.task_type='building-expansion.complete'),
      (select h.village_id from garden_harvests h where h.world_id=t.world_id and h.id=t.subject_id and t.task_type='garden.harvest.complete'),
      (select d.village_id from deposit_extractions d where d.world_id=t.world_id and d.id=t.subject_id and t.task_type='deposit.extraction.complete'),
      (select p.village_id from processing_lots p where p.world_id=t.world_id and p.id=t.subject_id and t.task_type='processing.complete'),
      (select m.village_id from market_exchanges m where m.world_id=t.world_id and m.id=t.subject_id and t.task_type='market.deliver'),
      (select w.village_id from extraction_worksites w where w.world_id=t.world_id and w.id::text=t.payload->>'worksiteId'),
      (select o.village_id from exploitation_orders o where o.world_id=t.world_id and o.id::text=t.payload->>'exploitationOrderId'),
      (select z.id from villages z where z.world_id=t.world_id and z.id::text=t.payload->>'villageId')
    )
    where ${scope.worldId ? sql`t.world_id=${scope.worldId}::uuid` : sql`true`}
      ${scope.villageId ? sql`and v.id=${scope.villageId}::uuid` : sql``}
      ${scope.accountId ? sql`and v.owner_account_id=${scope.accountId}::uuid` : sql``}
      ${id ? sql`and t.id=${id}::uuid` : sql`and t.completed_at is null`}
    order by t.due_at,t.id limit ${id ? 1 : ACTIVITY_LIMIT + 1}`;
}
async function activities(tx: Reader, scope: ActivityFilter, id?: string) {
  const rows: ActivityRow[] = [];
  if (!scope.kind || scope.kind === 'expedition') rows.push(...(await expeditionRows(scope, id).execute(tx)).rows);
  if (!scope.kind || scope.kind === 'science') rows.push(...(await scienceRows(scope, id).execute(tx)).rows);
  if (!scope.kind || scope.kind === 'task') rows.push(...(await taskRows(scope, id).execute(tx)).rows);
  rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || a.id.localeCompare(b.id));
  return {
    items: rows.slice(0, ACTIVITY_LIMIT).map(activity),
    truncated: rows.length > ACTIVITY_LIMIT,
    limit: ACTIVITY_LIMIT,
  };
}

function worldRows(id?: string) {
  return sql<
    Omit<AdminWorld, 'createdAt'> & { createdAt: Date }
  >`select w.id,w.slug,w.name,w.is_open,w.generation_status,
    w.generation_version,w.width_cells,w.height_cells,w.created_at,
    (select count(*)::integer from world_memberships m where m.world_id=w.id) as accounts,
    (select count(*)::integer from villages v where v.world_id=w.id) as villages,
    (select count(*)::integer from science_activities s where s.world_id=w.id and s.status='in-progress') as active_science
    from worlds w ${id ? sql`where w.id=${id}::uuid` : sql``} order by w.created_at desc,w.id limit ${id ? 1 : LIST_LIMIT + 1}`;
}
async function villages(tx: Reader, scope: Scope) {
  const rows = await tx
    .selectFrom('villages as v')
    .innerJoin('worlds as w', 'w.id', 'v.worldId')
    .select([
      'v.id',
      'v.worldId',
      'w.slug as worldSlug',
      'v.ownerAccountId',
      'v.name',
      'v.anchorCellX',
      'v.anchorCellY',
    ])
    .select(sql<Date>`${sql.ref('v.createdAt')}`.as('createdAt'))
    .$if(Boolean(scope.worldId), (q) => q.where('v.worldId', '=', scope.worldId!))
    .$if(Boolean(scope.villageId), (q) => q.where('v.id', '=', scope.villageId!))
    .$if(Boolean(scope.accountId), (q) => q.where('v.ownerAccountId', '=', scope.accountId!))
    .orderBy('v.createdAt', 'desc')
    .orderBy('v.id')
    .limit(LIST_LIMIT + 1)
    .execute();
  return {
    items: rows
      .slice(0, LIST_LIMIT)
      .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }) satisfies AdminVillage),
    truncated: rows.length > LIST_LIMIT,
  };
}
function accountRows(query = '', worldId?: string, id?: string) {
  // Literal substring search: user '%' and '_' must not expand to arbitrary scans.
  const search = '%' + query.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  return sql<Omit<AdminAccount, 'createdAt'> & { createdAt: Date }>`select a.id,a.email,a.created_at,
    (select count(*)::integer from world_memberships m where m.account_id=a.id) as worlds,
    (select count(*)::integer from villages v where v.owner_account_id=a.id) as villages
    from accounts a where ${id ? sql`a.id=${id}::uuid` : sql`true`}
      ${query ? sql`and (a.email ilike ${search} or a.id::text=${query} or exists(select 1 from world_memberships m where m.account_id=a.id and m.player_name ilike ${search}))` : sql``}
      ${worldId ? sql`and exists(select 1 from world_memberships m where m.account_id=a.id and m.world_id=${worldId}::uuid)` : sql``}
    order by a.created_at desc,a.id limit ${id ? 1 : LIST_LIMIT + 1}`;
}
async function taskSummary(tx: Reader, at: Date, worldId?: string): Promise<AdminOverview['tasks']> {
  const row = (
    await sql<{ pending: number; due: number; retrying: number; oldestDueAt: Date | null }>`
    select count(*)::integer as pending, count(*) filter(where due_at<=${at} and available_at<=${at})::integer as due,
      count(*) filter(where last_error is not null)::integer as retrying,
      min(due_at) filter(where due_at<=${at}) as oldest_due_at
    from scheduled_tasks where completed_at is null ${worldId ? sql`and world_id=${worldId}::uuid` : sql``}`.execute(tx)
  ).rows[0]!;
  return { ...row, oldestDueAt: iso(row.oldestDueAt) };
}
async function expeditionSummary(tx: Reader, worldId?: string): Promise<AdminOverview['expeditions']> {
  const rows = (
    await sql<{
      status: string;
      activityStatus: string | null;
    }>`select e.receipt->>'status' as status, a.status as activity_status
    from expedition_submissions e left join science_activities a
      on a.world_id=e.world_id and a.village_id=e.village_id and a.id::text=e.receipt->>'activityId'
    ${worldId ? sql`where e.world_id=${worldId}::uuid` : sql``} order by e.received_order desc limit ${EXPEDITION_SAMPLE + 1}`.execute(
      tx,
    )
  ).rows;
  const pending = (
    await sql<{ count: number }>`select count(*)::integer as count from expedition_submissions
    where receipt->>'status'='pending' ${worldId ? sql`and world_id=${worldId}::uuid` : sql``}`.execute(tx)
  ).rows[0]!.count;
  // Activities may precede the asynchronous receipt mechanism or fall outside
  // the recent receipt sample. Current departures therefore use business state.
  const active = (
    await sql<{ count: number }>`select count(*)::integer as count from science_activities
    where status='in-progress' and kind in ('exploration','survey')
      ${worldId ? sql`and world_id=${worldId}::uuid` : sql``}`.execute(tx)
  ).rows[0]!.count;
  const sample = rows.slice(0, EXPEDITION_SAMPLE);
  return {
    pending,
    active,
    admitted: sample.filter((r) => r.status === 'admitted').length,
    completed: sample.filter((r) => r.status === 'admitted' && r.activityStatus === 'completed').length,
    rejected: sample.filter((r) => r.status === 'rejected').length,
    failed: sample.filter((r) => r.status === 'failed').length,
    sampleSize: sample.length,
    sampleLimit: EXPEDITION_SAMPLE,
    truncated: rows.length > EXPEDITION_SAMPLE,
    note: `En préparation et en cours : totaux actuels du périmètre. Admis, terminées, refus et échecs : ${sample.length} reçus récents, limite ${EXPEDITION_SAMPLE}. Une admission n’est pas une fin d’expédition.`,
  };
}

export function diagnoseActivity(row: AdminActivity, at: Date): AdminDiagnostic[] {
  if (row.status === 'failed' || row.status === 'rejected' || row.status === 'retrying')
    return [
      {
        status: 'attention',
        code: row.errorCode ?? 'ACTIVITY_REFUSED',
        message:
          row.kind === 'task'
            ? 'La notification a échoué et attend une nouvelle tentative. Le détail technique est réservé aux journaux serveur.'
            : 'Le reçu enregistre un refus ou un échec. Aucun nouvel ordre n’est lancé par ce diagnostic.',
      },
    ];
  if (row.completedAt || row.status === 'completed')
    return [{ status: 'ok', code: 'COMPLETED', message: 'La fin est persistée.' }];
  if (row.dueAt && Date.parse(row.dueAt) <= at.getTime())
    return [
      {
        status: 'attention',
        code: 'DEADLINE_PASSED',
        message:
          'L’échéance persistée est passée. Une réconciliation peut encore être due ; cette lecture ne la déclenche pas.',
      },
    ];
  if (row.status === 'admitted' && !row.relatedActivityId)
    return [
      {
        status: 'unknown',
        code: 'ACTIVITY_NOT_FOUND',
        message: 'Le reçu est admis, mais son activité associée n’a pas été retrouvée dans ce monde et ce village.',
      },
    ];
  return [
    {
      status: 'ok',
      code: 'WAITING',
      message: 'Aucun dépassement d’échéance n’est observé dans les données persistées.',
    },
  ];
}

export class AdminReadService {
  private readonly cache = new AdminReadCache();
  constructor(private readonly db: Kysely<Database>) {}
  private read<T>(key: string, load: (tx: Reader, at: Date) => Promise<T>): Promise<T> {
    return this.cache.read(key, () =>
      this.db
        .transaction()
        .setIsolationLevel('repeatable read')
        .execute(async (tx) => {
          await sql`set transaction read only`.execute(tx);
          await sql`set local statement_timeout='2s'`.execute(tx);
          await sql`set local lock_timeout='250ms'`.execute(tx);
          await sql`set local transaction_timeout='4s'`.execute(tx);
          const at = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('at')).executeTakeFirstOrThrow()).at;
          return load(tx, at);
        })
        .catch((error) => {
          if (error instanceof HttpError) throw error;
          throw new HttpError(
            503,
            'ADMIN_DATA_UNAVAILABLE',
            'La lecture de diagnostic est indisponible ou a dépassé son délai.',
          );
        }),
    );
  }
  overview(): Promise<AdminOverview> {
    return this.read('overview', async (tx, at) => {
      const counts = (
        await sql<AdminOverview['counts']>`select
        (select count(*)::integer from accounts) as accounts, (select count(*)::integer from worlds) as worlds,
        (select count(*)::integer from worlds where is_open) as open_worlds, (select count(*)::integer from villages) as villages`.execute(
          tx,
        )
      ).rows[0]!;
      return {
        observedAt: at.toISOString(),
        refreshAfterSeconds: ADMIN_CACHE_MS / 1_000,
        counts,
        tasks: await taskSummary(tx, at),
        expeditions: await expeditionSummary(tx),
        recentActivities: (await activities(tx, {})).items,
        activityNote: ACTIVITY_NOTE,
      };
    });
  }
  worlds(): Promise<AdminWorlds> {
    return this.read('worlds', async (tx, at) => {
      const rows = (await worldRows().execute(tx)).rows;
      return {
        observedAt: at.toISOString(),
        items: rows.slice(0, LIST_LIMIT).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        truncated: rows.length > LIST_LIMIT,
        limit: LIST_LIMIT,
      };
    });
  }
  world(id: string): Promise<AdminWorldDetail> {
    return this.read('world:' + id, async (tx, at) => {
      const world = (await worldRows(id).execute(tx)).rows[0];
      if (!world) throw new HttpError(404, 'WORLD_NOT_FOUND', 'Monde introuvable.');
      const list = await villages(tx, { worldId: id });
      return {
        observedAt: at.toISOString(),
        world: { ...world, createdAt: world.createdAt.toISOString() },
        tasks: await taskSummary(tx, at, id),
        expeditions: await expeditionSummary(tx, id),
        villages: list.items,
        villagesTruncated: list.truncated,
        recentActivities: (await activities(tx, { worldId: id })).items,
        activityNote: ACTIVITY_NOTE,
        synchronization: {
          revision: null,
          note: 'Révision historique non recomptée par le NOC. Les connexions SSE de cette instance figurent dans Infrastructure.',
        },
      };
    });
  }
  accounts(query = '', worldId?: string): Promise<AdminAccounts> {
    return this.read('accounts:' + JSON.stringify([query, worldId]), async (tx, at) => {
      const rows = (await accountRows(query, worldId).execute(tx)).rows;
      return {
        observedAt: at.toISOString(),
        items: rows.slice(0, LIST_LIMIT).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        truncated: rows.length > LIST_LIMIT,
        limit: LIST_LIMIT,
      };
    });
  }
  account(id: string): Promise<AdminAccountDetail> {
    return this.read('account:' + id, async (tx, at) => {
      const account = (await accountRows('', undefined, id).execute(tx)).rows[0];
      if (!account) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'Compte introuvable.');
      const memberships = await tx
        .selectFrom('worldMemberships as m')
        .innerJoin('worlds as w', 'w.id', 'm.worldId')
        .select(['m.worldId', 'w.slug as worldSlug', 'm.playerName'])
        .select(sql<Date>`${sql.ref('m.createdAt')}`.as('joinedAt'))
        .where('m.accountId', '=', id)
        .orderBy('m.createdAt', 'desc')
        .limit(LIST_LIMIT + 1)
        .execute();
      const list = await villages(tx, { accountId: id });
      return {
        observedAt: at.toISOString(),
        account: { ...account, createdAt: account.createdAt.toISOString() },
        memberships: memberships.slice(0, LIST_LIMIT).map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() })),
        villages: list.items,
        truncated: list.truncated || memberships.length > LIST_LIMIT,
        recentActivities: (await activities(tx, { accountId: id })).items,
        activityNote: ACTIVITY_NOTE,
      };
    });
  }
  village(worldId: string, villageId: string): Promise<AdminVillageDetail> {
    return this.read('village:' + worldId + ':' + villageId, async (tx, at) => {
      const village = (await villages(tx, { worldId, villageId })).items[0];
      if (!village) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable dans ce monde.');
      const resources = await tx
        .selectFrom('villageResources as r')
        .leftJoin('villageResourceFlows as f', (j) =>
          j
            .onRef('f.worldId', '=', 'r.worldId')
            .onRef('f.villageId', '=', 'r.villageId')
            .onRef('f.resourceCode', '=', 'r.resourceCode'),
        )
        .select(['r.resourceCode as code', 'r.amount', 'f.productionUpdatedAt'])
        .where('r.worldId', '=', worldId)
        .where('r.villageId', '=', villageId)
        .orderBy('r.resourceCode')
        .execute();
      const population = (
        await sql<AdminVillageDetail['economy']['population']>`select coalesce(sum(member_count),0)::integer as total,
        coalesce(sum(member_count) filter(where activity='idle'),0)::integer as idle,
        coalesce(sum(member_count) filter(where activity='working'),0)::integer as working,
        coalesce(sum(member_count) filter(where activity='resting'),0)::integer as resting
        from population_cohorts where world_id=${worldId}::uuid and village_id=${villageId}::uuid`.execute(tx)
      ).rows[0]!;
      const due = (
        await sql<
          Pick<
            AdminVillageDetail['economy'],
            | 'buildings'
            | 'constructionDue'
            | 'harvestsDue'
            | 'extractionsDue'
            | 'processingDue'
            | 'marketDue'
            | 'scienceDue'
          >
        >`select
        (select count(*)::integer from buildings where world_id=${worldId}::uuid and village_id=${villageId}::uuid) as buildings,
        (select count(*)::integer from buildings where world_id=${worldId}::uuid and village_id=${villageId}::uuid and status='under-construction' and construction_completes_at<=${at}) as construction_due,
        (select count(*)::integer from garden_harvests where world_id=${worldId}::uuid and village_id=${villageId}::uuid and status='in-progress' and completes_at<=${at}) as harvests_due,
        (select count(*)::integer from deposit_extractions where world_id=${worldId}::uuid and village_id=${villageId}::uuid and status='in-progress' and completes_at<=${at}) as extractions_due,
        (select count(*)::integer from processing_lots where world_id=${worldId}::uuid and village_id=${villageId}::uuid and completed_at is null and completes_at<=${at}) as processing_due,
        (select count(*)::integer from market_exchanges where world_id=${worldId}::uuid and village_id=${villageId}::uuid and completed_at is null and completes_at<=${at}) as market_due,
        (select count(*)::integer from science_activities where world_id=${worldId}::uuid and village_id=${villageId}::uuid and status='in-progress' and completes_at<=${at}) as science_due`.execute(
          tx,
        )
      ).rows[0]!;
      const hasDue =
        due.constructionDue +
          due.harvestsDue +
          due.extractionsDue +
          due.processingDue +
          due.marketDue +
          due.scienceDue >
        0;
      return {
        observedAt: at.toISOString(),
        village,
        economy: {
          mode: 'persisted-only',
          note: 'Stocks, population et curseurs persistés : aucune production, énergie ou transition n’est matérialisée par cette lecture.',
          resources: resources.map((r) => ({
            ...r,
            amount: String(r.amount),
            productionUpdatedAt: iso(r.productionUpdatedAt),
          })),
          population,
          ...due,
        },
        recentActivities: (await activities(tx, { worldId, villageId })).items,
        activityNote: ACTIVITY_NOTE,
        diagnostics: [
          {
            status: hasDue ? 'attention' : 'ok',
            code: hasDue ? 'RECONCILIATION_DUE' : 'NO_DUE_TRANSITION',
            message: hasDue
              ? 'Des échéances métier sont passées. Ce constat n’atteste pas une panne et ne déclenche aucune réconciliation.'
              : 'Aucune des échéances métier inspectées n’est dépassée.',
          },
        ],
      };
    });
  }
  activities(filter: ActivityFilter): Promise<AdminActivities> {
    return this.read('activities:' + JSON.stringify(filter), async (tx, at) => ({
      observedAt: at.toISOString(),
      ...(await activities(tx, filter)),
      note: ACTIVITY_NOTE,
    }));
  }
  activity(worldId: string, kind: AdminActivity['kind'], id: string, villageId?: string): Promise<AdminActivityDetail> {
    return this.read('activity:' + worldId + ':' + kind + ':' + id + ':' + (villageId ?? ''), async (tx, at) => {
      const list = await activities(tx, { worldId, kind, ...(villageId ? { villageId } : {}) }, id);
      if (list.items.length > 1)
        throw new HttpError(
          409,
          'ACTIVITY_AMBIGUOUS',
          'Identifiant présent dans plusieurs villages ; utilisez la liste du village.',
        );
      const current = list.items[0];
      if (!current) throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activité introuvable dans ce monde.');
      const related =
        current.relatedActivityId && current.villageId
          ? (
              await activities(
                tx,
                { worldId, villageId: current.villageId, kind: 'science' },
                current.relatedActivityId,
              )
            ).items
          : [];
      return {
        observedAt: at.toISOString(),
        activity: current,
        relatedActivities: related,
        diagnostics: diagnoseActivity(current, at),
      };
    });
  }
  /** Player journey: sessions, chronology and summary, computed at read time. */
  journey(
    query: JourneyQuery,
    options: { admin: boolean; collection: JourneyJournalStatus | undefined },
  ): Promise<AdminJourney> {
    return this.read('journey:' + JSON.stringify(query), (tx, at) => readJourney(tx, at, query, options));
  }
}
