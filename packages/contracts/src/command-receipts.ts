import { Type, type Static } from '@sinclair/typebox';

const uuid = Type.String({ format: 'uuid' });
export const CommandReceiptReadSchema = Type.Object({
  commands: Type.Array(Type.Object({
    family: Type.Union([Type.Literal('processing'), Type.Literal('construction')]), commandId: uuid,
  }, { additionalProperties: false }), { minItems: 1, maxItems: 32 }),
}, { additionalProperties: false });
const base = { commandId: uuid, status: Type.Literal('applied'),
  commandTime: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]) };
export const CommandReceiptSchema = Type.Union([
  Type.Object({ ...base, family: Type.Literal('processing'), result: Type.Object({
    orderId: Type.Union([uuid, Type.Null()]),
  }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ ...base, family: Type.Literal('construction'), result: Type.Object({
    buildingId: Type.Union([uuid, Type.Null()]),
    action: Type.Union([Type.Literal('construct'), Type.Literal('upgrade'), Type.Literal('expand')]),
  }, { additionalProperties: false }) }, { additionalProperties: false }),
]);
export const CommandReceiptReadResponseSchema = Type.Object({ worldId: uuid, villageId: uuid,
  receipts: Type.Array(CommandReceiptSchema, { maxItems: 32 }),
}, { additionalProperties: false });
export type CommandReceiptRead = Static<typeof CommandReceiptReadSchema>;
export type CommandReceiptReadResponse = Static<typeof CommandReceiptReadResponseSchema>;
