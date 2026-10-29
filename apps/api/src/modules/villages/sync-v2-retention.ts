import { sql, type Kysely, type Transaction } from 'kysely';

export interface SyncRetention {
  maxAgeMs: number;
  maxEntries: number;
  rowBudget: number;
  streamBudget: number;
  batchBudget: number;
}
export const SYNC_RETENTION: SyncRetention = {
  maxAgeMs: 7 * 24 * 3600000,
  maxEntries: 10000,
  rowBudget: 2000,
  streamBudget: 200,
  batchBudget: 2000,
};

/** Retention transactions of all processes exclude each other (deployment
 * overlap, second instance). Without it, two of them pruning two streams of
 * one stored vector each still see the other's row in READ COMMITTED and both
 * keep the vector, which nothing references any more. Writers and readers
 * never take this lock; a pass that finds it held stops instead of waiting. */
async function retentionExclusive<DB>(tx: Transaction<DB>): Promise<boolean> {
  return (
    await sql<{
      locked: boolean;
    }>`select pg_try_advisory_xact_lock(hashtextextended('sync-journal-retention',0)) as locked`.execute(tx)
  ).rows[0]!.locked;
}

/** One bounded retention pass over the V2 journal: per stream, delete an
 * expired prefix (older than maxAgeMs, or beyond the last maxEntries) and
 * raise retained_from to its last revision in the same transaction. Epochs
 * and revisions never change: a cursor below the floor resumes by snapshot.
 * Takes no business lock and never waits for a publisher (SKIP LOCKED) or for
 * another retention process (it stops); a stream advances by at most
 * rowBudget rows per pass. */
export async function pruneSyncJournal<DB>(
  db: Kysely<DB>,
  options: SyncRetention = SYNC_RETENTION,
): Promise<{ streams: number; rows: number }> {
  const cutoff = new Date(Date.now() - options.maxAgeMs);
  // The oldest retained entry of a stream is revision retained_from+1: a
  // primary-key probe, no scan of the journal by date.
  const candidates = (
    await sql<{ worldId: string; kind: string; key: string }>`
    select s.world_id as "worldId",s.stream_kind as kind,s.scope_key as key from game_sync_streams s
    left join game_sync_changes c on c.world_id=s.world_id and c.stream_kind=s.stream_kind and c.scope_key=s.scope_key
      and c.epoch=s.epoch and c.revision=s.retained_from+1
    where s.revision-s.retained_from>${options.maxEntries} or c.recorded_at<${cutoff}
    order by 1,2,3 limit ${options.streamBudget}`.execute(db)
  ).rows;
  let streams = 0,
    rows = 0;
  for (const candidate of candidates) {
    const deleted = await db.transaction().execute(async (tx) => {
      if (!(await retentionExclusive(tx))) return null;
      const stream = (
        await sql<{ epoch: string; revision: string; retainedFrom: string }>`
        select epoch::text,revision::text,retained_from::text as "retainedFrom" from game_sync_streams
        where world_id=${candidate.worldId} and stream_kind=${candidate.kind} and scope_key=${candidate.key}
        for update skip locked`.execute(tx)
      ).rows[0];
      if (!stream) return 0;
      const expired = (
        await sql<{ revision: string | null }>`select max(revision)::text as revision from game_sync_changes
        where world_id=${candidate.worldId} and stream_kind=${candidate.kind} and scope_key=${candidate.key}
          and epoch=${stream.epoch}::uuid and revision>${stream.retainedFrom}::bigint and recorded_at<${cutoff}`.execute(
          tx,
        )
      ).rows[0]!.revision;
      const revision = BigInt(stream.revision),
        from = BigInt(stream.retainedFrom);
      let floor = revision - BigInt(options.maxEntries);
      if (expired !== null && BigInt(expired) > floor) floor = BigInt(expired);
      if (floor > from + BigInt(options.rowBudget)) floor = from + BigInt(options.rowBudget);
      if (floor <= from) return 0;
      const removed = (
        await sql<{ batchId: string | null }>`delete from game_sync_changes
        where world_id=${candidate.worldId} and stream_kind=${candidate.kind} and scope_key=${candidate.key}
          and epoch=${stream.epoch}::uuid and revision<=${floor.toString()}::bigint
        returning dependencies_batch_id::text as "batchId"`.execute(tx)
      ).rows;
      await sql`update game_sync_streams set retained_from=${floor.toString()}::bigint
        where world_id=${candidate.worldId} and stream_kind=${candidate.kind} and scope_key=${candidate.key}`.execute(
        tx,
      );
      // A stored vector goes with the last journal row of any stream that
      // references it, not by age: companions are compacted at their own pace.
      const batches = [...new Set(removed.flatMap((row) => (row.batchId ? [row.batchId] : [])))];
      if (batches.length)
        await sql`delete from game_sync_batches b where b.world_id=${candidate.worldId}
        and b.batch_id=any(${batches}::uuid[]) and not exists(select 1 from game_sync_changes c
          where c.world_id=b.world_id and c.dependencies_batch_id=b.batch_id)`.execute(tx);
      return removed.length;
    });
    if (deleted === null) break;
    if (deleted > 0) {
      streams++;
      rows += deleted;
    }
  }
  return { streams, rows };
}

