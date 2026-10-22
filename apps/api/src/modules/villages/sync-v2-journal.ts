import { sql, type Transaction } from 'kysely';
import type { Database } from '../../database/schema.js';
import type { SyncEntityReference } from './sync-v2-readers.js';

export interface SyncCursor { epoch: string; revision: string }
export interface SyncScope { kind: 'village' | 'knowledge' | 'spatial' | 'offers' | 'manifest' | 'traffic'; key: string }
export interface SyncDependency extends SyncScope, SyncCursor { worldId: string }
interface Counter extends SyncCursor { retainedFrom: string }
export type JournalSelection = { kind: 'delta'; cursor: SyncCursor; fromRevision: string;
  references: SyncEntityReference[]; dependencies: SyncDependency[] }
  | { kind: 'snapshot-required'; cursor: SyncCursor | null; reason: 'missing' | 'epoch' | 'floor' | 'ahead' | 'gap' | 'size' };

/** Counters, union of keys and subsequent entity readers MUST share this
 * transaction. No payload from another private scope is returned unless the
 * server-provided authorizer explicitly permits that dependency. */
export async function readJournalSelection(tx: Transaction<Database>, worldId: string, scope: SyncScope,
  base: SyncCursor | null, authorized: (dependency: SyncDependency) => boolean, captured?: Counter | null): Promise<JournalSelection> {
  if (base && !/^(0|[1-9][0-9]{0,18})$/.test(base.revision)) throw new RangeError('Invalid synchronization revision');
  if (base && BigInt(base.revision) > 9223372036854775807n) throw new RangeError('Invalid synchronization revision');
  const counter = captured === undefined ? (await sql<Counter>`select epoch::text,revision::text,retained_from::text as "retainedFrom"
    from game_sync_streams where world_id=${worldId} and stream_kind=${scope.kind} and scope_key=${scope.key}`.execute(tx)).rows[0] : captured;
  if (!counter) return { kind: 'snapshot-required', cursor: null, reason: 'missing' };
  const cursor = { epoch: counter.epoch, revision: counter.revision };
  if (!base || base.epoch !== counter.epoch) return { kind: 'snapshot-required', cursor, reason: 'epoch' };
  if (BigInt(base.revision) < BigInt(counter.retainedFrom)) return { kind: 'snapshot-required', cursor, reason: 'floor' };
  if (BigInt(base.revision) > BigInt(counter.revision)) return { kind: 'snapshot-required', cursor, reason: 'ahead' };
  if (base.revision === counter.revision) return { kind: 'delta', cursor, fromRevision: base.revision, references: [], dependencies: [] };
  if (BigInt(counter.revision) - BigInt(base.revision) > 10000n) return { kind: 'snapshot-required', cursor, reason: 'size' };
  const rows = (await sql<{ revision: string; changes: SyncEntityReference[]; dependencies: SyncDependency[] }>`
    select revision::text,changes,dependencies from game_sync_changes
    where world_id=${worldId} and stream_kind=${scope.kind} and scope_key=${scope.key} and epoch=${counter.epoch}::uuid
      and revision>${base.revision}::bigint and revision<=${counter.revision}::bigint order by revision limit 10001`.execute(tx)).rows;
  if (BigInt(rows.length) !== BigInt(counter.revision) - BigInt(base.revision)) return { kind: 'snapshot-required', cursor, reason: 'gap' };
  const references = new Map<string, SyncEntityReference>(), dependencies = new Map<string, SyncDependency>();
  let expected = BigInt(base.revision);
  for (const row of rows) {
    if (BigInt(row.revision) !== ++expected) return { kind: 'snapshot-required', cursor, reason: 'gap' };
    for (const reference of row.changes) references.set(JSON.stringify([reference.component, reference.key]), reference);
    for (const dependency of row.dependencies) {
      if (dependency.worldId !== worldId || !authorized(dependency)) continue;
      const key = JSON.stringify([dependency.worldId, dependency.kind, dependency.key]);
      const previous = dependencies.get(key);
      if (previous && previous.epoch !== dependency.epoch) return { kind: 'snapshot-required', cursor, reason: 'epoch' };
      if (!previous || BigInt(dependency.revision) > BigInt(previous.revision)) dependencies.set(key, dependency);
    }
    if (references.size > 4096 || dependencies.size > 128) return { kind: 'snapshot-required', cursor, reason: 'size' };
  }
  return { kind: 'delta', cursor, fromRevision: base.revision, references: [...references.values()], dependencies: [...dependencies.values()] };
}

export interface SubscribedSyncScope { scope: SyncScope; base: SyncCursor | null }
export type SubscribedJournalCapture = { kind: 'ready'; coverage: 'delta' | 'scope-snapshot';
  streams: Array<{ scope: SyncScope; cursor: SyncCursor; fromRevision: string; references: SyncEntityReference[] }> }
  | { kind: 'unavailable'; reason: 'uninitialized' | 'dependency'; scope: SyncScope };

/** Capture the complete, already-authorized subscription set in one view.
 * Reading every subscribed counter together is a bounded superset of the
 * dependency closure: no relevant companion is omitted, including when the
 * originating notification was lost. Only changed streams read a journal.
 * Dependencies outside this set are neither serialized nor implicitly granted
 * authority. Snapshot fallback replaces the concerned subscription together. */
export async function readSubscribedJournal(tx: Transaction<Database>, worldId: string,
  subscriptions: readonly SubscribedSyncScope[]): Promise<SubscribedJournalCapture> {
  if (!subscriptions.length || subscriptions.length > 64) throw new RangeError('Invalid subscription count');
  const key = (scope: SyncScope) => `${scope.kind}:${scope.key}`;
  const wanted = new Map(subscriptions.map(subscription => [key(subscription.scope), subscription]));
  if (wanted.size !== subscriptions.length) throw Error('Duplicate synchronization subscription');
  const rows = (await sql<Counter & SyncScope>`select s.stream_kind as kind,s.scope_key as key,s.epoch::text,s.revision::text,
      s.retained_from::text as "retainedFrom" from game_sync_streams s
    join jsonb_to_recordset(${JSON.stringify(subscriptions.map(subscription => subscription.scope))}::jsonb) r(kind text,key text)
      on r.kind=s.stream_kind and r.key=s.scope_key where s.world_id=${worldId}`.execute(tx)).rows;
  const counters = new Map(rows.map(row => [key(row), row]));
  const streams: Extract<SubscribedJournalCapture, { kind: 'ready' }>['streams'] = [];
  let snapshot = false;
  for (const subscription of subscriptions) {
    const counter = counters.get(key(subscription.scope));
    if (!counter) return { kind: 'unavailable', reason: 'uninitialized', scope: subscription.scope };
    const selection = await readJournalSelection(tx, worldId, subscription.scope, subscription.base,
      dependency => wanted.has(key(dependency)), counter);
    if (selection.kind === 'snapshot-required') snapshot = true;
    else for (const dependency of selection.dependencies) {
      const current = counters.get(key(dependency))!;
      if (current.epoch !== dependency.epoch) snapshot = true;
      else if (BigInt(current.revision) < BigInt(dependency.revision))
        return { kind: 'unavailable', reason: 'dependency', scope: { kind: dependency.kind, key: dependency.key } };
    }
    streams.push({ scope: subscription.scope, cursor: { epoch: counter.epoch, revision: counter.revision },
      fromRevision: selection.kind === 'delta' ? selection.fromRevision : '0',
      references: selection.kind === 'delta' ? selection.references : [],
    });
  }
  return { kind: 'ready', coverage: snapshot ? 'scope-snapshot' : 'delta', streams };
}
