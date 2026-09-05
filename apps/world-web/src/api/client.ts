import type { BuildingType, VillageState } from '@arbestra/contracts';

export class ApiError extends Error {
  public constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Une erreur est survenue.' })) as { message?: string };
    throw new ApiError(error.message ?? 'Une erreur est survenue.', response.status);
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

export function harvestGarden(worldSlug: string, villageId: string, buildingId: string): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/buildings/${encodeURIComponent(buildingId)}/harvest`,
    { method: 'POST' },
  );
}
