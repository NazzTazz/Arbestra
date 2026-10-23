import { Type, type Static } from '@sinclair/typebox';
const point = Type.Object({ cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }) });
export const ExpeditionIntentSchema = Type.Object({
  commandId: Type.String({ format: 'uuid' }),
  action: Type.Union([Type.Literal('survey'), Type.Literal('explore')]),
  target: point,
  budgetSeconds: Type.Integer({ minimum: 60, maximum: 86400 }),
});
export type ExpeditionIntent = Static<typeof ExpeditionIntentSchema>;
const base = {
  kind: Type.Literal('expedition-receipt'),
  commandId: Type.String({ format: 'uuid' }),
  worldId: Type.String({ format: 'uuid' }),
  villageId: Type.String({ format: 'uuid' }),
  version: Type.Integer({ minimum: 1 }),
  receivedAt: Type.String({ format: 'date-time' }),
  requestedTarget: point,
};
export const ExpeditionReceiptSchema = Type.Union([
  Type.Object({ ...base, status: Type.Literal('pending') }),
  Type.Object({
    ...base,
    status: Type.Literal('admitted'),
    activityId: Type.String({ format: 'uuid' }),
    startedAt: Type.String({ format: 'date-time' }),
    completesAt: Type.String({ format: 'date-time' }),
    effectiveTarget: point,
  }),
  Type.Object({
    ...base,
    status: Type.Union([Type.Literal('rejected'), Type.Literal('failed')]),
    code: Type.String(),
    message: Type.String(),
  }),
]);
export type ExpeditionReceipt = Static<typeof ExpeditionReceiptSchema>;
export function mergeExpeditionReceipt(
  current: ExpeditionReceipt | undefined,
  next: ExpeditionReceipt,
): ExpeditionReceipt {
  if (!current) return next;
  if (current.worldId !== next.worldId || current.villageId !== next.villageId || current.commandId !== next.commandId)
    return current;
  if (current.status !== 'pending' || next.version <= current.version) return current;
  return next;
}

export function expeditionReceiptIsValid(value: unknown): value is ExpeditionReceipt {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const point = (p: unknown) =>
    !!p &&
    typeof p === 'object' &&
    Number.isInteger((p as { cellX: unknown }).cellX) &&
    Number.isInteger((p as { cellY: unknown }).cellY);
  if (
    r.kind !== 'expedition-receipt' ||
    typeof r.commandId !== 'string' ||
    typeof r.worldId !== 'string' ||
    typeof r.villageId !== 'string' ||
    !Number.isSafeInteger(r.version) ||
    Number(r.version) < 1 ||
    typeof r.receivedAt !== 'string' ||
    !point(r.requestedTarget)
  )
    return false;
  if (r.status === 'pending') return true;
  if (r.status === 'admitted')
    return (
      typeof r.activityId === 'string' &&
      typeof r.startedAt === 'string' &&
      typeof r.completesAt === 'string' &&
      point(r.effectiveTarget)
    );
  return (
    (r.status === 'failed' || r.status === 'rejected') && typeof r.code === 'string' && typeof r.message === 'string'
  );
}
