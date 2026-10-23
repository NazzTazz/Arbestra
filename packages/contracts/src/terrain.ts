import { Rc1GroundSchema } from './rc1-runtime.js';
import { Type, type Static } from '@sinclair/typebox';
import { NaturalFeatureSchema } from './villages.js';

export const TerrainUpdatesChunkSchema = Type.Object({
  rc1: Type.Optional(Rc1GroundSchema),
  rc1Edits: Type.Optional(Type.Object({ terraces: Rc1GroundSchema.properties.terraces })),
  chunkX: Type.Integer({ minimum: 0 }),
  chunkY: Type.Integer({ minimum: 0 }),
  originCellX: Type.Integer({ minimum: 0 }),
  originCellY: Type.Integer({ minimum: 0 }),
  features: Type.Array(NaturalFeatureSchema),
  occupiedCells: Type.Array(Type.Object({ cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }) })),
});
export const TerrainChunkSchema = Type.Composite([
  TerrainUpdatesChunkSchema,
  Type.Object({
    // Halo of one cell, including the four corners; row-major (S + 2)^2.
    // 0 is indeterminate geography, never an actual terrain type.
    terrainCodes: Type.Array(Type.Integer({ minimum: 0 })),
    elevations: Type.Array(Type.Integer()),
  }),
]);
export type TerrainChunk = Static<typeof TerrainChunkSchema>;
export type TerrainUpdatesChunk = Static<typeof TerrainUpdatesChunkSchema>;
const TerrainWorldSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  generationVersion: Type.Integer({ minimum: 1 }),
  widthCells: Type.Integer({ minimum: 1 }),
  heightCells: Type.Integer({ minimum: 1 }),
  chunkSize: Type.Integer({ minimum: 1 }),
});
export const TerrainResponseSchema = Type.Object({
  world: TerrainWorldSchema,
  chunks: Type.Array(TerrainChunkSchema, { maxItems: 16 }),
});
export type TerrainResponse = Static<typeof TerrainResponseSchema>;
export const TerrainUpdatesResponseSchema = Type.Object({
  world: TerrainWorldSchema,
  chunks: Type.Array(TerrainUpdatesChunkSchema, { maxItems: 16 }),
});
export type TerrainUpdatesResponse = Static<typeof TerrainUpdatesResponseSchema>;

export const TerrainOverviewWorldSchema = TerrainWorldSchema;
const CoverageSchema = Type.Array(Type.Integer({ minimum: 0, maximum: 255 }), { maxItems: 262144 });
const ElevationSchema = Type.Array(Type.Number(), { maxItems: 262144 });
const OverviewIdentitySchema = Type.Object({
  world: TerrainOverviewWorldSchema,
  overviewVersion: Type.Integer({ minimum: 1 }),
  gridWidth: Type.Integer({ minimum: 1, maximum: 512 }),
  gridHeight: Type.Integer({ minimum: 1, maximum: 512 }),
});
export const TerrainOverviewSchema = Type.Composite([
  OverviewIdentitySchema,
  Type.Object({
    meanElevations: ElevationSchema,
    minElevations: ElevationSchema,
    maxElevations: ElevationSchema,
    waterCoverage: CoverageSchema,
    rockCoverage: CoverageSchema,
  }),
]);
export type TerrainOverview = Static<typeof TerrainOverviewSchema>;
export const TerrainVegetationOverviewSchema = Type.Composite([
  OverviewIdentitySchema,
  Type.Object({
    woodlandCoverage: CoverageSchema,
    sampledAt: Type.String(),
    ageMs: Type.Integer({ minimum: 0 }),
    maxAgeMs: Type.Integer({ minimum: 0 }),
  }),
]);
export type TerrainVegetationOverview = Static<typeof TerrainVegetationOverviewSchema>;

/** Public visual state only: no building identity, deadline or economic data. */
export const TerrainBuildingExteriorSchema = Type.Object({
  model: Type.Union(
    [
      'town-hall',
      'dwelling',
      'dwelling-logs',
      'dwelling-beams',
      'university',
      'sawmill',
      'stonemason',
      'barracks',
      'garden',
    ].map((value) => Type.Literal(value)),
  ),
  level: Type.Integer({ minimum: 1, maximum: 3 }),
  phase: Type.Union([Type.Literal('finished'), Type.Literal('works')]),
  quarterTurns: Type.Integer({ minimum: 0, maximum: 3 }),
  entranceFace: Type.Optional(
    Type.Union([Type.Literal('-x'), Type.Literal('+x'), Type.Literal('-z'), Type.Literal('+z')]),
  ),
  offset: Type.Optional(Type.Tuple([Type.Number(), Type.Number()])),
});
export type TerrainBuildingExterior = Static<typeof TerrainBuildingExteriorSchema>;

// Anonymous exteriors omit village identity. Dated reports remain snapshots;
// their observation date lives in science.villageReports. Old blocks remain valid.
export const TerrainVillageOverviewSchema = Type.Object({
  world: TerrainOverviewWorldSchema,
  sampledAt: Type.String(),
  truncated: Type.Boolean(),
  villages: Type.Array(
    Type.Object({
      id: Type.Optional(Type.String({ format: 'uuid' })),
      anchorCellX: Type.Integer(),
      anchorCellY: Type.Integer(),
      blocks: Type.Array(
        Type.Object({
          x: Type.Number(),
          y: Type.Number(),
          width: Type.Number({ minimum: 1 }),
          depth: Type.Number({ minimum: 1 }),
          garden: Type.Optional(Type.Boolean()),
          underConstruction: Type.Optional(Type.Boolean()),
          exterior: Type.Optional(TerrainBuildingExteriorSchema),
        }),
        { maxItems: 64 },
      ),
    }),
    { maxItems: 32 },
  ),
});
export type TerrainVillageOverview = Static<typeof TerrainVillageOverviewSchema>;
