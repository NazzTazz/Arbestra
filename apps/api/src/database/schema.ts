import type { ColumnType, Generated, JSONColumnType } from 'kysely';
import type {BuildingVisualLayout,GardenHarvestStop,TravelCell,ExploitationRequest,InfrastructurePlan,InfrastructureQuote} from '@arbestra/contracts';

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
  quarterTurns:Generated<number>;
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
  visualLayout: ColumnType<BuildingVisualLayout|null,BuildingVisualLayout|null|undefined,BuildingVisualLayout|null>;
}

export interface BuildingCommandReceiptsTable {
  worldId: string;
  villageId: string;
  commandId: string;
  commandType: 'construct' | 'upgrade' | 'expand';
  request: ColumnType<unknown, string, string>;
  buildingId: string | null;
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
  scienceActivityId: ColumnType<string | null, string | null | undefined, string | null>;
  cartographer: ColumnType<boolean, boolean | undefined, boolean>;
  restBuildingId: ColumnType<string|null,string|null|undefined,string|null>;
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
  worksiteId: ColumnType<string | null, string | null | undefined, string | null>;
  resourceCode: ColumnType<'stone' | 'wood', 'stone' | 'wood' | undefined, 'stone' | 'wood'>;
  woodDebitedAt: ColumnType<Date | null, Date | null | undefined, Date | null>;
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
  transportMs: ColumnType<number, number | undefined, number>;
  pathCells: ColumnType<Array<{ cellX: number; cellY: number }> | null, Array<{ cellX: number; cellY: number }> | null | undefined, Array<{ cellX: number; cellY: number }> | null>;
}

export interface ExtractionWorksitesTable {
  exploitationOrderId: ColumnType<string | null, string | null | undefined, string | null>;
  id: Generated<string>;
  worldId: string;
  villageId: string;
  commandId: string;
  requestedFeatureIds: string[];
  requestedWorkerCap: number;
  resourceCode: 'stone' | 'wood';
  mode: 'extract' | 'cut' | 'clear';
  status: ColumnType<'running' | 'paused' | 'stopping' | 'stopped' | 'completed', 'running' | 'paused' | 'stopping' | 'stopped' | 'completed' | undefined, 'running' | 'paused' | 'stopping' | 'stopped' | 'completed'>;
  workerCap: number;
  deliveredAmount: ColumnType<string, number | string | undefined, number | string>;
  waitReason: string | null;
  nextWakeAt: Timestamp | null;
  wakeVersion: Generated<number>;
  lastDepartureAt: Timestamp | null;
  createdAt: Generated<Timestamp>;
  updatedAt: Timestamp;
}

export interface ExtractionWorksiteTargetsTable {
  worksiteId: string;
  worldId: string;
  villageId: string;
  featureId: string;
  ordinal: number;
  status: ColumnType<'pending' | 'completed' | 'external' | 'abandoned', 'pending' | 'completed' | 'external' | 'abandoned' | undefined, 'pending' | 'completed' | 'external' | 'abandoned'>;
  admittedAt: Timestamp | null;
  thresholdReachedAt: Timestamp | null;
  completedAt: Timestamp | null;
  reason: string | null;
}

