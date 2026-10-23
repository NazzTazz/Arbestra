import { sql, type Kysely } from 'kysely';
import type { CommandReceiptRead, CommandReceiptReadResponse } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { ownedVillage } from './service.js';

/** An absent receipt means unknown, not rejected. Never re-execute a command
 * to answer this read, and never return stored private request payloads. */
export async function readCommandReceipts(
  db: Kysely<Database>,
  accountId: string,
  worldSlug: string,
  villageId: string,
  request: CommandReceiptRead,
): Promise<CommandReceiptReadResponse> {
  if (!request.commands.length || request.commands.length > 32)
    throw new HttpError(400, 'INVALID_RECEIPT_SELECTION', 'Sélection de reçus invalide.');
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      await sql`set transaction read only`.execute(tx);
      const village = await ownedVillage(tx, accountId, worldSlug, villageId);
      const processingIds = [
        ...new Set(request.commands.filter((c) => c.family === 'processing').map((c) => c.commandId)),
      ];
      const constructionIds = [
        ...new Set(request.commands.filter((c) => c.family === 'construction').map((c) => c.commandId)),
      ];
      const receipts: CommandReceiptReadResponse['receipts'] = [];
      if (processingIds.length) {
        const rows = await tx
          .selectFrom('processingCommandReceipts')
          .select(['commandId', 'orderId', 'commandTime'])
          .where('worldId', '=', village.worldId)
          .where('villageId', '=', villageId)
          .where('commandId', 'in', processingIds)
          .execute();
        for (const row of rows)
          receipts.push({
            family: 'processing',
            commandId: row.commandId,
            status: 'applied',
            commandTime: row.commandTime?.toISOString() ?? null,
            result: { orderId: row.orderId },
          });
      }
      if (constructionIds.length) {
        const rows = await tx
          .selectFrom('buildingCommandReceipts')
          .select(['commandId', 'buildingId', 'commandType'])
          .where('worldId', '=', village.worldId)
          .where('villageId', '=', villageId)
          .where('commandId', 'in', constructionIds)
          .execute();
        // created_at is a transaction timestamp in legacy receipts, not the
        // post-lock economic bound. Do not mislabel it commandTime.
        for (const row of rows)
          receipts.push({
            family: 'construction',
            commandId: row.commandId,
            status: 'applied',
            commandTime: null,
            result: { buildingId: row.buildingId, action: row.commandType },
          });
      }
      receipts.sort((a, b) => a.family.localeCompare(b.family) || a.commandId.localeCompare(b.commandId));
      return { worldId: village.worldId, villageId, receipts };
    });
}
