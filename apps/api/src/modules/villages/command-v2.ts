import type { SyncV2Batch, VillageCommandConfirmationV2 } from '@arbestra/contracts';
import { HttpError } from '../../errors.js';
import { publishPrivateEffects } from './sync-v2-effects.js';
import type { AfterConstructionWrites, ConstructionCommit } from './service.js';

/** A village gesture answered on the V2 contract: the historical command in
 * commit mode (no village snapshot), then terminal publication of the
 * private effects in the same transaction. The client's UUID identifies the
 * gesture; these commands are naturally idempotent and keep no receipt. */
export async function villageCommandV2(
  commandId: string | undefined,
  generation: number,
  run: (afterWrites: AfterConstructionWrites) => Promise<ConstructionCommit>,
): Promise<VillageCommandConfirmationV2> {
  if (!commandId) throw new HttpError(400, 'INVALID_V2_COMMAND', 'Commande V2 incomplète.');
  if (!Number.isSafeInteger(generation) || generation < 0) throw Error('Invalid synchronization generation');
  let effects: SyncV2Batch | undefined, commandTime: Date | undefined;
  const commit = await run(async (tx, economy) => {
    commandTime = economy.through;
    effects = await publishPrivateEffects(tx, economy, generation);
  });
  return {
    protocol: 2,
    worldId: commit.worldId,
    villageId: commit.villageId,
    commandId,
    status: 'applied',
    commandTime: (commandTime ?? commit.through).toISOString(),
    ...(effects ? { effects } : {}),
  };
}
