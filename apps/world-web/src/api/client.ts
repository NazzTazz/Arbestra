import type { BuildingType, DepositDetails, ExtractionResponse, VillageState } from '@arbestra/contracts';

export class ApiError extends Error {
  public constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Une erreur est survenue.' })) as { message?: string; code?: string };
    throw new ApiError(error.message ?? 'Une erreur est survenue.', response.status, error.code);
  }
  return response.json() as Promise<T>;
}

export interface TimedVillageState {
  state: VillageState;
  serverOffsetMs: number;
}

async function villageRequest(request: Promise<Response>, requestedAt: number): Promise<TimedVillageState> {
  const response = await request;
  const receivedAt = Date.now();
  const state = await parseResponse<VillageState>(response);
  return { state, serverOffsetMs: Date.parse(state.serverTime) - ((requestedAt + receivedAt) / 2) };
}

function requestState(path: string, init?: RequestInit): Promise<TimedVillageState> {
  const requestedAt = Date.now();
  return villageRequest(fetch(path, { credentials: 'same-origin', ...init }), requestedAt);
}

export function getVillage(worldSlug: string): Promise<TimedVillageState> {
  return requestState(`/api/worlds/${encodeURIComponent(worldSlug)}/village`);
}

export function buildBuilding(
  worldSlug: string,
  villageId: string,
  buildingType: BuildingType,
  anchor: { cellX: number; cellY: number },
  cells: Array<{ cellX: number; cellY: number }>,
): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/buildings`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buildingType, anchorCellX: anchor.cellX, anchorCellY: anchor.cellY, cells }) },
  );
}

export function expandGarden(worldSlug: string, villageId: string, buildingId: string, cells: Array<{ cellX: number; cellY: number }>): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/buildings/${encodeURIComponent(buildingId)}/expansions`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cells }) },
  );
}

export function upgradeBuilding(
  worldSlug: string,
  villageId: string,
  buildingId: string,
  extensionCell?: { extensionCellX: number; extensionCellY: number },
): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/buildings/${encodeURIComponent(buildingId)}/upgrade`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(extensionCell ? extensionCell : {}) },
  );
}

export function harvestGarden(worldSlug: string, villageId: string, buildingId: string, cellX: number, cellY: number, commandId: string = crypto.randomUUID()): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/buildings/${encodeURIComponent(buildingId)}/harvest`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId, cellX, cellY }) },
  );
}

export function discoverBuildingSupplies(worldSlug: string, villageId: string, buildingId: string): Promise<TimedVillageState> {
  return requestState(`/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/buildings/${encodeURIComponent(buildingId)}/discover-supplies`, { method: 'POST' });
}

export async function discoverOrRefreshSupplies(worldSlug: string, villageId: string, buildingId: string) {
  try {
    return { snapshot: await discoverBuildingSupplies(worldSlug, villageId, buildingId), alreadyDiscovered: false };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'SUPPLIES_ALREADY_DISCOVERED') throw error;
    return { snapshot: await getVillage(worldSlug), alreadyDiscovered: true };
  }
}

function populationCommand(worldSlug: string, villageId: string, action: 'feed' | 'rest', count: number, commandId: string): Promise<TimedVillageState> {
  return requestState(`/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/population/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId, count }),
  });
}

export function feedPopulation(worldSlug: string, villageId: string, count: number, commandId: string): Promise<TimedVillageState> {
  return populationCommand(worldSlug, villageId, 'feed', count, commandId);
}

export function restPopulation(worldSlug: string, villageId: string, count: number, commandId: string): Promise<TimedVillageState> {
  return populationCommand(worldSlug, villageId, 'rest', count, commandId);
}

export async function getStoneDepositDetails(worldSlug: string, villageId: string, featureId: string): Promise<DepositDetails> {
  return parseResponse<DepositDetails>(await fetch(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/features/${encodeURIComponent(featureId)}`,
    { credentials: 'same-origin' },
  ));
}

export async function startStoneExtraction(
  worldSlug: string, villageId: string, featureId: string, workerCount: number, commandId: string,
): Promise<ExtractionResponse & { serverOffsetMs: number }> {
  const requestedAt = Date.now();
  const response = await fetch(
    '/api/worlds/' + encodeURIComponent(worldSlug) + '/villages/' + encodeURIComponent(villageId) + '/features/' + encodeURIComponent(featureId) + '/extractions',
    { credentials: 'same-origin', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId, workerCount }) },
  );
  const receivedAt = Date.now();
  const result = await parseResponse<ExtractionResponse>(response);
  return { ...result, serverOffsetMs: Date.parse(result.villageState.serverTime) - (requestedAt + receivedAt) / 2 };
}
