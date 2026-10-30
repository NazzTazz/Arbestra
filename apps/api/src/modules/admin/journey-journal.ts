import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';

/** Outcome of a village command as the server answered it. `error` and
 * `interrupted` are provisional: a later attempt of the same commandId
 * replaces them (docs/DESIGN-OBSERVABILITE-PARCOURS.md, §2.2). */
export type JourneyOutcome = 'accepted' | 'pending' | 'rejected' | 'error' | 'interrupted';
export interface JourneyCommand {
  id: string;
  worldId: string;
  villageId: string;
  accountId: string;
  type: string;
  occurredAt: string;
  commandId?: string;
  outcome: JourneyOutcome;
  code?: string | undefined;
  statusCode?: number | undefined;
  subject?: string | undefined;
  attempts: number;
}
export interface JourneyJournalStatus {
  enabled: boolean;
  buffered: number;
  dropped: number;
  lost: number;
  written: number;
  lastFlushAt: string | null;
  lastErrorAt: string | null;
}

const provisional = (outcome: JourneyOutcome) => outcome === 'error' || outcome === 'interrupted';
/** Same rule in memory and in SQL: attempts add up; a provisional outcome is
 * replaced by the next one (with its code and status), a final outcome is
 * kept and only gains a status it lacked (first attempt cut after commit). */
function merge(previous: JourneyCommand, next: JourneyCommand): JourneyCommand {
  const replace = provisional(previous.outcome),
    merged: JourneyCommand = { ...previous, attempts: previous.attempts + next.attempts };
  if (replace) {
    merged.outcome = next.outcome;
    merged.code = next.code;
    merged.statusCode = next.statusCode;
  } else merged.statusCode ??= next.statusCode;
  merged.subject ??= next.subject;
  return merged;
}

/** Bounded in-memory buffer of command journey rows, flushed by one
 * multi-row upsert outside any business transaction. Disabled: record() does
 * nothing. A failed flush keeps its rows for one more try, then counts them
 * as lost. A crash loses at most one flush interval. */
