import {Rc1FeatureGeometrySchema} from './rc1-runtime.js';
import { Type, type Static } from '@sinclair/typebox';
import { ScienceStateSchema } from './science.js';
import { ExploitationOrderSchema } from './exploitation.js';
import {InfrastructurePlanSchema} from './infrastructure.js';
import { ProcessingRecipeSchema, ProcessingOrderSchema } from './processing.js';
import { MarketStateSchema } from './market.js';

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
  processing: Type.Optional(ProcessingRecipeSchema),
    variantCosts: Type.Optional(Type.Array(Type.Object({variant:Type.Union([Type.Literal('stone'),Type.Literal('logs'),Type.Literal('beams')]),resourceCode:Type.String(),amount:Type.Integer({minimum:0}),replacesResourceCode:Type.Optional(Type.String())}))),
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
  productionMode: Type.Union([Type.Literal('none'), Type.Literal('direct'), Type.Literal('buffered'), Type.Literal('processing')]),
  instanceLimitPerVillage: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  visualKey: Type.String(),
  buildable: Type.Boolean(),
  levels: Type.Array(BuildingLevelDefinitionSchema),
});
export type BuildingTypeDefinition = Static<typeof BuildingTypeDefinitionSchema>;

const GardenExpansionSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  startedAt: Type.String({ format: 'date-time' }),
  completesAt: Type.String({ format: 'date-time' }),
  cells: Type.Array(Type.Object({ cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }) })),
});

export const GardenHarvestStopSchema = Type.Object({
  cellX: Type.Integer({minimum:0}), cellY: Type.Integer({minimum:0}),
  path: Type.Array(Type.Object({cellX:Type.Number(),cellY:Type.Number()})),
  arrivesAfterMs: Type.Integer({minimum:0}), workEndsAfterMs: Type.Integer({minimum:0}),
  reservedCarrots: Type.Integer({minimum:0}),
});
export type GardenHarvestStop = Static<typeof GardenHarvestStopSchema>;
const GardenTourProperties = {
  stops: Type.Optional(Type.Array(GardenHarvestStopSchema)),
  returnPath: Type.Optional(Type.Array(Type.Object({cellX:Type.Number(),cellY:Type.Number()}))),
};
export const GardenSelectionHarvestRequestSchema = Type.Object({
  commandId:Type.String({format:'uuid'}),
  cells:Type.Array(Type.Object({cellX:Type.Integer({minimum:0}),cellY:Type.Integer({minimum:0})}),{minItems:1,maxItems:100}),
});
export const GardenSchema = Type.Object({
  storedCarrots: Type.Integer({ minimum: 0 }),
  capacity: Type.Integer({ minimum: 0 }),
  productionPerHour: Type.Number({ minimum: 0 }),
  productionUpdatedAt: Type.String({ format: 'date-time' }),
  activeCellCount: Type.Integer({ minimum: 0 }),
  pendingCellCount: Type.Integer({ minimum: 0 }),
  plots: Type.Array(Type.Object({
    cellX: Type.Integer({ minimum: 0 }),
    cellY: Type.Integer({ minimum: 0 }),
    storedCarrots: Type.Integer({ minimum: 0 }),
    capacity: Type.Integer({ minimum: 0 }),
    productionPerHour: Type.Number({ minimum: 0 }),
    productionUpdatedAt: Type.String({ format: 'date-time' }),
    full: Type.Boolean(),
    harvest: Type.Union([Type.Object({
      id: Type.String({ format: 'uuid' }), startedAt: Type.String({ format: 'date-time' }),
      completesAt: Type.String({ format: 'date-time' }), reservedCarrots: Type.Integer({ minimum: 0 }),
      transportMs: Type.Integer({ minimum: 0 }),
      path: Type.Array(Type.Object({ cellX: Type.Number(), cellY: Type.Number() })),
      ...GardenTourProperties,
    }), Type.Null()]),
  })),
  expansion: Type.Union([GardenExpansionSchema, Type.Null()]),
  expansions: Type.Optional(Type.Array(GardenExpansionSchema)),
  harvest: Type.Union([Type.Object({
    id: Type.String({ format: 'uuid' }), startedAt: Type.String({ format: 'date-time' }),
    completesAt: Type.String({ format: 'date-time' }), workerCount: Type.Integer({ minimum: 1 }),
    reservedCarrots: Type.Integer({ minimum: 0 }),
    transportMs: Type.Integer({ minimum: 0 }),
    path: Type.Array(Type.Object({ cellX: Type.Number(), cellY: Type.Number() })),
  }), Type.Null()]),
});
export type Garden = Static<typeof GardenSchema>;

