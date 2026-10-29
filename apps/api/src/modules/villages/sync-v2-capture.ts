import { sql, type Kysely, type Transaction } from 'kysely';
import {
  SYNC_V2_PRIVATE_COMPONENTS,
  type SyncV2Batch,
  type SyncV2ReadRequest,
  type SyncV2SnapshotPage,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { ownedVillage } from './service.js';
import { readJournalSelection, readSubscribedJournal, type SyncCursor, type SyncScope } from './sync-v2-journal.js';
import {
  readPrivateScopeSnapshot,
  readPrivateScopeSnapshotPage,
  readRegisteredPrivateChanges,
  type SyncSnapshotPosition,
} from './sync-v2-readers.js';
import { readSpatialChanges, readSpatialScopeSnapshot } from './sync-v2-spatial-readers.js';
import { readSharedChanges, readSharedScopeSnapshot } from './sync-v2-shared-readers.js';
import { readTrafficChanges, readTrafficScopeSnapshot } from './sync-v2-traffic-readers.js';

export type SyncV2SharedInclude = 'knowledge' | 'manifest' | 'traffic';
interface CaptureOptions {
  include?: readonly SyncV2SharedInclude[];
  /** The stream only sends deltas: when a snapshot is required it gets a
   * bare `scope-snapshot` marker (no group), never read, and resets. */
  deltaOnly?: boolean;
}

/** Position of a paged private snapshot. Opaque to the client; it grants
 * nothing: each page authenticates and checks the village again. */
interface PageCursor extends SyncSnapshotPosition {
  epoch: string;
  /** Revision of the first page, from which the client catches up. */
  anchor: string;
}
const encodePageCursor = (cursor: PageCursor) =>
  Buffer.from(JSON.stringify({ v: 1, e: cursor.epoch, r: cursor.anchor, c: cursor.component, k: cursor.key })).toString(
    'base64url',
  );
function decodePageCursor(token: string): PageCursor {
  let value: { v?: unknown; e?: unknown; r?: unknown; c?: unknown; k?: unknown } | null = null;
  try {
    value = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    // Reported below.
  }
  const { e, r, c, k } = value ?? {};
  if (
    value?.v !== 1 ||
    typeof e !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(e) ||
    typeof r !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(r) ||
    BigInt(r) > 9223372036854775807n ||
    typeof c !== 'string' ||
    !(SYNC_V2_PRIVATE_COMPONENTS as readonly string[]).includes(c) ||
    typeof k !== 'string' ||
    k.length < 1 ||
    k.length > 128
  )
    throw new HttpError(400, 'INVALID_SYNC_PAGE', 'Page de synchronisation invalide.');
  return { epoch: e, anchor: r, component: c, key: k };
}
async function captureClock(tx: Transaction<Database>): Promise<Date> {
  const { through } = await tx
    .selectNoFrom([
      sql<Date>`statement_timestamp()`.as('through'),
      sql<string>`set_config('arbestra.economy_through',statement_timestamp()::text,true)`.as('clock'),
    ])
    .executeTakeFirstOrThrow();
  return through;
}

/** `include` resolves server-keyed shared scopes for a bootstrap, whose
 * client does not know the account or world key yet. With `pages`, a private
 * snapshot beyond one page is answered by its first page; `request.page`
 * reads a later one. Without it, the snapshot is complete or refused. */
export function captureSyncV2(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  request: SyncV2ReadRequest,
  options?: CaptureOptions & { pages?: false },
): Promise<SyncV2Batch>;
export function captureSyncV2(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  request: SyncV2ReadRequest,
  options: CaptureOptions & { pages: boolean },
): Promise<SyncV2Batch | SyncV2SnapshotPage>;
export async function captureSyncV2(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  request: SyncV2ReadRequest,
  options: CaptureOptions & { pages?: boolean } = {},
): Promise<SyncV2Batch | SyncV2SnapshotPage> {
  if (!Number.isSafeInteger(request.generation) || request.generation < 0)
    throw new HttpError(400, 'INVALID_SYNC_GENERATION', 'Génération invalide.');
  if (request.page) {
    if (!options.pages || options.deltaOnly)
      throw new HttpError(400, 'INVALID_SYNC_PAGE', 'Pages de synchronisation non négociées.');
    return captureSnapshotPage(db, accountId, worldSlug, villageId, request, decodePageCursor(request.page.after));
  }
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      await sql`set transaction read only`.execute(tx);
      const village = await ownedVillage(tx, accountId, worldSlug, villageId);
      villageId = village.villageId;
      const scopes = new Map<string, SyncScope>();
      const scopeKey = (scope: SyncScope) => `${scope.kind}:${scope.key}`;
      // Only the private stream is implicit. Knowledge, catalog and offers are
      // optional subscriptions: a screen that does not display them must not
      // pay for their snapshot (spec §8.2).
      const included = {
        knowledge: { kind: 'knowledge' as const, key: accountId },
        manifest: { kind: 'manifest' as const, key: village.worldId },
        traffic: { kind: 'traffic' as const, key: village.worldId },
      };
      for (const scope of [
        { kind: 'village' as const, key: villageId },
        ...(options.include ?? []).map((kind) => included[kind]),
        ...request.scopes,
      ]) {
        if (
          (scope.kind === 'village' && scope.key !== villageId) ||
          (scope.kind === 'knowledge' && scope.key !== accountId) ||
          ((scope.kind === 'manifest' || scope.kind === 'traffic') && scope.key !== village.worldId) ||
          (scope.kind === 'offers' && scope.key !== 'all')
        )
          throw new HttpError(404, 'SYNC_SCOPE_NOT_FOUND', 'Périmètre introuvable.');
        if (scope.kind === 'spatial') {
          if (!/^(0|[1-9][0-9]*),(0|[1-9][0-9]*)$/.test(scope.key))
            throw new HttpError(400, 'INVALID_SYNC_SCOPE', 'Chunk invalide.');
          const [x, y] = scope.key.split(',').map(Number) as [number, number];
          if (
            !Number.isSafeInteger(x) ||
            !Number.isSafeInteger(y) ||
            x >= village.widthCells / village.chunkSize ||
            y >= village.heightCells / village.chunkSize
          )
            throw new HttpError(400, 'INVALID_SYNC_SCOPE', 'Chunk invalide.');
        }
        scopes.set(scopeKey(scope), scope);
      }
      if (scopes.size > 64) throw new HttpError(400, 'SYNC_SCOPE_LIMIT', 'Trop de périmètres.');
      const bases = new Map<string, SyncCursor>();
      for (const cursor of request.cursors) {
        if (!/^(0|[1-9][0-9]{0,18})$/.test(cursor.revision) || BigInt(cursor.revision) > 9223372036854775807n)
          throw new HttpError(400, 'INVALID_SYNC_CURSOR', 'Révision invalide.');
        const key = scopeKey(cursor);
        if (!scopes.has(key) || bases.has(key))
          throw new HttpError(400, 'INVALID_SYNC_CURSOR', 'Curseur hors abonnement.');
        bases.set(key, { epoch: cursor.epoch, revision: cursor.revision });
      }
      const through = await captureClock(tx);
      const captured = await readSubscribedJournal(
        tx,
        village.worldId,
        [...scopes].map(([key, scope]) => ({ scope, base: bases.get(key) ?? null })),
      );
      if (captured.kind !== 'ready')
        throw new HttpError(503, 'SYNC_SCOPE_NOT_INITIALIZED', 'Synchronisation indisponible.');
      const header = {
        protocol: 2 as const,
        worldId: village.worldId,
        villageId,
        generation: request.generation,
        observedAt: through.toISOString(),
      };
      // A stream resets instead of reading a snapshot it would discard.
      if (captured.coverage === 'scope-snapshot' && options.deltaOnly)
        return { ...header, coverage: 'scope-snapshot' as const, groups: [] };
      const context = { worldId: village.worldId, villageId, accountId, through };
      const groups: SyncV2Batch['groups'] = [];
      let next: string | null = null;
      for (const stream of captured.streams) {
        const snapshot = captured.coverage === 'scope-snapshot';
        let changes: SyncV2Batch['groups'][number]['changes'];
        if (stream.scope.kind === 'village') {
          if (snapshot && options.pages) {
            // The first page: its revision is the anchor of the next ones.
            const page = await readPrivateScopeSnapshotPage(tx, context, null);
            changes = page.changes;
            if (page.last)
              next = encodePageCursor({ ...page.last, epoch: stream.cursor.epoch, anchor: stream.cursor.revision });
          } else
            changes = snapshot
              ? await readPrivateScopeSnapshot(tx, context)
              : await readRegisteredPrivateChanges(tx, context, stream.references);
        } else if (stream.scope.kind === 'spatial') {
          const [chunkX, chunkY] = stream.scope.key.split(',').map(Number) as [number, number];
          const spatial = {
            ...context,
            worldSlug,
            chunkX,
            chunkY,
            widthCells: village.widthCells,
            heightCells: village.heightCells,
            chunkSize: village.chunkSize,
            generationVersion: village.generationVersion,
          };
          changes = snapshot
            ? await readSpatialScopeSnapshot(tx, spatial)
            : await readSpatialChanges(tx, spatial, stream.references);
        } else if (stream.scope.kind === 'traffic')
          changes = snapshot
            ? await readTrafficScopeSnapshot(tx, context)
            : await readTrafficChanges(tx, context, stream.references);
        else
          changes = snapshot
            ? await readSharedScopeSnapshot(tx, context, stream.scope)
            : await readSharedChanges(tx, context, stream.scope, stream.references);
        groups.push({
          stream: { ...stream.scope, epoch: stream.cursor.epoch },
          fromRevision: snapshot ? '0' : stream.fromRevision,
          toRevision: stream.cursor.revision,
          changes,
        });
      }
      return next
        ? { ...header, coverage: 'scope-snapshot-page' as const, next, groups }
        : { ...header, coverage: captured.coverage, groups };
    });
}