export interface ExtractionWorksiteCommandsTable {
  worldId: string;
  villageId: string;
  commandId: string;
  worksiteId: string;
  action: 'pause' | 'resume' | 'stop' | 'set-cap';
  workerCap: number | null;
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
  exploitationOrderId: ColumnType<string | null, string | null | undefined, string | null>;
  stops: ColumnType<GardenHarvestStop[],GardenHarvestStop[]|undefined,GardenHarvestStop[]>;
  returnPathCells: ColumnType<TravelCell[]|null,TravelCell[]|null|undefined,TravelCell[]|null>;
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
  transportMs: ColumnType<number, number | undefined, number>;
  pathCells: ColumnType<Array<{ cellX: number; cellY: number }> | null, Array<{ cellX: number; cellY: number }> | null | undefined, Array<{ cellX: number; cellY: number }> | null>;
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
  villageInfrastructure:{worldId:string;villageId:string;plan:JSONColumnType<InfrastructurePlan>};
  infrastructureReceipts:{worldId:string;villageId:string;commandId:string;sessionId:string;request:JSONColumnType<object>;
    beforePlan:JSONColumnType<InfrastructurePlan>;afterPlan:JSONColumnType<InfrastructurePlan>;quote:JSONColumnType<InfrastructureQuote>;undone:Generated<boolean>;createdAt:Generated<Timestamp>};
  worldFactorySettings:{worldId:string;enabled:boolean};
  exploitationOrders: {
    id: Generated<string>; worldId: string; villageId: string; commandId: string;
    request: ColumnType<ExploitationRequest, string, string>;
    workerCap: number; confirmedAt: Timestamp; deadline: Timestamp | null;
    cohortId: string | null; initialRemaining: number;
    gardenStatus: 'pending' | 'active' | 'completed' | 'closed';
    gardenPlan: ColumnType<{stops: Array<Omit<GardenHarvestStop, 'reservedCarrots'>>; returnPath: TravelCell[]; durationMs: number} | null, string | null, string | null>;
    nextWakeAt: Timestamp | null;
  };
  playerScience: { worldId: string; accountId: string; observationsSince: Timestamp | null; solarReport: JSONColumnType<Record<string, unknown> | null, string | null, string | null> };
  sciencePrograms: { worldId: string; accountId: string; code: string; discipline: 'mathematics' | 'geography' | 'astronomy';
    level: number; workDoneMs: ColumnType<string, string | number | undefined, string | number>; paused: ColumnType<boolean, boolean | undefined, boolean>;
    acquiredAt: Timestamp | null; createdAt: Timestamp; workerCap: number };
  scienceContributions: { worldId: string; villageId: string; buildingId: string; accountId: string; programCode: string;
    workerCap: number; requestedAt: Timestamp; lastStartedAt: Timestamp | null };
  scienceActivities: { id: Generated<string>; worldId: string; villageId: string; accountId: string; buildingId: string | null;
    programCode: string | null; kind: 'research' | 'training' | 'survey' | 'exploration'; status: 'in-progress' | 'completed';
    workerCount: number; workMs: ColumnType<string, string | number, string | number>; startedAt: Timestamp; completesAt: Timestamp; completedAt: Timestamp | null;
    pathCells: ColumnType<TravelCell[], TravelCell[], TravelCell[]>; surveyCells: ColumnType<TravelCell[], TravelCell[], TravelCell[]> };
  sciencePlaces: { worldId: string; accountId: string; cellX: number; cellY: number; terrainCode: number; elevation: number;
    observedAt: Timestamp; surveyed: boolean; sourceActivityId: string | null };
  scienceVillageReports: { worldId: string; accountId: string; villageId: string; name: string; anchorCellX: number; anchorCellY: number;
    observedAt: Timestamp; blocks: JSONColumnType<Array<{ x: number; y: number; width: number; depth: number; garden: boolean }>> };
    extractionWorksites: ExtractionWorksitesTable;
    extractionWorksiteTargets: ExtractionWorksiteTargetsTable;
    extractionWorksiteCommands: ExtractionWorksiteCommandsTable;
  woodlandDeposits: StoneDepositsTable & {
    regrowthPeriodMs: ColumnType<string, number | string | undefined, number | string>;
    regrowthUpdatedAt: Timestamp;
    cleared: ColumnType<boolean, boolean | undefined, boolean>;
  };
  resourceDeposits: StoneDepositsTable & { resourceCode: 'stone' | 'wood'; cleared: boolean; blocksCell: boolean };
  accounts: AccountsTable;
  worlds: WorldsTable;
  worldMemberships: WorldMembershipsTable;
  villages: VillagesTable;
  buildings: BuildingsTable;
  buildingCommandReceipts: BuildingCommandReceiptsTable;
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
