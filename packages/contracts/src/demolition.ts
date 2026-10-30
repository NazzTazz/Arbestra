import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { ROAD_CELLS_PER_COMMAND } from './road-cells.js';

/** Demolition (docs/SPEC-DEMOLITION.md §9): immediate at admission, without
 * duration, workers or refund. Gardens are named by cell (only the touched
 * plots leave), other buildings by id, braziers by vertex. */
export const DEMOLITION_BUILDINGS_PER_COMMAND = 64;
export const DEMOLITION_GARDEN_CELLS_PER_COMMAND = 256;
export const DEMOLITION_BRAZIERS_PER_COMMAND = 64;

const coordinate = Type.Integer({ minimum: 0, maximum: 1_000_000 });
const cell = Type.Object({ cellX: coordinate, cellY: coordinate }, { additionalProperties: false });
export const DemolitionRequestSchema = Type.Object(
  {
    commandId: Type.String({ format: 'uuid' }),
    buildings: Type.Array(Type.Object({ id: Type.String({ format: 'uuid' }) }, { additionalProperties: false }), {
      maxItems: DEMOLITION_BUILDINGS_PER_COMMAND,
    }),
    gardenCells: Type.Array(cell, { maxItems: DEMOLITION_GARDEN_CELLS_PER_COMMAND }),
    roadCells: Type.Array(cell, { maxItems: ROAD_CELLS_PER_COMMAND }),
    braziers: Type.Array(Type.Object({ vertexX: coordinate, vertexY: coordinate }, { additionalProperties: false }), {
      maxItems: DEMOLITION_BRAZIERS_PER_COMMAND,
    }),
  },
  { additionalProperties: false },
);
export type DemolitionRequest = Static<typeof DemolitionRequestSchema>;
/** Compact receipt: what left, per kind, and the named targets already gone. */
export const DemolitionResultSchema = Type.Object(
  {
    buildings: Type.Integer({ minimum: 0 }),
    gardenCells: Type.Integer({ minimum: 0 }),
    roadCells: Type.Integer({ minimum: 0 }),
    braziers: Type.Integer({ minimum: 0 }),
    unchanged: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type DemolitionResult = Static<typeof DemolitionResultSchema>;
export const demolitionRequestIsValid = (value: unknown): value is DemolitionRequest =>
  Value.Check(DemolitionRequestSchema, value);
