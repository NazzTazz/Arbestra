import { Type, type Static } from '@sinclair/typebox';

export const BuildingTypeSchema = Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9-]*$' });
export type BuildingType = Static<typeof BuildingTypeSchema>;

export const ResourceStockSchema = Type.Object({
  code: Type.String(),
  displayName: Type.String(),
  iconKey: Type.String(),
  amount: Type.Integer({ minimum: 0 }),
  productionPerHour: Type.Number({ minimum: 0 }),
  productionUpdatedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});
export type ResourceStock = Static<typeof ResourceStockSchema>;

export const BuildingLevelDefinitionSchema = Type.Object({
  level: Type.Integer({ minimum: 1 }),
  constructionDurationSeconds: Type.Integer({ minimum: 0 }),
  additionalCellsRequired: Type.Integer({ minimum: 0 }),
  visualVariant: Type.String(),
  costs: Type.Array(Type.Object({ resourceCode: Type.String(), amount: Type.Integer({ minimum: 0 }) })),
  production: Type.Array(Type.Object({
    resourceCode: Type.String(),
    ratePerHour: Type.Number({ minimum: 0 }),
    capacity: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  })),
});

export const BuildingTypeDefinitionSchema = Type.Object({
  code: BuildingTypeSchema,
  displayName: Type.String(),
  progressionMode: Type.Union([Type.Literal('vertical'), Type.Literal('spatial'), Type.Literal('fixed-footprint')]),
  productionMode: Type.Union([Type.Literal('none'), Type.Literal('direct'), Type.Literal('buffered')]),
  instanceLimitPerVillage: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  visualKey: Type.String(),
  buildable: Type.Boolean(),
  levels: Type.Array(BuildingLevelDefinitionSchema),
});
export type BuildingTypeDefinition = Static<typeof BuildingTypeDefinitionSchema>;

export const GardenSchema = Type.Object({
  storedCarrots: Type.Integer({ minimum: 0 }),
  capacity: Type.Integer({ minimum: 0 }),
  productionPerHour: Type.Number({ minimum: 0 }),
  productionUpdatedAt: Type.String({ format: 'date-time' }),
  activeCellCount: Type.Integer({ minimum: 0 }),
  pendingCellCount: Type.Integer({ minimum: 0 }),
  expansion: Type.Union([Type.Object({
    id: Type.String({ format: 'uuid' }),
    startedAt: Type.String({ format: 'date-time' }),
    completesAt: Type.String({ format: 'date-time' }),
    cells: Type.Array(Type.Object({ cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }) })),
  }), Type.Null()]),
  harvest: Type.Union([Type.Object({
    id: Type.String({ format: 'uuid' }), startedAt: Type.String({ format: 'date-time' }),
    completesAt: Type.String({ format: 'date-time' }), workerCount: Type.Integer({ minimum: 1 }),
    reservedCarrots: Type.Integer({ minimum: 0 }),
  }), Type.Null()]),
});
export type Garden = Static<typeof GardenSchema>;

export const StoneDepositSchema = Type.Object({
  featureId: Type.String({ format: 'uuid' }),
  resourceCode: Type.Literal('stone'),
  cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }),
  initialAmount: Type.Integer({ minimum: 1 }), remainingAmount: Type.Integer({ minimum: 0 }),
  reservedAmount: Type.Integer({ minimum: 0 }), availableAmount: Type.Integer({ minimum: 0 }),
  state: Type.Union([Type.Literal('available'), Type.Literal('depleted')]),
  revision: Type.Integer({ minimum: 1 }), updatedAt: Type.String({ format: 'date-time' }),
});
export type StoneDeposit = Static<typeof StoneDepositSchema>;

export const ExtractionSchema = Type.Object({
  cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }),
  id: Type.String({ format: 'uuid' }), featureId: Type.String({ format: 'uuid' }),
  workerCount: Type.Integer({ minimum: 1 }), reservedAmount: Type.Integer({ minimum: 1 }),
  status: Type.Union([Type.Literal('in-progress'), Type.Literal('completed')]),
  startedAt: Type.String({ format: 'date-time' }), completesAt: Type.String({ format: 'date-time' }),
  completedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});
export type Extraction = Static<typeof ExtractionSchema>;

export const BuildingSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  type: BuildingTypeSchema,
  level: Type.Integer({ minimum: 1 }),
  targetLevel: Type.Union([Type.Integer({ minimum: 2 }), Type.Null()]),
  status: Type.Union([Type.Literal('under-construction'), Type.Literal('completed')]),
  constructionStartedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  constructionCompletesAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  completedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  hiddenSuppliesAvailable: Type.Boolean(),
  garden: Type.Union([GardenSchema, Type.Null()]),
});
export type Building = Static<typeof BuildingSchema>;

export const BuildingFootprintSchema = Type.Object({
  buildingId: Type.String({ format: 'uuid' }),
  buildingType: BuildingTypeSchema,
  role: Type.Union([Type.Literal('anchor'), Type.Literal('extension')]),
  state: Type.Union([Type.Literal('active'), Type.Literal('reserved')]),
});

export const VillageCellSchema = Type.Object({
  // Coordinate key for UI selection only; it is not a persistent cell record id.
  id: Type.String(),
  cellX: Type.Integer({ minimum: 0 }),
  cellY: Type.Integer({ minimum: 0 }),
  x: Type.Number(),
  z: Type.Number(),
  building: Type.Union([BuildingSchema, Type.Null()]),
  footprint: Type.Union([BuildingFootprintSchema, Type.Null()]),
  canBuild: Type.Boolean(),
});
export type VillageCell = Static<typeof VillageCellSchema>;