export const StoneDepositSchema = Type.Object({
  featureId: Type.String({ format: 'uuid' }),
  resourceCode: Type.Union([Type.Literal('stone'), Type.Literal('wood')]),
  canClear: Type.Optional(Type.Boolean()),
  cleared: Type.Optional(Type.Boolean()),
  blocksCell: Type.Optional(Type.Boolean()),
  regrowthPerHour: Type.Optional(Type.Number({ minimum: 0 })),
  cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }),
  initialAmount: Type.Integer({ minimum: 1 }), remainingAmount: Type.Integer({ minimum: 0 }),
  reservedAmount: Type.Integer({ minimum: 0 }), availableAmount: Type.Integer({ minimum: 0 }),
  state: Type.Union([Type.Literal('available'), Type.Literal('depleted')]),
  revision: Type.Integer({ minimum: 1 }), updatedAt: Type.String({ format: 'date-time' }),
});
export type StoneDeposit = Static<typeof StoneDepositSchema>;

export const NaturalFeatureSchema = Type.Object({
  rc1: Type.Optional(Rc1FeatureGeometrySchema),
  id: Type.String({ format: 'uuid' }), type: Type.String(), cellX: Type.Integer({ minimum: 0 }),
  cellY: Type.Integer({ minimum: 0 }), variantSeed: Type.Integer(),
  deposit: Type.Union([StoneDepositSchema, Type.Null()]),
});
export type NaturalFeature = Static<typeof NaturalFeatureSchema>;

export const ExtractionSchema = Type.Object({
  resourceCode: Type.Optional(Type.Union([Type.Literal('stone'), Type.Literal('wood')])),
  cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }),
  id: Type.String({ format: 'uuid' }), featureId: Type.String({ format: 'uuid' }),
  workerCount: Type.Integer({ minimum: 1 }), reservedAmount: Type.Integer({ minimum: 1 }),
  status: Type.Union([Type.Literal('in-progress'), Type.Literal('completed')]),
  startedAt: Type.String({ format: 'date-time' }), completesAt: Type.String({ format: 'date-time' }),
  completedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  transportMs: Type.Integer({ minimum: 0 }),
  path: Type.Array(Type.Object({ cellX: Type.Number(), cellY: Type.Number() })),
});
export type Extraction = Static<typeof ExtractionSchema>;

export const ExtractionWorksiteTargetSchema = Type.Object({
  featureId: Type.String({ format: 'uuid' }), cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }),
  status: Type.Union([Type.Literal('pending'), Type.Literal('completed'), Type.Literal('external'), Type.Literal('abandoned')]),
  reason: Type.Union([Type.String(), Type.Null()]),
});
export const ExtractionWorksiteSchema = Type.Object({
  id: Type.String({ format: 'uuid' }), resourceCode: Type.Union([Type.Literal('stone'), Type.Literal('wood')]),
  mode: Type.Union([Type.Literal('extract'), Type.Literal('cut'), Type.Literal('clear')]),
  status: Type.Union([Type.Literal('running'), Type.Literal('paused'), Type.Literal('stopping'), Type.Literal('stopped'), Type.Literal('completed')]),
  workerCap: Type.Integer({ minimum: 1, maximum: 10 }), deliveredAmount: Type.Integer({ minimum: 0 }),
  waitReason: Type.Union([Type.String(), Type.Null()]),
  nextWakeAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  targets: Type.Array(ExtractionWorksiteTargetSchema),
  activeExtraction: Type.Union([ExtractionSchema, Type.Null()]),
});
export type ExtractionWorksite = Static<typeof ExtractionWorksiteSchema>;

export const BuildingVisualLayoutSchema = Type.Object({
  recipe: Type.Union([Type.Literal('town-hall'), Type.Literal('stone-house'), Type.Literal('log-house'), Type.Literal('beam-house')]),
  version: Type.Literal(1),
  quarterTurns: Type.Integer({ minimum: 0, maximum: 3 }),
  entranceFace: Type.Union([Type.Literal('-x'),Type.Literal('+x'),Type.Literal('-z'),Type.Literal('+z')]),
  offset: Type.Tuple([Type.Number(),Type.Number()]),
});
export type BuildingVisualLayout = Static<typeof BuildingVisualLayoutSchema>;