/** A later page of a paged private snapshot, in its own capture. A replaced
 * epoch, a revision below the anchor (restore) or an anchor below the
 * retention floor would make the catch-up delta impossible: the client must
 * start over, and this page is not read. */
async function captureSnapshotPage(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  request: SyncV2ReadRequest,
  cursor: PageCursor,
): Promise<SyncV2SnapshotPage> {
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      await sql`set transaction read only`.execute(tx);
      const village = await ownedVillage(tx, accountId, worldSlug, villageId);
      if (
        request.cursors.length ||
        request.scopes.some((scope) => scope.kind !== 'village' || scope.key !== village.villageId)
      )
        throw new HttpError(400, 'INVALID_SYNC_PAGE', 'Page de synchronisation invalide.');
      const through = await captureClock(tx);
      const counter = (
        await sql<{ epoch: string; revision: string; retainedFrom: string }>`select epoch::text,revision::text,
          retained_from::text as "retainedFrom" from game_sync_streams
        where world_id=${village.worldId} and stream_kind='village' and scope_key=${village.villageId}`.execute(tx)
      ).rows[0];
      if (!counter) throw new HttpError(503, 'SYNC_SCOPE_NOT_INITIALIZED', 'Synchronisation indisponible.');
      if (
        counter.epoch !== cursor.epoch ||
        BigInt(counter.revision) < BigInt(cursor.anchor) ||
        BigInt(cursor.anchor) < BigInt(counter.retainedFrom)
      )
        throw new HttpError(409, 'SYNC_SNAPSHOT_PAGE_EXPIRED', 'Instantané à relire depuis sa première page.');
      const context = { worldId: village.worldId, villageId: village.villageId, accountId, through };
      const page = await readPrivateScopeSnapshotPage(tx, context, cursor);
      return {
        protocol: 2,
        worldId: village.worldId,
        villageId: village.villageId,
        generation: request.generation,
        observedAt: through.toISOString(),
        coverage: 'scope-snapshot-page',
        next: page.last ? encodePageCursor({ ...cursor, ...page.last }) : null,
        groups: [
          {
            stream: { kind: 'village', key: village.villageId, epoch: counter.epoch },
            fromRevision: '0',
            toRevision: counter.revision,
            changes: page.changes,
          },
        ],
      };
    });
}

