import type { ColumnType, Generated, JSONColumnType } from 'kysely';

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface AccountsTable {
  id: Generated<string>;
  email: string;
  passwordHash: string;
  createdAt: Generated<Timestamp>;
}

export interface WorldsTable {
  id: Generated<string>;
  slug: string;
  name: string;
  topology: 'torus';
  widthCells: number;
  heightCells: number;
  chunkSize: number;
  seed: ColumnType<string, number | string, number | string>;
  generationVersion: Generated<number>;
  generationStatus: Generated<'pending' | 'generating' | 'ready' | 'failed'>;
  generatedAt: Timestamp | null;
  createdAt: Generated<Timestamp>;
}

export interface WorldMembershipsTable {
  accountId: string;
  worldId: string;
  playerName: string;
  createdAt: Generated<Timestamp>;
}

export interface VillagesTable {
  id: Generated<string>;
  worldId: string;
  ownerAccountId: string;
  name: string;
  anchorCellX: number;
  anchorCellY: number;
  createdAt: Generated<Timestamp>;
}

export interface BuildingsTable {
  id: Generated<string>;
  worldId: string;
  villageId: string;
  buildingType: string;
  level: number;
  targetLevel: number | null;
  status: 'under-construction' | 'completed';
  constructionStartedAt: Timestamp | null;
  constructionCompletesAt: Timestamp | null;
  completedAt: Timestamp | null;
  createdAt: Generated<Timestamp>;
}

export interface ResourceTypesTable {
  code: string;
  displayName: string;
  iconKey: string;
}

export interface BuildingTypesTable {
  code: string;
  displayName: string;
  progressionMode: 'vertical' | 'spatial' | 'fixed-footprint';
  productionMode: 'none' | 'direct' | 'buffered';
  instanceLimitPerVillage: number | null;
  visualKey: string;
  buildable: boolean;
}

export interface BuildingTypeLevelsTable {
  buildingTypeCode: string;
  level: number;
  constructionDurationSeconds: number;
  additionalCellsRequired: number;
  visualVariant: string;
}

export interface BuildingLevelCostsTable {
  buildingTypeCode: string;
  level: number;
  resourceCode: string;
  amount: ColumnType<string, number | string, number | string>;
}

export interface BuildingLevelProductionTable {
  buildingTypeCode: string;
  level: number;
  resourceCode: string;
  ratePerHour: ColumnType<string, number | string, number | string>;
  capacity: ColumnType<string | null, number | string | null, number | string | null>;
}

export interface VillageResourcesTable {
  worldId: string;
  villageId: string;
  resourceCode: string;
  amount: ColumnType<string, number | string, number | string>;
}

export interface VillageResourceFlowsTable {
  worldId: string;
  villageId: string;
  resourceCode: string;
  baseRatePerHour: ColumnType<string, number | string, number | string>;
  remainder: ColumnType<string, number | string, number | string>;
  productionUpdatedAt: Timestamp;
}

export interface TerrainTypesTable {
  code: number;
  slug: string;
  buildable: boolean;
}

export interface WorldChunksTable {
  worldId: string;
  chunkX: number;
  chunkY: number;
  generationVersion: number;
  terrainCodes: number[];
  elevations: number[];
  createdAt: Generated<Timestamp>;
}

export interface WorldClearingsTable {
  id: string;
  worldId: string;
  centerCellX: number;
  centerCellY: number;
  innerRadius: number;
  transitionRadius: number;
  status: 'protected' | 'claimed';
  claimedVillageId: string | null;
  createdAt: Generated<Timestamp>;
}

export interface WorldFeatureTypesTable {
  code: string;
  blocksConstruction: boolean;
}

