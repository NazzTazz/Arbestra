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

export interface VillageCellsTable {
  id: Generated<string>;
  worldId: string;
  villageId: string;
  cellX: number;
  cellY: number;
}

export interface BuildingsTable {
  id: Generated<string>;
  worldId: string;
  villageId: string;
  anchorCellId: string;
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

export interface BuildingCellsTable {
  worldId: string;
  villageId: string;
  buildingId: string;
  cellId: string;
  role: 'anchor' | 'extension';
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
  villageCells: VillageCellsTable;
  buildings: BuildingsTable;
  resourceTypes: ResourceTypesTable;
  buildingTypes: BuildingTypesTable;
  buildingTypeLevels: BuildingTypeLevelsTable;
  buildingLevelCosts: BuildingLevelCostsTable;
  buildingLevelProduction: BuildingLevelProductionTable;
  villageResources: VillageResourcesTable;
  villageResourceFlows: VillageResourceFlowsTable;
  buildingCells: BuildingCellsTable;
  buildingResourceBuffers: BuildingResourceBuffersTable;
  scheduledTasks: ScheduledTasksTable;
  sessions: SessionsTable;
}