export const BuildingSchema = Type.Object({
  quarterTurns: Type.Optional(Type.Integer({minimum:0,maximum:3})),
  accesses: Type.Optional(Type.Array(Type.Object({id:Type.String(),x:Type.Number(),y:Type.Number(),dx:Type.Integer({minimum:-1,maximum:1}),dy:Type.Integer({minimum:-1,maximum:1}),width:Type.Number({exclusiveMinimum:0}),principal:Type.Boolean()}))),
  id: Type.String({ format: 'uuid' }),
  type: BuildingTypeSchema,
  level: Type.Integer({ minimum: 1 }),
  targetLevel: Type.Union([Type.Integer({ minimum: 2 }), Type.Null()]),
  status: Type.Union([Type.Literal('under-construction'), Type.Literal('completed')]),
  constructionStartedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  constructionCompletesAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  completedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  hiddenSuppliesAvailable: Type.Boolean(),
  visualLayout: Type.Optional(Type.Union([BuildingVisualLayoutSchema, Type.Null()])),
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
  infrastructure:Type.Optional(InfrastructurePlanSchema),
  factoryEnabled:Type.Optional(Type.Boolean()),
  science: Type.Optional(ScienceStateSchema),
  serverTime: Type.String({ format: 'date-time' }),
  world: Type.Object({
    id: Type.String({ format: 'uuid' }), slug: Type.String(), name: Type.String(),
    topology: Type.Literal('torus'), widthCells: Type.Integer(), heightCells: Type.Integer(),
    chunkSize: Type.Integer(), seed: Type.String(), generationVersion: Type.Integer(),
  }),
  village: Type.Object({
    id: Type.String({ format: 'uuid' }), name: Type.String(), anchorCellX: Type.Integer(), anchorCellY: Type.Integer(),
    townHallBuildingId: Type.Optional(Type.String({ format: 'uuid' })),
    resources: Type.Array(ResourceStockSchema),
    wood: Type.Integer({ minimum: 0 }), carrots: Type.Integer({ minimum: 0 }),
    woodProductionPerHour: Type.Number({ minimum: 0 }),
    woodProductionUpdatedAt: Type.String({ format: 'date-time' }),
    population: Type.Object({
      total: Type.Integer({ minimum: 0 }), housingCapacity: Type.Integer({ minimum: 0 }),
      available: Type.Integer({ minimum: 0 }), working: Type.Integer({ minimum: 0 }), resting: Type.Integer({ minimum: 0 }),
      energyCounts: Type.Array(Type.Integer({ minimum: 0 })),
      cohorts: Type.Optional(Type.Array(Type.Object({id:Type.String({format:'uuid'}),memberCount:Type.Integer({minimum:1}),
        activity:Type.Union([Type.Literal('idle'),Type.Literal('working'),Type.Literal('resting')]),restBuildingId:Type.Union([Type.String({format:'uuid'}),Type.Null()]),
        restingSince:Type.Union([Type.String({format:'date-time'}),Type.Null()]),
        energy: Type.Optional(Type.Integer({minimum:0,maximum:10})),
        assignmentId: Type.Optional(Type.Union([Type.String({format:'uuid'}),Type.Null()])),
        assignmentKind: Type.Optional(Type.Union([Type.Literal('garden'),Type.Literal('extraction'),Type.Literal('science'),Type.Literal('processing'),Type.Null()])),
        cartographer: Type.Optional(Type.Boolean())}))),
      restHousing:Type.Optional(Type.Array(Type.Object({buildingId:Type.String({format:'uuid'}),capacity:Type.Integer({minimum:0}),restingCount:Type.Integer({minimum:0})}))),
      restingWithoutHousing:Type.Optional(Type.Integer({minimum:0})),
    }),
    accomplishments: Type.Array(VillageAccomplishmentSchema),
    extractions: Type.Array(ExtractionSchema),
    worksites: Type.Array(ExtractionWorksiteSchema),
    exploitationOrders: Type.Optional(Type.Array(ExploitationOrderSchema)),
    processingOrders: Type.Optional(Type.Array(ProcessingOrderSchema)),
    market: Type.Optional(MarketStateSchema),
  }),
  buildingTypes: Type.Array(BuildingTypeDefinitionSchema),
  travelRoutes: Type.Array(Type.Object({
    version:Type.Optional(Type.Literal(2)),
    id: Type.String(), kind: Type.Union([Type.Literal('building'), Type.Literal('garden'), Type.Literal('stone'), Type.Literal('wood')]),
    destination: Type.Object({ cellX: Type.Integer(), cellY: Type.Integer() }),
    cells: Type.Array(Type.Object({ cellX: Type.Number(), cellY: Type.Number() })),
  })),
  region: Type.Object({
    originCellX: Type.Integer({ minimum: 0 }), originCellY: Type.Integer({ minimum: 0 }),
    width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }),
    terrainCodes: Type.Array(Type.Integer({ minimum: 1 })),
    elevations: Type.Array(Type.Integer()),
    features: Type.Array(NaturalFeatureSchema),
  }),
  cells: Type.Array(VillageCellSchema),
});
export type VillageState = Static<typeof VillageStateSchema>;

