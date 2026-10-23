import { sql, type Transaction } from 'kysely';
import type { SyncV2Batch } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import type { VillageEconomy } from './reconcile-economy.js';
import { readRegisteredPrivateChanges, type SyncEntityReference } from './sync-v2-readers.js';
import type { SyncDependency } from './sync-v2-journal.js';

/** Terminal publication of the command's transaction, then the effects on
 * the private stream, read at H in that same transaction. Callers must not
 * write afterwards: a later business write would be rejected. */
export async function publishPrivateEffects(
  tx: Transaction<Database>,
  economy: VillageEconomy,
  generation: number,
): Promise<SyncV2Batch | undefined> {
  const { worldId, villageId, through } = economy;
  const { published } = (
    await sql<{ published: SyncDependency[] }>`select game_sync_publish() as published`.execute(tx)
  ).rows[0]!;
  const privateScope = published.find(
    (scope) => scope.worldId === worldId && scope.kind === 'village' && scope.key === villageId,
  );
  if (!privateScope) return undefined;
  const { changes: references } = (
    await sql<{ changes: SyncEntityReference[] }>`select changes from game_sync_changes
    where world_id=${worldId} and stream_kind='village' and scope_key=${villageId}
      and epoch=${privateScope.epoch}::uuid and revision=${privateScope.revision}::bigint`.execute(tx)
  ).rows[0]!;
  return {
    protocol: 2,
    worldId,
    villageId,
    generation,
    coverage: 'effects',
    observedAt: through.toISOString(),
    groups: [
      {
        stream: { kind: 'village', key: villageId, epoch: privateScope.epoch },
        fromRevision: privateScope.revision,
        toRevision: privateScope.revision,
        changes: await readRegisteredPrivateChanges(tx, economy, references),
      },
    ],
  };
}
