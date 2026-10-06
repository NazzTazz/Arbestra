import { Type, type Static } from '@sinclair/typebox';

export const ProcessingRecipeSchema = Type.Object({
  version: Type.Integer({ minimum: 1 }), inputResource: Type.String(), inputAmount: Type.Integer({ minimum: 1 }),
  outputResource: Type.String(), outputAmount: Type.Integer({ minimum: 1 }),
  workMs: Type.Integer({ minimum: 1 }), workerCap: Type.Integer({ minimum: 1, maximum: 3 }),
});
export type ProcessingRecipe = Static<typeof ProcessingRecipeSchema>;
export const ProcessingOrderSchema = Type.Object({
  id: Type.String({ format: 'uuid' }), buildingId: Type.String({ format: 'uuid' }),
  status: Type.Union(['running','pause-requested','cancel-requested','paused','blocked','completed','cancelled'].map(s => Type.Literal(s))),
  blockedReason: Type.Union([Type.Literal('missing-input'), Type.Literal('missing-workers'), Type.Null()]),
  requestedLots: Type.Integer(), completedLots: Type.Integer(), workerCount: Type.Integer(),
  createdAt: Type.String({ format: 'date-time' }), finishedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  currentLot: Type.Union([Type.Object({
    id: Type.String({ format: 'uuid' }), inputResource: Type.String(), inputAmount: Type.Integer(),
    outputResource: Type.String(), outputAmount: Type.Integer(),
    startedAt: Type.String({ format: 'date-time' }), completesAt: Type.String({ format: 'date-time' }),
  }), Type.Null()]),
});
export type ProcessingOrder = Static<typeof ProcessingOrderSchema>;
const command = { commandId: Type.String({ format: 'uuid' }) };
export const ProcessingCommandSchema = Type.Union([
  Type.Object({ ...command, action: Type.Literal('start'), buildingId: Type.String({ format: 'uuid' }),
    lots: Type.Integer({ minimum: 1, maximum: 20 }), workerCount: Type.Integer({ minimum: 1, maximum: 3 }) }, { additionalProperties: false }),
  Type.Object({ ...command, action: Type.Literal('resume'), orderId: Type.String({ format: 'uuid' }),
    workerCount: Type.Integer({ minimum: 1, maximum: 3 }) }, { additionalProperties: false }),
  Type.Object({ ...command, action: Type.Union([Type.Literal('pause'), Type.Literal('cancel')]),
    orderId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }),
]);
export type ProcessingCommand = Static<typeof ProcessingCommandSchema>;
export const ProcessingPreviewSchema = Type.Object({
  valid: Type.Boolean(), message: Type.Union([Type.String(), Type.Null()]),
  durationMs: Type.Integer({ minimum: 0 }), inputAmount: Type.Integer({ minimum: 0 }), outputAmount: Type.Integer({ minimum: 0 }),
});
export type ProcessingPreview = Static<typeof ProcessingPreviewSchema>;
