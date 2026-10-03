import type { CatDiscoveryResponse, BuildingType, DepositDetails, ExtractionResponse, VillageState, TerrainResponse, TerrainUpdatesResponse, TerrainOverview, TerrainVegetationOverview, TerrainVillageOverview, StartExtractionWorksiteRequest, ChangeExtractionWorksiteRequest, ExtractionWorksite, ExtractionWorksiteSelection } from '@arbestra/contracts';

export async function previewWorksite(worldSlug: string, villageId: string, order: StartExtractionWorksiteRequest): Promise<ExtractionWorksiteSelection> {
  return parseResponse<ExtractionWorksiteSelection>(await fetch(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/worksites/preview`, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(order),
    }));
}

export async function startWorksite(worldSlug: string, villageId: string, order: StartExtractionWorksiteRequest): Promise<TimedVillageState & { worksite: ExtractionWorksite }> {
  const requestedAt = Date.now();
  const response = await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/worksites`, {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(order),
  });
  const receivedAt = Date.now(), result = await parseResponse<{ villageState: VillageState; worksite: ExtractionWorksite }>(response);
  return { state: result.villageState, worksite: result.worksite,
    serverOffsetMs: Date.parse(result.villageState.serverTime) - (requestedAt + receivedAt) / 2 };
}

export async function changeWorksite(worldSlug: string, villageId: string, worksiteId: string,
  order: ChangeExtractionWorksiteRequest): Promise<TimedVillageState & { worksite: ExtractionWorksite }> {
  const requestedAt = Date.now();
  const response = await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/worksites/${encodeURIComponent(worksiteId)}`, {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(order),
  });
  const receivedAt = Date.now(), result = await parseResponse<{ villageState: VillageState; worksite: ExtractionWorksite }>(response);
  return { state: result.villageState, worksite: result.worksite,
    serverOffsetMs: Date.parse(result.villageState.serverTime) - (requestedAt + receivedAt) / 2 };
}

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

export async function getTerrain(worldSlug: string, chunks: Array<{ chunkX: number; chunkY: number }>, signal: AbortSignal): Promise<TerrainResponse> {
  const query = chunks.map((c) => `${c.chunkX},${c.chunkY}`).join(';');
  return parseResponse<TerrainResponse>(await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/terrain?chunks=${encodeURIComponent(query)}`, { credentials: 'same-origin', signal }));
}

export async function getTerrainUpdates(worldSlug: string, chunks: Array<{ chunkX: number; chunkY: number }>, signal: AbortSignal): Promise<TerrainUpdatesResponse> {
  const query = chunks.map(c => `${c.chunkX},${c.chunkY}`).join(';');
  return parseResponse<TerrainUpdatesResponse>(await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/terrain/updates?chunks=${encodeURIComponent(query)}`, { credentials: 'same-origin', signal }));
}

export async function getTerrainOverview(worldSlug: string, signal: AbortSignal): Promise<TerrainOverview> {
  return parseResponse<TerrainOverview>(await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/terrain/overview`,
    { credentials: 'same-origin', signal }));
}
export async function getTerrainVillages(worldSlug: string, x: number, y: number, signal: AbortSignal): Promise<TerrainVillageOverview> {
  return parseResponse<TerrainVillageOverview>(await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/terrain/overview/villages?x=${Math.floor(x)}&y=${Math.floor(y)}`,
    { credentials: 'same-origin', signal }));
}

export async function getTerrainVegetationOverview(worldSlug: string, signal: AbortSignal): Promise<TerrainVegetationOverview> {
  return parseResponse<TerrainVegetationOverview>(await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/terrain/overview/vegetation`,
    { credentials: 'same-origin', signal }));
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

export function harvestGardenSelection(worldSlug:string,villageId:string,cells:Array<{cellX:number;cellY:number}>,commandId:string):Promise<TimedVillageState>{
  return requestState(`/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/garden-harvests`,
    {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commandId,cells})});
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

export async function clearWoodland(worldSlug: string, villageId: string, featureId: string): Promise<TimedVillageState> {
  const requestedAt = Date.now();
  const response = await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/features/${encodeURIComponent(featureId)}/clear`,
    { credentials: 'same-origin', method: 'POST' });
  const receivedAt = Date.now(), state = await parseResponse<VillageState>(response);
  return { state, serverOffsetMs: Date.parse(state.serverTime) - (requestedAt + receivedAt) / 2 };
}

export async function discoverCatEyes(worldSlug: string, villageId: string): Promise<TimedVillageState & { newlyCompleted: boolean }> {
  const requestedAt = Date.now();
  const response = await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/discover-cat-eyes`, { method: 'POST', credentials: 'same-origin' });
  const receivedAt = Date.now(), result = await parseResponse<CatDiscoveryResponse>(response);
  return { state: result.villageState, newlyCompleted: result.newlyCompleted,
    serverOffsetMs: Date.parse(result.villageState.serverTime) - (requestedAt + receivedAt) / 2 };
}
