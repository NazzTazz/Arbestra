import { sql, type Kysely } from 'kysely';
import type { SyncV2Batch, SyncV2ReadRequest } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { ownedVillage } from './service.js';
import { readJournalSelection, readSubscribedJournal, type SyncCursor, type SyncScope } from './sync-v2-journal.js';
import { readPrivateScopeSnapshot, readRegisteredPrivateChanges } from './sync-v2-readers.js';
import { readSpatialChanges, readSpatialScopeSnapshot } from './sync-v2-spatial-readers.js';
import { readSharedChanges, readSharedScopeSnapshot } from './sync-v2-shared-readers.js';
import { readTrafficChanges, readTrafficScopeSnapshot } from './sync-v2-traffic-readers.js';

export type SyncV2SharedInclude = 'knowledge' | 'manifest' | 'traffic';

/** `include` resolves server-keyed shared scopes for a bootstrap, whose
 * client does not know the account or world key yet. */
export async function captureSyncV2(db: Kysely<Database>, accountId: string, worldSlug: string, villageId: string,
  request: SyncV2ReadRequest, options: { include?: readonly SyncV2SharedInclude[] } = {}): Promise<SyncV2Batch> {
  if (!Number.isSafeInteger(request.generation) || request.generation < 0) throw new HttpError(400, 'INVALID_SYNC_GENERATION', 'Génération invalide.');
  return db.transaction().setIsolationLevel('repeatable read').execute(async tx => {
    await sql`set transaction read only`.execute(tx);
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    villageId = village.villageId;
    const scopes = new Map<string, SyncScope>();
    const scopeKey = (scope: SyncScope) => `${scope.kind}:${scope.key}`;
    // Only the private stream is implicit. Knowledge, catalog and offers are
    // optional subscriptions: a screen that does not display them must not
    // pay for their snapshot (spec §8.2).
    const included = { knowledge: { kind: 'knowledge' as const, key: accountId }, manifest: { kind: 'manifest' as const, key: village.worldId },
      traffic: { kind: 'traffic' as const, key: village.worldId } };
    for (const scope of [
      { kind: 'village' as const, key: villageId }, ...(options.include ?? []).map(kind => included[kind]), ...request.scopes,
    ]) {
      if (scope.kind === 'village' && scope.key !== villageId || scope.kind === 'knowledge' && scope.key !== accountId
        || (scope.kind === 'manifest' || scope.kind === 'traffic') && scope.key !== village.worldId || scope.kind === 'offers' && scope.key !== 'all')
        throw new HttpError(404, 'SYNC_SCOPE_NOT_FOUND', 'Périmètre introuvable.');
      if (scope.kind === 'spatial') {
        if (!/^(0|[1-9][0-9]*),(0|[1-9][0-9]*)$/.test(scope.key)) throw new HttpError(400, 'INVALID_SYNC_SCOPE', 'Chunk invalide.');
        const [x, y] = scope.key.split(',').map(Number) as [number, number];
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x >= village.widthCells / village.chunkSize || y >= village.heightCells / village.chunkSize)
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
      if (!scopes.has(key) || bases.has(key)) throw new HttpError(400, 'INVALID_SYNC_CURSOR', 'Curseur hors abonnement.');
      bases.set(key, { epoch: cursor.epoch, revision: cursor.revision });
    }
    const { through } = await tx.selectNoFrom([sql<Date>`statement_timestamp()`.as('through'),
      sql<string>`set_config('arbestra.economy_through',statement_timestamp()::text,true)`.as('clock')]).executeTakeFirstOrThrow();
    const captured = await readSubscribedJournal(tx, village.worldId, [...scopes].map(([key, scope]) => ({ scope, base: bases.get(key) ?? null })));
    if (captured.kind !== 'ready') throw new HttpError(503, 'SYNC_SCOPE_NOT_INITIALIZED', 'Synchronisation indisponible.');
    const context = { worldId: village.worldId, villageId, accountId, through };
    const groups: SyncV2Batch['groups'] = [];
    for (const stream of captured.streams) {
      const snapshot = captured.coverage === 'scope-snapshot';
      let changes: SyncV2Batch['groups'][number]['changes'];
      if (stream.scope.kind === 'village') changes = snapshot
        ? await readPrivateScopeSnapshot(tx, context) : await readRegisteredPrivateChanges(tx, context, stream.references);
      else if (stream.scope.kind === 'spatial') {
        const [chunkX, chunkY] = stream.scope.key.split(',').map(Number) as [number, number];
        const spatial = { ...context, worldSlug, chunkX, chunkY, widthCells: village.widthCells, heightCells: village.heightCells,
          chunkSize: village.chunkSize, generationVersion: village.generationVersion };
        changes = snapshot ? await readSpatialScopeSnapshot(tx, spatial) : await readSpatialChanges(tx, spatial, stream.references);
      } else if (stream.scope.kind === 'traffic') changes = snapshot
        ? await readTrafficScopeSnapshot(tx, context) : await readTrafficChanges(tx, context, stream.references);
      else changes = snapshot ? await readSharedScopeSnapshot(tx, context, stream.scope) : await readSharedChanges(tx, context, stream.scope, stream.references);
      groups.push({ stream: { ...stream.scope, epoch: stream.cursor.epoch }, fromRevision: snapshot ? '0' : stream.fromRevision,
        toRevision: stream.cursor.revision, changes });
    }
    return { protocol: 2, worldId: village.worldId, villageId, generation: request.generation, observedAt: through.toISOString(),
      coverage: captured.coverage, groups };
  });
}

/** Private capture primitive, not an activation switch. Its eventual caller
 * must close the authorized cross-stream dependency set in this same MVCC
 * view before publishing a multi-stream batch. */
export async function capturePrivateSync(db: Kysely<Database>, accountId: string, worldSlug: string,
  villageId: string, generation: number, base: SyncCursor | null): Promise<SyncV2Batch> {
  if (!Number.isSafeInteger(generation) || generation < 0) throw new HttpError(400, 'INVALID_SYNC_GENERATION', 'Génération invalide.');
  return db.transaction().setIsolationLevel('repeatable read').execute(async tx => {
    await sql`set transaction read only`.execute(tx);
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    const { through } = await tx.selectNoFrom([
      sql<Date>`statement_timestamp()`.as('through'),
      sql<string>`set_config('arbestra.economy_through',statement_timestamp()::text,true)`.as('clock'),
    ]).executeTakeFirstOrThrow();
    const selection = await readJournalSelection(tx, village.worldId, { kind: 'village', key: villageId }, base,
      dependency => dependency.kind === 'village' && dependency.key === villageId);
    if (!selection.cursor) throw new HttpError(503, 'SYNC_SCOPE_NOT_INITIALIZED', 'Synchronisation indisponible.');
    const context = { worldId: village.worldId, villageId, through };
    const changes = selection.kind === 'delta'
      ? await readRegisteredPrivateChanges(tx, context, selection.references)
      : await readPrivateScopeSnapshot(tx, context);
    return { protocol: 2, worldId: village.worldId, villageId, generation, observedAt: through.toISOString(),
      coverage: selection.kind === 'delta' ? 'delta' : 'scope-snapshot',
      groups: [{ stream: { kind: 'village', key: villageId, epoch: selection.cursor.epoch },
        fromRevision: selection.kind === 'delta' ? selection.fromRevision : '0', toRevision: selection.cursor.revision, changes }],
    };
  });
}
