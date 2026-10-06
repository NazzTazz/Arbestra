import { Type, type Static } from '@sinclair/typebox';

export const MARKET_DELIVERY_MS = 600_000;
export const MARKET_MAX_AMOUNT = 1_000_000_000;
export function oracleAmount(amount: number, offeredValue: number, requestedValue: number): number {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MARKET_MAX_AMOUNT
    || !Number.isSafeInteger(offeredValue) || offeredValue < 1
    || !Number.isSafeInteger(requestedValue) || requestedValue < 1) return 0;
  return Number(BigInt(amount) * BigInt(offeredValue) * 7n / (BigInt(requestedValue) * 10n));
}
export const MarketRequestSchema = Type.Object({
  offeredResource: Type.String({ minLength: 1, maxLength: 64 }),
  requestedResource: Type.String({ minLength: 1, maxLength: 64 }),
  amount: Type.Integer({ minimum: 1, maximum: MARKET_MAX_AMOUNT }),
}, { additionalProperties: false });
export type MarketRequest = Static<typeof MarketRequestSchema>;
export const MarketCommandSchema = Type.Object({
  ...MarketRequestSchema.properties, commandId: Type.String({ format: 'uuid' }),
  expectedReceivedAmount: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export type MarketCommand = Static<typeof MarketCommandSchema>;
export const MarketPreviewSchema = Type.Object({
  valid: Type.Boolean(), message: Type.Union([Type.String(), Type.Null()]),
  receivedAmount: Type.Integer({ minimum: 0 }), deliveryMs: Type.Integer(),
});
export type MarketPreview = Static<typeof MarketPreviewSchema>;
export const MarketExchangeSchema = Type.Object({
  id: Type.String({ format: 'uuid' }), offeredResource: Type.String(), requestedResource: Type.String(),
  offeredAmount: Type.Integer(), receivedAmount: Type.Integer(),
  startedAt: Type.String({ format: 'date-time' }), completesAt: Type.String({ format: 'date-time' }),
  completedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});
export const MarketStateSchema = Type.Object({
  unlocked: Type.Boolean(), deliveryMs: Type.Integer(), commissionPercent: Type.Integer(),
  resources: Type.Array(Type.Object({ code: Type.String(), displayName: Type.String(), iconKey: Type.String(),
    valueUnits: Type.Integer({ minimum: 1 }) })),
  exchanges: Type.Array(MarketExchangeSchema),
});
export type MarketState = Static<typeof MarketStateSchema>;