const ExpectedCostsSchema = Type.Array(Type.Object({ resourceCode: Type.String(), amount: Type.Integer({ minimum: 0 }) }), { maxItems: 16 });
const CommandGuardSchema = {
  quarterTurns: Type.Optional(Type.Integer({minimum:0,maximum:3})),
  commandId: Type.Optional(Type.String({ format: 'uuid' })),
  expectedCosts: Type.Optional(ExpectedCostsSchema),
};
const SpatialBuildRequestSchema = Type.Object({
  houseVariant: Type.Optional(Type.Union([Type.Literal('stone'), Type.Literal('logs'), Type.Literal('beams')])),
  ...CommandGuardSchema,
  buildingType: BuildingTypeSchema,
  anchorCellX: Type.Integer(),
  anchorCellY: Type.Integer(),
  cells: Type.Array(Type.Object({ cellX: Type.Integer(), cellY: Type.Integer() }), { minItems: 1, maxItems: 100 }),
});
const LegacyBuildRequestSchema = Type.Object({
  houseVariant: Type.Optional(Type.Union([Type.Literal('stone'), Type.Literal('logs'), Type.Literal('beams')])),
  ...CommandGuardSchema,
  buildingType: BuildingTypeSchema,
  cellX: Type.Integer(),
  cellY: Type.Integer(),
});
export const BuildRequestSchema = Type.Union([SpatialBuildRequestSchema, LegacyBuildRequestSchema]);
export type BuildRequest = Static<typeof BuildRequestSchema>;

export const UpgradeRequestSchema = Type.Object({ ...CommandGuardSchema,
  expectedLevel: Type.Optional(Type.Integer({ minimum: 1 })),
});
export type UpgradeRequest = Static<typeof UpgradeRequestSchema>;

export const ExpansionRequestSchema = Type.Object({
  ...CommandGuardSchema,
  cells: Type.Array(Type.Object({ cellX: Type.Integer(), cellY: Type.Integer() }), { minItems: 1, maxItems: 100 }),
});
export type ExpansionRequest = Static<typeof ExpansionRequestSchema>;

export const HarvestRequestSchema = Type.Object({
  commandId: Type.String({ format: 'uuid' }),
  cellX: Type.Integer(),
  cellY: Type.Integer(),
}, { additionalProperties: false });
export type HarvestRequest = Static<typeof HarvestRequestSchema>;

export const PopulationCommandRequestSchema = Type.Object({
  commandId: Type.String({ format: 'uuid' }), count: Type.Integer({ minimum: 1 }),
});
export type PopulationCommandRequest = Static<typeof PopulationCommandRequestSchema>;

export const ExtractionRequestSchema = Type.Object({
  commandId: Type.String({ format: 'uuid' }), workerCount: Type.Integer({ minimum: 1, maximum: 10 }),
}, { additionalProperties: false });
export type ExtractionRequest = Static<typeof ExtractionRequestSchema>;

export const StartExtractionWorksiteRequestSchema = Type.Object({
  commandId: Type.String({ format: 'uuid' }),
  mode: Type.Union([Type.Literal('extract'), Type.Literal('cut'), Type.Literal('clear')]),
  workerCap: Type.Integer({ minimum: 1, maximum: 10 }),
  featureIds: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: 64 }),
}, { additionalProperties: false });
export type StartExtractionWorksiteRequest = Static<typeof StartExtractionWorksiteRequestSchema>;
export const ExtractionWorksiteSelectionSchema = Type.Object({
  included: Type.Array(Type.Object({ featureId: Type.String({ format: 'uuid' }), cellX: Type.Integer(), cellY: Type.Integer() })),
  excluded: Type.Array(Type.Object({ featureId: Type.String({ format: 'uuid' }), reason: Type.String() })),
});
export type ExtractionWorksiteSelection = Static<typeof ExtractionWorksiteSelectionSchema>;
export const ChangeExtractionWorksiteRequestSchema = Type.Object({
  commandId: Type.String({ format: 'uuid' }),
  action: Type.Union([Type.Literal('pause'), Type.Literal('resume'), Type.Literal('stop'), Type.Literal('set-cap')]),
  workerCap: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
}, { additionalProperties: false });
export type ChangeExtractionWorksiteRequest = Static<typeof ChangeExtractionWorksiteRequestSchema>;
export const ExtractionWorksiteResponseSchema = Type.Object({ villageState: VillageStateSchema, worksite: ExtractionWorksiteSchema });

export const DepositDetailsSchema = Type.Object({
  transportMs: Type.Optional(Type.Integer({ minimum: 0 })),
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

export const CatDiscoveryResponseSchema = Type.Object({
  newlyCompleted: Type.Boolean(),
  villageState: VillageStateSchema,
});
export type CatDiscoveryResponse = Static<typeof CatDiscoveryResponseSchema>;