export const VillageAccomplishmentSchema = Type.Object({
  code: Type.String({ pattern: '^[a-z][a-z0-9-]*$' }),
  completedAt: Type.String({ format: 'date-time' }),
});
export type VillageAccomplishment = Static<typeof VillageAccomplishmentSchema>;

export const VillageStateSchema = Type.Object({
  serverTime: Type.String({ format: 'date-time' }),
  world: Type.Object({
    id: Type.String({ format: 'uuid' }), slug: Type.String(), name: Type.String(),
    topology: Type.Literal('torus'), widthCells: Type.Integer(), heightCells: Type.Integer(),
    chunkSize: Type.Integer(), seed: Type.String(), generationVersion: Type.Integer(),
  }),
  village: Type.Object({
    id: Type.String({ format: 'uuid' }), name: Type.String(), anchorCellX: Type.Integer(), anchorCellY: Type.Integer(),
    resources: Type.Array(ResourceStockSchema),
    wood: Type.Integer({ minimum: 0 }), carrots: Type.Integer({ minimum: 0 }),
    woodProductionPerHour: Type.Number({ minimum: 0 }),
    woodProductionUpdatedAt: Type.String({ format: 'date-time' }),
    population: Type.Object({
      total: Type.Integer({ minimum: 0 }), housingCapacity: Type.Integer({ minimum: 0 }),
      available: Type.Integer({ minimum: 0 }), working: Type.Integer({ minimum: 0 }), resting: Type.Integer({ minimum: 0 }),
      energyCounts: Type.Array(Type.Integer({ minimum: 0 })),
    }),
    accomplishments: Type.Array(VillageAccomplishmentSchema),
    extractions: Type.Array(ExtractionSchema),
  }),
  buildingTypes: Type.Array(BuildingTypeDefinitionSchema),
  region: Type.Object({
    originCellX: Type.Integer({ minimum: 0 }), originCellY: Type.Integer({ minimum: 0 }),
    width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }),
    terrainCodes: Type.Array(Type.Integer({ minimum: 1 })),
    elevations: Type.Array(Type.Integer()),
    features: Type.Array(Type.Object({
      id: Type.String({ format: 'uuid' }), type: Type.String(), cellX: Type.Integer({ minimum: 0 }),
      cellY: Type.Integer({ minimum: 0 }), variantSeed: Type.Integer(),
      deposit: Type.Union([StoneDepositSchema, Type.Null()]),
    })),
  }),
  cells: Type.Array(VillageCellSchema),
});
export type VillageState = Static<typeof VillageStateSchema>;

const SpatialBuildRequestSchema = Type.Object({
  buildingType: BuildingTypeSchema,
  anchorCellX: Type.Integer(),
  anchorCellY: Type.Integer(),
  cells: Type.Array(Type.Object({ cellX: Type.Integer(), cellY: Type.Integer() }), { minItems: 1, maxItems: 100 }),
});
const LegacyBuildRequestSchema = Type.Object({
  buildingType: BuildingTypeSchema,
  cellX: Type.Integer(),
  cellY: Type.Integer(),
});
export const BuildRequestSchema = Type.Union([SpatialBuildRequestSchema, LegacyBuildRequestSchema]);
export type BuildRequest = Static<typeof BuildRequestSchema>;

export const UpgradeRequestSchema = Type.Object({});
export type UpgradeRequest = Static<typeof UpgradeRequestSchema>;

export const ExpansionRequestSchema = Type.Object({
  cells: Type.Array(Type.Object({ cellX: Type.Integer(), cellY: Type.Integer() }), { minItems: 1, maxItems: 100 }),
});
export type ExpansionRequest = Static<typeof ExpansionRequestSchema>;

export const HarvestRequestSchema = Type.Object({ commandId: Type.String({ format: 'uuid' }) });
export type HarvestRequest = Static<typeof HarvestRequestSchema>;

export const PopulationCommandRequestSchema = Type.Object({
  commandId: Type.String({ format: 'uuid' }), count: Type.Integer({ minimum: 1 }),
});
export type PopulationCommandRequest = Static<typeof PopulationCommandRequestSchema>;

export const ExtractionRequestSchema = Type.Object({
  commandId: Type.String({ format: 'uuid' }), workerCount: Type.Integer({ minimum: 1, maximum: 10 }),
}, { additionalProperties: false });
export type ExtractionRequest = Static<typeof ExtractionRequestSchema>;

export const DepositDetailsSchema = Type.Object({
  serverTime: Type.String({ format: 'date-time' }), deposit: StoneDepositSchema,
  eligibility: Type.Object({
    inRange: Type.Boolean(), onBoundary: Type.Boolean(), protected: Type.Boolean(), lotAmount: Type.Integer({ minimum: 0, maximum: 100 }),
    workerOptions: Type.Array(Type.Object({
      workerCount: Type.Integer({ minimum: 1, maximum: 10 }), durationMs: Type.Integer({ minimum: 1 }),
      availableWorkers: Type.Integer({ minimum: 0 }), canStart: Type.Boolean(), reasonCode: Type.Union([Type.String(), Type.Null()]),
    })),
  }),
});
export type DepositDetails = Static<typeof DepositDetailsSchema>;

export const ExtractionResponseSchema = Type.Object({ villageState: VillageStateSchema, extraction: ExtractionSchema, deposit: StoneDepositSchema });
export type ExtractionResponse = Static<typeof ExtractionResponseSchema>;
