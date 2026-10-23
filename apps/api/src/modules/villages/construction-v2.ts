import type { Kysely } from 'kysely';
import type { ConstructionConfirmationV2, SyncV2Batch } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { placeBuilding, type BuildingPlacement } from './construction.js';
import { publishPrivateEffects } from './sync-v2-effects.js';
import { expandGarden, upgradeBuilding, type AfterConstructionWrites, type ConstructionCommit } from './service.js';

/** Bounded placement answered on the V2 contract: same transaction, receipt
 * and rules as the historical path, then terminal journal publication and
 * the private effects read at H. An exact replay returns its original result
 * without effects or new publication. */
export async function placeBuildingV2(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  input: BuildingPlacement,
  durationOverride: number | null,
  generation: number,
): Promise<ConstructionConfirmationV2> {
  if (!Number.isSafeInteger(generation) || generation < 0) throw Error('Invalid synchronization generation');
  let effects: SyncV2Batch | undefined;
  const confirmed = await placeBuilding(
    db,
    accountId,
    slug,
    villageId,
    input,
    durationOverride,
    async (tx, economy) => {
      effects = await publishPrivateEffects(tx, economy, generation);
    },
  );
  const buildingId = confirmed.cells.find((cell) => cell.footprint)?.footprint?.buildingId ?? null;
  // The receipt's created_at is a transaction timestamp, not H: a replay
  // takes the original instant from the building's construction start.
  const started = confirmed.cells.find((cell) => cell.building?.id === buildingId)?.building?.constructionStartedAt;
  return {
    protocol: 2,
    worldId: confirmed.worldId,
    villageId: confirmed.villageId,
    commandId: confirmed.commandId,
    status: 'applied',
    commandTime: started ?? confirmed.commandTime,
    result: { buildingId },
    ...(effects ? { effects } : {}),
  };
}

interface CommandInput {
  commandId: string;
  expectedCosts?: Array<{ resourceCode: string; amount: number }> | undefined;
}

/** Shared tail of upgrade/expansion on the V2 contract: the historical
 * command in commit mode (no village snapshot), then terminal publication of
 * the private effects in the same transaction. A replay publishes nothing and
 * reports its receipt's instant. */
async function committedV2(
  db: Kysely<Database>,
  commandId: string,
  buildingId: string,
  generation: number,
  run: (afterWrites: AfterConstructionWrites) => Promise<ConstructionCommit>,
): Promise<ConstructionConfirmationV2> {
  if (!Number.isSafeInteger(generation) || generation < 0) throw Error('Invalid synchronization generation');
  let effects: SyncV2Batch | undefined, commandTime: Date | undefined;
  const commit = await run(async (tx, economy) => {
    commandTime = economy.through;
    effects = await publishPrivateEffects(tx, economy, generation);
  });
  if (!commandTime) {
    const receipt = await db
      .selectFrom('buildingCommandReceipts')
      .select('createdAt')
      .where('worldId', '=', commit.worldId)
      .where('villageId', '=', commit.villageId)
      .where('commandId', '=', commandId)
      .executeTakeFirst();
    commandTime = receipt ? new Date(receipt.createdAt as unknown as string) : commit.through;
  }
  const time = commandTime ?? commit.through;
  return {
    protocol: 2,
    worldId: commit.worldId,
    villageId: commit.villageId,
    commandId,
    status: 'applied',
    commandTime: time.toISOString(),
    result: { buildingId },
    ...(effects ? { effects } : {}),
  };
}

export function upgradeBuildingV2(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  buildingId: string,
  input: CommandInput & { expectedLevel?: number | undefined },
  durationOverride: number | null,
  generation: number,
): Promise<ConstructionConfirmationV2> {
  return committedV2(db, input.commandId, buildingId, generation, (afterWrites) =>
    upgradeBuilding(
      db,
      accountId,
      slug,
      villageId,
      buildingId,
      undefined,
      undefined,
      durationOverride,
      input.commandId,
      input.expectedCosts,
      input.expectedLevel,
      'commit',
      afterWrites,
    ),
  );
}

export function expandGardenV2(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  buildingId: string,
  input: CommandInput & { cells: Array<{ cellX: number; cellY: number }> },
  durationOverride: number | null,
  generation: number,
): Promise<ConstructionConfirmationV2> {
  return committedV2(db, input.commandId, buildingId, generation, (afterWrites) =>
    expandGarden(
      db,
      accountId,
      slug,
      villageId,
      buildingId,
      input.cells,
      durationOverride,
      input.commandId,
      input.expectedCosts,
      'commit',
      afterWrites,
    ),
  );
}
