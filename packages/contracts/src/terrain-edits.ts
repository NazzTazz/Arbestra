import { Type, type Static } from '@sinclair/typebox';

/** Instant terrain edits (docs/SPEC-TERRAFORMATION-INSTANTANEE.md): one batch
 * of gestures, applied in order at admission, all or nothing; free, without
 * workers or duration. */
export const TERRAIN_EDIT_GESTURES_PER_COMMAND = 32;
export const TERRAIN_EDIT_CELLS_PER_COMMAND = 1024;
const coordinate = Type.Integer({ minimum: 0, maximum: 1_000_000 });
const Cell = Type.Object({ cellX: coordinate, cellY: coordinate }, { additionalProperties: false });
export const TerrainEditGestureSchema = Type.Union([
  /** Free terraforming: every vertex of the cells to one height. */
  Type.Object(
    {
      buildingType: Type.Literal('terrain'),
      anchor: Cell,
      cells: Type.Array(Cell, { minItems: 1, maxItems: 256 }),
      height: Type.Number({ multipleOf: 0.25 }),
    },
    { additionalProperties: false },
  ),
  /** Footprint leveling before a building that needs flat ground. */
  Type.Object(
    {
      buildingType: Type.Union([Type.Literal('university'), Type.Literal('stonemason')]),
      anchor: Cell,
      quarterTurns: Type.Integer({ minimum: 0, maximum: 3 }),
    },
    { additionalProperties: false },
  ),
]);
export type TerrainEditGesture = Static<typeof TerrainEditGestureSchema>;
export const TerrainEditsRequestSchema = Type.Object(
  {
    commandId: Type.String({ format: 'uuid' }),
    gestures: Type.Array(TerrainEditGestureSchema, { minItems: 1, maxItems: TERRAIN_EDIT_GESTURES_PER_COMMAND }),
  },
  { additionalProperties: false },
);
export type TerrainEditsRequest = Static<typeof TerrainEditsRequestSchema>;
/** Compact receipt: gestures applied, gestures without effect, vertices written. */
export const TerrainEditsResultSchema = Type.Object(
  {
    gestures: Type.Integer({ minimum: 0 }),
    unchanged: Type.Integer({ minimum: 0 }),
    vertices: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type TerrainEditsResult = Static<typeof TerrainEditsResultSchema>;