export interface SyncBatchKey {
  worldId: string;
  batchId: string;
}

/** Bounded sweep of stored vectors older than the retention that no journal
 * row references: leftovers of passes that overlapped before the retention
 * lock. Walks the primary key after `after`, at most batchBudget entries per
 * call; `next` is null once the end is reached, so the following call starts
 * over. A vector and its rows are published together and no publication
 * references an older vector: an unreferenced one never becomes referenced
 * again, and the foreign key refuses to delete a referenced one. */
export async function sweepSyncBatches<DB>(
  db: Kysely<DB>,
  after: SyncBatchKey | null,
  options: SyncRetention = SYNC_RETENTION,
): Promise<{ examined: number; removed: number; next: SyncBatchKey | null }> {
  const cutoff = new Date(Date.now() - options.maxAgeMs);
  return db.transaction().execute(async (tx) => {
    if (!(await retentionExclusive(tx))) return { examined: 0, removed: 0, next: after };
    const lower = after ? sql`(world_id,batch_id)>(${after.worldId}::uuid,${after.batchId}::uuid)` : sql`true`;
    const examined = (
      await sql<SyncBatchKey>`select world_id::text as "worldId",batch_id::text as "batchId" from game_sync_batches
      where ${lower} order by world_id,batch_id limit ${options.batchBudget}`.execute(tx)
    ).rows;
    const last = examined.at(-1);
    if (!last) return { examined: 0, removed: 0, next: null };
    const removed = (
      await sql`delete from game_sync_batches b
      where ${lower} and (world_id,batch_id)<=(${last.worldId}::uuid,${last.batchId}::uuid) and b.recorded_at<${cutoff}
        and not exists(select 1 from game_sync_changes c where c.world_id=b.world_id and c.dependencies_batch_id=b.batch_id)
      returning 1`.execute(tx)
    ).rows.length;
    return { examined: examined.length, removed, next: examined.length < options.batchBudget ? null : last };
  });
}

/** Periodic retention, one pass at a time; stop() waits for the current one. */
export function startSyncJournalRetention<DB>(
  db: Kysely<DB>,
  intervalMs: number,
  onError: (error: unknown) => void,
  options: SyncRetention = SYNC_RETENTION,
): () => Promise<void> {
  let stopped = false,
    current: Promise<unknown> | null = null,
    swept: SyncBatchKey | null = null;
  const run = () => {
    if (stopped || current) return;
    current = pruneSyncJournal(db, options)
      .catch(onError)
      .then(() => sweepSyncBatches(db, swept, options))
      .then((sweep) => {
        swept = sweep.next;
      }, onError)
      .finally(() => {
        current = null;
      });
  };
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await current;
  };
}
