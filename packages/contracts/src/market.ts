import { Type, type Static } from '@sinclair/typebox';

export const MARKET_DELIVERY_MS = 600_000;
export const MARKET_MAX_AMOUNT = 1_000_000_000;
export const MARKET_PRIORITY_MS = 600_000;
export const MARKET_QUANTITIES = [50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
export const MARKET_TRAVEL_SECONDS = [30, 60, 120, 300, 600, 1200, 1800, 3600] as const;
export function marketWorkers(outbound: number, inbound: number): number {
  return Math.ceil(Math.max(outbound, inbound) / 250);
}
export function oracleCost(wanted: number, offeredValue: number, wantedValue: number): number {
  return Number((BigInt(wanted) * BigInt(wantedValue) * 10n + BigInt(offeredValue) * 7n - 1n) / (BigInt(offeredValue) * 7n));
}
const ResourceCode = Type.String({ minLength: 1, maxLength: 64 });
const Quantity = Type.Integer({ minimum: 1, maximum: MARKET_MAX_AMOUNT });
const TradeTerms = {
  requestedResource: ResourceCode, requestedAmount: Quantity,
  offeredResource: ResourceCode, offeredAmount: Quantity,
  maxTravelSeconds: Type.Integer({ minimum: 1, maximum: 3600 }),
};
export const TradeCommandSchema = Type.Union([
  Type.Object({ action: Type.Literal('publish'), commandId: Type.String({ format: 'uuid' }), ...TradeTerms }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('cancel'), commandId: Type.String({ format: 'uuid' }), offerId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('accept'), commandId: Type.String({ format: 'uuid' }), offerId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('oracle'), commandId: Type.String({ format: 'uuid' }), requestedResource: ResourceCode, requestedAmount: Quantity, offeredResource: ResourceCode, expectedCost: Quantity }, { additionalProperties: false }),
]);
export type TradeCommand = Static<typeof TradeCommandSchema>;
export const TradeOfferSchema = Type.Object({
  id: Type.String(), villageId: Type.String(), villageName: Type.String(), ...TradeTerms,
  status: Type.Union([Type.Literal('open'), Type.Literal('cancelled'), Type.Literal('accepted'), Type.Literal('oracle')]),
  createdAt: Type.String(), oracleAt: Type.String(), oracleEligible: Type.Boolean(),
});
export type TradeOffer = Static<typeof TradeOfferSchema>;
export const MarketJourneySchema = Type.Object({
  id: Type.String(), villageId: Type.String(), destinationVillageId: Type.String(), workerCount: Type.Integer(),
  path: Type.Array(Type.Object({ cellX: Type.Number(), cellY: Type.Number() })),
  startedAt: Type.String(), arrivesAt: Type.String(), returnsAt: Type.String(),
});
export type MarketJourney = Static<typeof MarketJourneySchema>;
export const TradePageSchema = Type.Object({ offers: Type.Array(TradeOfferSchema), nextCursor: Type.Union([Type.String(), Type.Null()]) });
export type TradePage = Static<typeof TradePageSchema>;
export const TradePreviewSchema = Type.Object({ travelMs: Type.Integer(), workerCount: Type.Integer(), availableWorkers: Type.Integer() });
export type TradePreview = Static<typeof TradePreviewSchema>;
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
  offers: Type.Optional(Type.Array(TradeOfferSchema)),
  journeys: Type.Optional(Type.Array(MarketJourneySchema)),
  unlocked: Type.Boolean(), deliveryMs: Type.Integer(), commissionPercent: Type.Integer(),
  resources: Type.Array(Type.Object({ code: Type.String(), displayName: Type.String(), iconKey: Type.String(),
    valueUnits: Type.Integer({ minimum: 1 }) })),
  exchanges: Type.Array(MarketExchangeSchema),
});
export type MarketState = Static<typeof MarketStateSchema>;