/** Private capture primitive, not an activation switch. Its eventual caller
 * must close the authorized cross-stream dependency set in this same MVCC
 * view before publishing a multi-stream batch. */
export async function capturePrivateSync(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  generation: number,
  base: SyncCursor | null,
): Promise<SyncV2Batch> {
  if (!Number.isSafeInteger(generation) || generation < 0)
    throw new HttpError(400, 'INVALID_SYNC_GENERATION', 'Génération invalide.');
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      await sql`set transaction read only`.execute(tx);
      const village = await ownedVillage(tx, accountId, worldSlug, villageId);
      const through = await captureClock(tx);
      const selection = await readJournalSelection(
        tx,
        village.worldId,
        { kind: 'village', key: villageId },
        base,
        (dependency) => dependency.kind === 'village' && dependency.key === villageId,
      );
      if (!selection.cursor) throw new HttpError(503, 'SYNC_SCOPE_NOT_INITIALIZED', 'Synchronisation indisponible.');
      const context = { worldId: village.worldId, villageId, through };
      const changes =
        selection.kind === 'delta'
          ? await readRegisteredPrivateChanges(tx, context, selection.references)
          : await readPrivateScopeSnapshot(tx, context);
      return {
        protocol: 2,
        worldId: village.worldId,
        villageId,
        generation,
        observedAt: through.toISOString(),
        coverage: selection.kind === 'delta' ? 'delta' : 'scope-snapshot',
        groups: [
          {
            stream: { kind: 'village', key: villageId, epoch: selection.cursor.epoch },
            fromRevision: selection.kind === 'delta' ? selection.fromRevision : '0',
            toRevision: selection.cursor.revision,
            changes,
          },
        ],
      };
    });
}