export class JourneyJournal {
  private buffer = new Map<string, JourneyCommand>();
  private retry = new Map<string, JourneyCommand>();
  private flushing: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private counters = { dropped: 0, lost: 0, written: 0 };
  private lastFlushAt: string | null = null;
  private lastErrorAt: string | null = null;
  constructor(
    private readonly db: Kysely<Database>,
    readonly enabled: boolean,
    private readonly capacity = 2000,
  ) {}
  status(): JourneyJournalStatus {
    return {
      enabled: this.enabled,
      buffered: this.buffer.size + this.retry.size,
      ...this.counters,
      lastFlushAt: this.lastFlushAt,
      lastErrorAt: this.lastErrorAt,
    };
  }
  record(entry: JourneyCommand): void {
    if (!this.enabled) return;
    const key = keyOf(entry);
    const previous = this.buffer.get(key);
    if (previous) this.buffer.set(key, merge(previous, entry));
    else if (this.buffer.size + this.retry.size >= this.capacity) this.counters.dropped++;
    else this.buffer.set(key, entry);
  }
  /** Flushes are serialized: a timer tick during a slow write waits for it. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.write());
    return this.flushing;
  }
  start(intervalMs: number): void {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => void this.flush(), intervalMs);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }
  private async write(): Promise<void> {
    const retried = [...this.retry.values()];
    this.retry.clear();
    // A row kept from a failed flush goes first; a newer attempt of the same
    // command merges into it, so one batch never affects a row twice.
    const batch = new Map<string, JourneyCommand>();
    for (const [key, entry] of [...retried.map((e) => [keyOf(e), e] as const), ...this.buffer]) {
      const previous = batch.get(key);
      batch.set(key, previous ? merge(previous, entry) : entry);
    }
    const retriedKeys = new Set(retried.map(keyOf));
    this.buffer.clear();
    if (!batch.size) return;
    const rows = [...batch.values()].map((e) => ({
      id: e.id,
      world_id: e.worldId,
      village_id: e.villageId,
      account_id: e.accountId,
      type: e.type,
      occurred_at: e.occurredAt,
      command_id: e.commandId ?? null,
      outcome: e.outcome,
      code: e.code ?? null,
      status_code: e.statusCode ?? null,
      subject: e.subject ?? null,
      attempts: e.attempts,
    }));
    try {
      // A row whose village or account disappeared meanwhile is skipped
      // instead of failing the whole batch on its foreign key.
      await sql`insert into player_journey_events
          (id,world_id,village_id,account_id,source,type,occurred_at,command_id,outcome,code,status_code,subject,attempts)
        select r.id,r.world_id,r.village_id,r.account_id,'command',r.type,r.occurred_at,r.command_id,r.outcome,r.code,
          r.status_code,r.subject,r.attempts
        from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(id uuid,world_id uuid,village_id uuid,
          account_id uuid,type text,occurred_at timestamptz,command_id uuid,outcome text,code text,status_code smallint,
          subject text,attempts integer)
        where exists(select 1 from villages v where v.id=r.village_id and v.world_id=r.world_id)
          and exists(select 1 from accounts a where a.id=r.account_id)
        on conflict (world_id,village_id,type,command_id) where source='command' and command_id is not null
        do update set attempts=player_journey_events.attempts+excluded.attempts,
          outcome=case when player_journey_events.outcome in ('error','interrupted') then excluded.outcome
            else player_journey_events.outcome end,
          code=case when player_journey_events.outcome in ('error','interrupted') then excluded.code
            else player_journey_events.code end,
          status_code=case when player_journey_events.outcome in ('error','interrupted') then excluded.status_code
            else coalesce(player_journey_events.status_code,excluded.status_code) end,
          subject=coalesce(player_journey_events.subject,excluded.subject)`.execute(this.db);
      this.counters.written += rows.length;
      this.lastFlushAt = new Date().toISOString();
    } catch {
      this.lastErrorAt = new Date().toISOString();
      for (const [key, entry] of batch) {
        if (retriedKeys.has(key)) this.counters.lost++;
        else this.retry.set(key, entry);
      }
    }
  }
}
const keyOf = (e: JourneyCommand) =>
  e.commandId ? `${e.worldId}:${e.villageId}:${e.type}:${e.commandId}` : `id:${e.id}`;

export const JOURNEY_RETENTION = { maxAgeMs: 90 * 24 * 3600000, rowBudget: 5000 };

/** One bounded purge pass: deletes at most rowBudget rows older than maxAgeMs,
 * oldest first. Passes of several processes exclude each other; a pass that
 * finds the lock held stops instead of waiting. */
export async function pruneJourneyEvents(
  db: Kysely<Database>,
  options = JOURNEY_RETENTION,
): Promise<{ rows: number } | null> {
  const cutoff = new Date(Date.now() - options.maxAgeMs);
  return db.transaction().execute(async (tx) => {
    const locked = (
      await sql<{
        locked: boolean;
      }>`select pg_try_advisory_xact_lock(hashtextextended('player-journey-retention',0)) as locked`.execute(tx)
    ).rows[0]!.locked;
    if (!locked) return null;
    const removed = await sql`delete from player_journey_events where id in (
        select id from player_journey_events where occurred_at<${cutoff} order by occurred_at limit ${options.rowBudget})`.execute(
      tx,
    );
    return { rows: Number(removed.numAffectedRows ?? 0n) };
  });
}

/** Purge at start, then every intervalMs; stop() waits for the current pass. */
export function startJourneyRetention(
  db: Kysely<Database>,
  intervalMs: number,
  onError: (error: unknown) => void,
): () => Promise<void> {
  let stopped = false,
    current: Promise<unknown> | null = null;
  const run = () => {
    if (stopped || current) return;
    current = pruneJourneyEvents(db)
      .catch(onError)
      .finally(() => {
        current = null;
      });
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await current;
  };
}
