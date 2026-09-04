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
  cellId: string,
  buildingType: BuildingType,
): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/cells/${encodeURIComponent(cellId)}/buildings`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buildingType }) },
  );
}

export function upgradeBuilding(
  worldSlug: string,
  villageId: string,
  buildingId: string,
  extensionCellId?: string,
): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/buildings/${encodeURIComponent(buildingId)}/upgrade`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(extensionCellId ? { extensionCellId } : {}) },
  );
}

export function harvestGarden(worldSlug: string, villageId: string, buildingId: string): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/buildings/${encodeURIComponent(buildingId)}/harvest`,
    { method: 'POST' },
  );
}
