import { Type } from '@sinclair/typebox';
import { NaturalFeatureSchema } from './villages.js';
import { TerrainChunkSchema, TerrainBuildingExteriorSchema } from './terrain.js';

const id = Type.String({ format: 'uuid' });
const cellKey = Type.String({ pattern: '^[0-9]+,[0-9]+$' });
const cell = { cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }) };
export const SYNC_V2_SPATIAL_COMPONENTS = [
  'spatialCells',
  'spatialFeatures',
  'spatialGround',
  'spatialExteriors',
] as const;
export const SyncV2SpatialCellSchema = Type.Object(
  {
    id: cellKey,
    ...cell,
    occupied: Type.Boolean(),
    // Included only for the owner's buildings, never for a neighboring village.
    buildingId: Type.Optional(id),
    role: Type.Optional(Type.Union([Type.Literal('anchor'), Type.Literal('extension'), Type.Literal('body')])),
    pendingExpansionId: Type.Optional(Type.Union([id, Type.Null()])),
  },
  { additionalProperties: false },
);
export const SyncV2SpatialFeatureSchema = Type.Object(
  { id, locations: Type.Array(NaturalFeatureSchema, { maxItems: 1024 }) },
  { additionalProperties: false },
);
export const SyncV2SpatialGroundSchema = Type.Object(
  { id: Type.Literal('*'), data: Type.Omit(TerrainChunkSchema, ['features', 'occupiedCells']) },
  { additionalProperties: false },
);
export const SyncV2SpatialExteriorSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    ...cell,
    width: Type.Number({ minimum: 1 }),
    depth: Type.Number({ minimum: 1 }),
    exterior: TerrainBuildingExteriorSchema,
  },
  { additionalProperties: false },
);
export const SyncV2SpatialChangeSchema = Type.Union([
  Type.Object(
    {
      component: Type.Literal('spatialCells'),
      upsert: Type.Array(SyncV2SpatialCellSchema, { maxItems: 1024 }),
      remove: Type.Array(cellKey, { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('spatialFeatures'),
      upsert: Type.Array(SyncV2SpatialFeatureSchema, { maxItems: 1024 }),
      remove: Type.Array(id, { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('spatialGround'),
      upsert: Type.Array(SyncV2SpatialGroundSchema, { maxItems: 1 }),
      remove: Type.Array(Type.Literal('*'), { maxItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('spatialExteriors'),
      upsert: Type.Array(SyncV2SpatialExteriorSchema, { maxItems: 1024 }),
      remove: Type.Array(Type.String({ pattern: '^[a-f0-9]{64}$' }), { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
]);
