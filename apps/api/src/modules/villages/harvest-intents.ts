import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { type Kysely } from 'kysely';
import { canonicalWoodTrees } from '@arbestra/contracts';
import type { HarvestIntent, HarvestReceipt, ExploitationRequest } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { ownedVillage, prepareExploitation, prepareWorksiteSelection } from './service.js';
import { beginVillageEconomy } from './reconcile-economy.js';
import { WAKE_EXTRACTION_WORKSITE_TASK } from '../deposits/worksites.js';
import { appendPoolTargets } from '../deposits/extraction-pools.js';
import { readStoneDeposit } from '../deposits/stone-extractions.js';
import { designatedWood, woodDesignations } from '../deposits/woodland.js';
import { materializeCohorts } from '../population/work.js';
import { normalizeCell } from '../worlds/coordinates.js';

/** The canonical form of an intent, compared on replay. Cases are sorted;
 * designated trees keep the player's order (docs/SPEC-BOIS-ARBRE-UNITE.md),
 * and an intent without designation keeps its historical form. */
export function canonicalHarvestIntent(raw: HarvestIntent, village: { widthCells: number; heightCells: number }) {
  const wood = [...new Set(raw.wood.map((id) => id.toLowerCase()))].sort();
  woodDesignations(wood, raw.woodTrees);
  const woodTrees = canonicalWoodTrees(raw.woodTrees);
  const request: HarvestIntent = {
    commandId: raw.commandId.toLowerCase(),
    gardens: [
      ...new Map(
        raw.gardens.map((c) => {
          const p = {
            cellX: normalizeCell(c.cellX, village.widthCells),
            cellY: normalizeCell(c.cellY, village.heightCells),
          };
          return [`${p.cellX}:${p.cellY}`, p];
        }),
      ).values(),
    ].sort((a, b) => a.cellX - b.cellX || a.cellY - b.cellY),
    wood,
    ...(woodTrees ? { woodTrees } : {}),
    stone: [...new Set(raw.stone.map((id) => id.toLowerCase()))].sort(),
  };
  return request;
}

/** A receipt confirms durable targets, not delivered stock or an immediate departure.
 * Existing admission/worker code chooses teams, routes and lots after commit.
 */
export async function acceptHarvestIntent(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  raw: HarvestIntent,
): Promise<HarvestReceipt> {
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, worldSlug, villageId);
    const request = canonicalHarvestIntent(raw, village);
    const economy = await beginVillageEconomy(
      tx,
      village.worldId,
      villageId,
      undefined,
      [],
      [...request.wood, ...request.stone],
    );
    const previous = await tx
      .selectFrom('harvestIntents')
      .selectAll()
      .where('worldId', '=', village.worldId)
      .where('villageId', '=', villageId)
      .where('commandId', '=', request.commandId)
      .executeTakeFirst();
    if (previous) {
      if (!isDeepStrictEqual(previous.request, request))
        throw new HttpError(409, 'COMMAND_ID_CONFLICT', 'Cette intention a déjà été utilisée différemment.');
      return previous.receipt;
    }
    if (!request.gardens.length && !request.wood.length && !request.stone.length)
      throw new HttpError(400, 'HARVEST_EMPTY', 'Aucune ressource désignée.');
    const receipt: HarvestReceipt = { commandId: request.commandId, accepted: [], refused: [] };
    const cohorts = await materializeCohorts(tx, village.worldId, villageId, economy.through);
    const cap = Math.max(
      1,
      Math.min(
        21,
        cohorts.reduce((n, c) => n + c.memberCount, 0),
      ),
    );
    const { woodTrees: _designation, ...targets } = request;
    void _designation;
    const command: ExploitationRequest = {
      ...targets,
      workerCap: cap,
      durationMs: null,
      cohortId: null,
      woodMode: 'cut',
      initialAdmission: 'allow-wait',
    };
    let gardenPlan: Awaited<ReturnType<typeof prepareExploitation>>['plan'] = null;
    if (request.gardens.length) {
      const prepared = await prepareExploitation(tx, village, economy, accountId, { ...command, wood: [], stone: [] });
      command.gardens = prepared.preview.gardens;
      gardenPlan = prepared.plan;
      receipt.refused.push(...prepared.preview.excluded);
      for (const cell of command.gardens) {
        const { projectGardenPlot } = await import('./economy.js');
        const plot = await projectGardenPlot(tx, village.worldId, cell.cellX, cell.cellY, economy.through);
        receipt.accepted.push({
          key: `garden:${cell.cellX}:${cell.cellY}`,
          ...cell,
          resource: 'carrot',
          amount: Math.floor(plot.amount),
        });
      }
    }
    const queued: Record<'wood' | 'stone', Array<{ featureId: string; treeIndices?: number[] | null }>> = {
      wood: [],
      stone: [],
    };
    for (const family of ['wood', 'stone'] as const) {
      // Wood: designated trees join the queue, even on a case already queued.
      const selection = await prepareWorksiteSelection(
        tx,
        village,
        economy,
        {
          commandId: request.commandId,
          mode: family === 'wood' ? 'cut' : 'extract',
          workerCap: 10,
          featureIds: request[family],
          ...(family === 'wood' && request.woodTrees ? { woodTrees: request.woodTrees } : {}),
        },
        undefined,
        family === 'wood',
      );
      queued[family] = selection.included;
      command[family] = selection.included.map((i) => i.featureId);
      receipt.refused.push(
        ...selection.excluded.map((i) => ({
          key: i.featureId,
          reason: i.reason,
          ...(i.treeIndex !== undefined ? { treeIndex: i.treeIndex } : {}),
        })),
      );
      for (const target of selection.included) {
        const deposit = await readStoneDeposit(tx, village.worldId, target.featureId);
        receipt.accepted.push({
          key: target.featureId,
          cellX: target.cellX,
          cellY: target.cellY,
          resource: family,
          ...(target.treeIndices
            ? {
                amount: await designatedWood(tx, village.worldId, target.featureId, target.treeIndices),
                treeIndices: target.treeIndices,
              }
            : { amount: Math.max(0, deposit.remainingAmount) }),
        });
      }
    }
    let orderId: string | null = null;
    if (receipt.accepted.length) {
      if (gardenPlan) {
        const order = await tx
          .insertInto('exploitationOrders')
          .values({
            worldId: village.worldId,
            villageId,
            commandId: request.commandId,
            request: JSON.stringify(command),
            workerCap: cap,
            confirmedAt: economy.through,
            deadline: null,
            cohortId: null,
            initialRemaining: 0,
            gardenStatus: 'pending',
            gardenPlan: JSON.stringify(gardenPlan),
            nextWakeAt: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        orderId = order.id;
      }
      for (const family of ['wood', 'stone'] as const)
        if (queued[family].length) {
          await appendPoolTargets(tx, economy, family, queued[family]);
        }
      if (gardenPlan)
        await tx
          .insertInto('scheduledTasks')
          .values({
            worldId: village.worldId,
            taskType: WAKE_EXTRACTION_WORKSITE_TASK,
            subjectId: randomUUID(),
            payload: { exploitationOrderId: orderId },
            dueAt: economy.through,
            availableAt: economy.through,
            completedAt: null,
            lastError: null,
          })
          .execute();
    }
    await tx
      .insertInto('harvestIntents')
      .values({
        worldId: village.worldId,
        villageId,
        commandId: request.commandId,
        request: JSON.stringify(request),
        receipt: JSON.stringify(receipt),
        orderId,
        createdAt: economy.through,
      })
      .execute();
    return receipt;
  });
}