export interface WorldFeaturesTable {
  id: string;
  worldId: string;
  featureTypeCode: string;
  state: 'available' | 'reserved' | 'depleted';
  variantSeed: number;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

export interface WorldCellOccupanciesTable {
  worldId: string;
  cellX: number;
  cellY: number;
  buildingId: string | null;
  featureId: string | null;
  pendingExpansionId: string | null;
  role: 'anchor' | 'extension' | 'body';
  createdAt: Generated<Timestamp>;
}

export interface BuildingExpansionsTable {
  id: Generated<string>;
  worldId: string;
  villageId: string;
  buildingId: string;
  status: 'under-construction' | 'completed';
  startedAt: Timestamp;
  completesAt: Timestamp;
  completedAt: Timestamp | null;
  createdAt: Generated<Timestamp>;
}

export interface BuildingResourceBuffersTable {
  worldId: string;
  villageId: string;
  buildingId: string;
  resourceCode: string;
  storedAmount: ColumnType<string, number | string, number | string>;
  remainder: ColumnType<string, number | string, number | string>;
  productionUpdatedAt: Timestamp;
}

export interface ScheduledTasksTable {
  id: Generated<string>;
  worldId: string;
  taskType: string;
  subjectId: string;
  payload: JSONColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  dueAt: Timestamp;
  availableAt: Timestamp;
  attempts: Generated<number>;
  lastError: string | null;
  completedAt: Timestamp | null;
  createdAt: Generated<Timestamp>;
}

export interface VillagePopulationsTable {
  worldId: string;
  villageId: string;
  initializedAt: Generated<Timestamp>;
}

export interface PopulationCohortsTable {
  id: Generated<string>;
  worldId: string;
  villageId: string;
  originVillageId: string;
  memberCount: number;
  activity: 'idle' | 'working' | 'resting';
  energy: number;
  energyProgress: number;
  energyUpdatedAt: Timestamp;
  restingSince: Timestamp | null;
  foodUsedSinceRest: number;
  harvestId: string | null;
  extractionId: string | null;
  createdAt: Generated<Timestamp>;
}

export interface StoneDepositsTable {
  worldId: string;
  featureId: string;
  cellX: number;
  cellY: number;
  initialAmount: ColumnType<string, number | string, number | string>;
  remainingAmount: ColumnType<string, number | string, number | string>;
  reservedAmount: ColumnType<string, number | string, number | string>;
  revision: ColumnType<string, number | string, number | string>;
  updatedAt: Timestamp;
}

export interface DepositExtractionsTable {
  id: Generated<string>;
  worldId: string;
  villageId: string;
  featureId: string;
  commandId: string;
  status: 'in-progress' | 'completed';
  startedAt: Timestamp;
  completesAt: Timestamp;
  completedAt: Timestamp | null;
  workerCount: number;
  reservedAmount: ColumnType<string, number | string, number | string>;
}

export interface BuildingHiddenSuppliesTable {
  worldId: string;
  villageId: string;
  buildingId: string;
  resourceCode: string;
  amount: ColumnType<string, number | string, number | string>;
  claimedAt: Timestamp | null;
}

export interface GardenHarvestsTable {
  id: Generated<string>;
  worldId: string;
  villageId: string;
  buildingId: string;
  commandId: string;
  status: 'in-progress' | 'completed';
  startedAt: Timestamp;
  completesAt: Timestamp;
  completedAt: Timestamp | null;
  workerCount: number;
  reservedCarrots: ColumnType<string, number | string, number | string>;
  plotCellX: ColumnType<number | null, number | null | undefined, number | null>;
  plotCellY: ColumnType<number | null, number | null | undefined, number | null>;
}

export interface GardenPlotsTable {
  worldId: string;
  villageId: string;
  buildingId: string;
  cellX: number;
  cellY: number;
  storedAmount: ColumnType<string, number | string, number | string>;
  remainder: ColumnType<string, number | string, number | string>;
  productionUpdatedAt: Timestamp;
}

export interface PopulationCommandReceiptsTable {
  worldId: string;
  villageId: string;
  commandId: string;
  commandType: 'feed' | 'rest';
  memberCount: number;
  createdAt: Generated<Timestamp>;
}

export interface VillageAccomplishmentsTable {
  worldId: string;
  villageId: string;
  code: string;
  completedAt: Timestamp;
}

export interface SessionsTable {
  id: Generated<string>;
  tokenHash: string;
  accountId: string;
  expiresAt: Timestamp;
  createdAt: Generated<Timestamp>;
}

export interface Database {
  accounts: AccountsTable;
  worlds: WorldsTable;
  worldMemberships: WorldMembershipsTable;
  villages: VillagesTable;
  buildings: BuildingsTable;
  terrainTypes: TerrainTypesTable;
  worldChunks: WorldChunksTable;
  worldClearings: WorldClearingsTable;
  worldFeatureTypes: WorldFeatureTypesTable;
  worldFeatures: WorldFeaturesTable;
  worldCellOccupancies: WorldCellOccupanciesTable;
  buildingExpansions: BuildingExpansionsTable;
  resourceTypes: ResourceTypesTable;
  buildingTypes: BuildingTypesTable;
  buildingTypeLevels: BuildingTypeLevelsTable;
  buildingLevelCosts: BuildingLevelCostsTable;
  buildingLevelProduction: BuildingLevelProductionTable;
  villageResources: VillageResourcesTable;
  villageResourceFlows: VillageResourceFlowsTable;
  buildingResourceBuffers: BuildingResourceBuffersTable;
  scheduledTasks: ScheduledTasksTable;
  villagePopulations: VillagePopulationsTable;
  populationCohorts: PopulationCohortsTable;
  buildingHiddenSupplies: BuildingHiddenSuppliesTable;
  gardenHarvests: GardenHarvestsTable;
  gardenPlots: GardenPlotsTable;
  populationCommandReceipts: PopulationCommandReceiptsTable;
  villageAccomplishments: VillageAccomplishmentsTable;
  stoneDeposits: StoneDepositsTable;
  depositExtractions: DepositExtractionsTable;
  sessions: SessionsTable;
}
