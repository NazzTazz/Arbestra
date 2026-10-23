import type { ExpeditionIntent, ExpeditionReceipt } from '@arbestra/contracts';
export async function sendExpedition(
  slug: string,
  villageId: string,
  intent: ExpeditionIntent,
): Promise<ExpeditionReceipt> {
  return parseResponse(
    await fetch('/api/worlds/' + encodeURIComponent(slug) + '/villages/' + encodeURIComponent(villageId) + '/science', {
      method: 'POST',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(intent),
    }),
  );
}
export async function readExpeditionReceipts(
  slug: string,
  villageId: string,
  ids?: string[],
): Promise<ExpeditionReceipt[]> {
  return parseResponse(
    await fetch(
      '/api/worlds/' +
        encodeURIComponent(slug) +
        '/villages/' +
        encodeURIComponent(villageId) +
        '/science/expeditions' +
        (ids ? '?ids=' + encodeURIComponent(ids.join(',')) : ''),
      { credentials: 'same-origin', signal: AbortSignal.timeout(10000) },
    ),
  );
}
export async function readHarvestReceipts(slug: string, villageId: string, ids: string[]): Promise<HarvestReceipt[]> {
  return parseResponse(
    await fetch(
      '/api/worlds/' +
        encodeURIComponent(slug) +
        '/villages/' +
        encodeURIComponent(villageId) +
        '/harvest-intents?ids=' +
        encodeURIComponent(ids.join(',')),
      { signal: AbortSignal.timeout(10000), credentials: 'same-origin' },
    ),
  );
}
import type { HarvestIntent, HarvestReceipt } from '@arbestra/contracts';
export async function sendHarvestIntent(
  slug: string,
  villageId: string,
  intent: HarvestIntent,
): Promise<HarvestReceipt> {
  return parseResponse(
    await fetch(
      '/api/worlds/' + encodeURIComponent(slug) + '/villages/' + encodeURIComponent(villageId) + '/harvest-intents',
      {
        signal: AbortSignal.timeout(15000),
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(intent),
      },
    ),
  );
}
import { randomUUID } from '../random-uuid';
import { villageRequestGeneration } from './village-sync';
import {
  constructionConfirmationIsValid,
  type ConstructionConfirmation,
  villageCommandResponseIsValid,
  infrastructureConfirmationIsValid,
  type InfrastructureConfirmation,
  type VillageFrame,
  type VillageSyncBase,
} from '@arbestra/contracts';
import type {
  CatDiscoveryResponse,
  BuildingType,
  DepositDetails,
  ExtractionResponse,
  VillageState,
  TerrainResponse,
  TerrainUpdatesResponse,
  TerrainOverview,
  TerrainVegetationOverview,
  TerrainVillageOverview,
  StartExtractionWorksiteRequest,
  ChangeExtractionWorksiteRequest,
  ExtractionWorksite,
  ExtractionWorksiteSelection,
} from '@arbestra/contracts';
import type { ScienceCommand } from '@arbestra/contracts';
import type { ProcessingCommand, ProcessingPreview } from '@arbestra/contracts';
import type { MarketCommand, MarketRequest, MarketPreview } from '@arbestra/contracts';
import type { TradeCommand, TradePage, TradePreview } from '@arbestra/contracts';
const tradeUrl = (slug: string, villageId: string) =>
  `/api/worlds/${encodeURIComponent(slug)}/villages/${encodeURIComponent(villageId)}/market`;
export function commandPlayerMarket(
  slug: string,
  villageId: string,
  command: TradeCommand,
): Promise<TimedVillageState> {
  return requestState(tradeUrl(slug, villageId) + '/trades', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
}
export async function browseMarket(
  slug: string,
  villageId: string,
  mine: boolean,
  cursor?: string,
  signal?: AbortSignal,
): Promise<TradePage> {
  return parseResponse(
    await fetch(
      tradeUrl(slug, villageId) + '/offers?mine=' + mine + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      { credentials: 'same-origin', ...(signal ? { signal } : {}) },
    ),
  );
}
export async function previewTrade(slug: string, villageId: string, offerId: string): Promise<TradePreview> {
  return parseResponse(
    await fetch(tradeUrl(slug, villageId) + '/trade-preview', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offerId }),
    }),
  );
}
export function commandMarket(slug: string, villageId: string, command: MarketCommand): Promise<TimedVillageState> {
  return requestState(`/api/worlds/${encodeURIComponent(slug)}/villages/${encodeURIComponent(villageId)}/market`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
}
export async function previewMarket(slug: string, villageId: string, request: MarketRequest): Promise<MarketPreview> {
  return parseResponse(
    await fetch(`/api/worlds/${encodeURIComponent(slug)}/villages/${encodeURIComponent(villageId)}/market/preview`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
}
export function commandProcessing(
  slug: string,
  villageId: string,
  command: ProcessingCommand,
): Promise<TimedVillageState> {
  return requestState(`/api/worlds/${encodeURIComponent(slug)}/villages/${encodeURIComponent(villageId)}/processing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
}
export async function previewProcessing(
  slug: string,
  villageId: string,
  buildingId: string,
  workerCount: number,
  orderId?: string,
): Promise<ProcessingPreview> {
  return parseResponse(
    await fetch(
      `/api/worlds/${encodeURIComponent(slug)}/villages/${encodeURIComponent(villageId)}/processing/preview`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ buildingId, workerCount, ...(orderId ? { orderId } : {}) }),
      },
    ),
  );
}
import type { ExploitationRequest, ExploitationPreview } from '@arbestra/contracts';
import type { InfrastructureRequest, InfrastructurePreview } from '@arbestra/contracts';
export async function previewInfrastructure(
  slug: string,
  villageId: string,
  request: InfrastructureRequest,
): Promise<InfrastructurePreview> {
  return parseResponse(
    await fetch(`/api/worlds/${encodeURIComponent(slug)}/villages/${villageId}/infrastructure/preview`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
}
export function commandInfrastructure(
  slug: string,
  villageId: string,
  request: InfrastructureRequest,
  base?: VillageSyncBase,
) {
  return requestVillageCommandState(
    `/api/worlds/${encodeURIComponent(slug)}/villages/${villageId}/infrastructure`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) },
    base,
    true,
  );
}

export async function previewExploitation(
  worldSlug: string,
  villageId: string,
  order: ExploitationRequest,
  signal?: AbortSignal,
): Promise<ExploitationPreview> {
  return parseResponse<ExploitationPreview>(
    await fetch(
      `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/exploitation/preview`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(order),
        signal: signal ?? null,
      },
    ),
  );
}
export function startExploitation(
  worldSlug: string,
  villageId: string,
  order: ExploitationRequest,
): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/exploitation`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order),
    },
  );
}

export const sciencePreview = () =>
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('sciencePreview') === '1';
const terrainHeaders = () => (sciencePreview() ? { 'x-arbestra-science-preview': '1' } : {});

export function commandScience(
  worldSlug: string,
  villageId: string,
  command: ScienceCommand,
): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/science`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) },
  );
}

export async function previewWorksite(
  worldSlug: string,
  villageId: string,
  order: StartExtractionWorksiteRequest,
): Promise<ExtractionWorksiteSelection> {
  return parseResponse<ExtractionWorksiteSelection>(
    await fetch(
      `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/worksites/preview`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(order),
      },
    ),
  );
}

export async function startWorksite(
  worldSlug: string,
  villageId: string,
  order: StartExtractionWorksiteRequest,
): Promise<TimedVillageState & { worksite: ExtractionWorksite }> {
  const requestedAt = Date.now();
  const requestGeneration = villageRequestGeneration();
  const response = await fetch(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/worksites`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order),
    },
  );
  const receivedAt = Date.now(),
    result = await parseResponse<{ villageState: VillageState; worksite: ExtractionWorksite }>(response);
  return {
    state: result.villageState,
    worksite: result.worksite,
    requestGeneration,
    serverOffsetMs: Date.parse(result.villageState.serverTime) - (requestedAt + receivedAt) / 2,
  };
}

export async function changeWorksite(
  worldSlug: string,
  villageId: string,
  worksiteId: string,
  order: ChangeExtractionWorksiteRequest,
): Promise<TimedVillageState & { worksite: ExtractionWorksite }> {
  const requestedAt = Date.now();
  const requestGeneration = villageRequestGeneration();
  const response = await fetch(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/worksites/${encodeURIComponent(worksiteId)}`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order),
    },
  );
  const receivedAt = Date.now(),
    result = await parseResponse<{ villageState: VillageState; worksite: ExtractionWorksite }>(response);
  return {
    state: result.villageState,
    worksite: result.worksite,
    requestGeneration,
    serverOffsetMs: Date.parse(result.villageState.serverTime) - (requestedAt + receivedAt) / 2,
  };
}

export class ApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error: { message?: string; code?: string } = await timedJson<{ message?: string; code?: string }>(
      response,
    ).catch(() => ({ message: 'Une erreur est survenue.' }));
    throw new ApiError(error.message ?? 'Une erreur est survenue.', response.status, error.code);
  }
  return timedJson<T>(response);
}

export interface TimedVillageState {
  state: VillageState;
  serverOffsetMs: number;
  requestGeneration?: number;
  /** Projected from the V2 streams; never ordered by the V1 revision. */
  source?: 'v2';
}

export interface TimedVillageFrame {
  frame: VillageFrame;
  serverOffsetMs: number;
  requestGeneration?: number;
}
export type TimedVillageUpdate = TimedVillageState | TimedVillageFrame;
export interface TimedConstructionConfirmation {
  construction: ConstructionConfirmation;
  requestGeneration: number;
}
export type TimedConstructionUpdate = TimedVillageUpdate | TimedConstructionConfirmation;
export interface TimedInfrastructureConfirmation {
  confirmation: InfrastructureConfirmation;
  requestGeneration: number;
}
export type TimedInfrastructureUpdate = TimedVillageUpdate | TimedInfrastructureConfirmation;

async function villageRequest(request: Promise<Response>, requestedAt: number): Promise<TimedVillageState> {
  const requestGeneration = villageRequestGeneration();
  const response = await request;
  const receivedAt = Date.now();
  const state = await parseResponse<VillageState>(response);
  return { state, serverOffsetMs: Date.parse(state.serverTime) - (requestedAt + receivedAt) / 2, requestGeneration };
}

function requestState(path: string, init?: RequestInit): Promise<TimedVillageState> {
  const requestedAt = Date.now();
  return villageRequest(fetch(path, { credentials: 'same-origin', ...init }), requestedAt);
}
function requestVillageCommandState(
  path: string,
  init: RequestInit,
  base?: VillageSyncBase,
  confirmation?: false,
): Promise<TimedVillageUpdate>;
function requestVillageCommandState(
  path: string,
  init: RequestInit,
  base: VillageSyncBase | undefined,
  confirmation: true,
): Promise<TimedInfrastructureUpdate>;
function requestVillageCommandState(
  path: string,
  init: RequestInit,
  base: VillageSyncBase | undefined,
  confirmation: { commandId: string; villageId: string },
): Promise<TimedConstructionUpdate>;
async function requestVillageCommandState(
  path: string,
  init: RequestInit,
  base?: VillageSyncBase,
  confirmation: boolean | { commandId: string; villageId: string } = false,
): Promise<TimedInfrastructureUpdate | TimedConstructionConfirmation> {
  const requestedAt = Date.now(),
    requestGeneration = villageRequestGeneration();
  const headers = {
    ...init.headers,
    'x-village-sync': '1',
    ...(confirmation === true ? { 'x-infrastructure-confirmation': '1' } : {}),
    ...(typeof confirmation === 'object' ? { 'x-construction-confirmation': '1' } : {}),
    ...(base
      ? {
          'x-village-revision': String(base.revision),
          'x-village-server-time': base.serverTime,
        }
      : {}),
  };
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const receivedAt = Date.now(),
    data = await parseResponse<unknown>(response);
  if (confirmation === true && infrastructureConfirmationIsValid(data))
    return { confirmation: data, requestGeneration };
  if (typeof confirmation === 'object' && constructionConfirmationIsValid(data)) {
    if (data.commandId !== confirmation.commandId || data.villageId !== confirmation.villageId)
      throw Error('Confirmation de construction incohérente.');
    return { construction: data, requestGeneration };
  }
  if (villageCommandResponseIsValid(data)) {
    const timed = { requestGeneration, serverOffsetMs: Date.parse(data.serverTime) - (requestedAt + receivedAt) / 2 };
    return data.kind === 'frame' ? { ...timed, frame: data.frame } : { ...timed, state: data.state };
  }
  if (data && typeof data === 'object' && 'kind' in data) throw Error('Réponse de synchronisation invalide.');
  // Existing servers and saved clients retain the full-snapshot contract.
  const state = data as VillageState;
  return { state, requestGeneration, serverOffsetMs: Date.parse(state.serverTime) - (requestedAt + receivedAt) / 2 };
}

export function getVillage(worldSlug: string, villageId?: string): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/village${villageId ? `?villageId=${encodeURIComponent(villageId)}` : ''}`,
    { signal: AbortSignal.timeout(90_000) },
  );
}

export async function getTerrain(
  worldSlug: string,
  chunks: Array<{ chunkX: number; chunkY: number }>,
  signal: AbortSignal,
): Promise<TerrainResponse> {
  const query = chunks.map((c) => `${c.chunkX},${c.chunkY}`).join(';');
  return parseResponse<TerrainResponse>(
    await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/terrain?chunks=${encodeURIComponent(query)}`, {
      credentials: 'same-origin',
      signal,
      headers: terrainHeaders(),
    }),
  );
}

export async function getTerrainUpdates(
  worldSlug: string,
  chunks: Array<{ chunkX: number; chunkY: number }>,
  signal: AbortSignal,
): Promise<TerrainUpdatesResponse> {
  const query = chunks.map((c) => `${c.chunkX},${c.chunkY}`).join(';');
  return parseResponse<TerrainUpdatesResponse>(
    await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/terrain/updates?chunks=${encodeURIComponent(query)}`, {
      credentials: 'same-origin',
      signal,
      headers: { ...terrainHeaders(), 'x-arbestra-terrain-edits': '1' },
    }),
  );
}

export async function getTerrainOverview(worldSlug: string, signal: AbortSignal): Promise<TerrainOverview> {
  return parseResponse<TerrainOverview>(
    await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/terrain/overview`, {
      credentials: 'same-origin',
      signal,
      headers: terrainHeaders(),
    }),
  );
}
export async function getTerrainVillages(
  worldSlug: string,
  x: number,
  y: number,
  signal: AbortSignal,
): Promise<TerrainVillageOverview> {
  return parseResponse<TerrainVillageOverview>(
    await fetch(
      `/api/worlds/${encodeURIComponent(worldSlug)}/terrain/overview/villages?x=${Math.floor(x)}&y=${Math.floor(y)}`,
      { credentials: 'same-origin', signal, headers: terrainHeaders() },
    ),
  );
}

export async function getTerrainVegetationOverview(
  worldSlug: string,
  signal: AbortSignal,
): Promise<TerrainVegetationOverview> {
  return parseResponse<TerrainVegetationOverview>(
    await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/terrain/overview/vegetation`, {
      credentials: 'same-origin',
      signal,
      headers: terrainHeaders(),
    }),
  );
}

export function buildBuilding(
  worldSlug: string,
  villageId: string,
  buildingType: BuildingType,
  anchor: { cellX: number; cellY: number },
  cells: Array<{ cellX: number; cellY: number }>,
  commandId: string = randomUUID(),
  expectedCosts: Array<{ resourceCode: string; amount: number }> = [],
  quarterTurns = 0,
  houseVariant: 'stone' | 'logs' | 'beams' = 'stone',
  syncBase?: VillageSyncBase,
): Promise<TimedConstructionUpdate> {
  return requestVillageCommandState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/buildings`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        commandId,
        expectedCosts,
        quarterTurns,
        houseVariant,
        buildingType,
        anchorCellX: anchor.cellX,
        anchorCellY: anchor.cellY,
        cells,
      }),
    },
    syncBase,
    { commandId, villageId },
  );
}

export function expandGarden(
  worldSlug: string,
  villageId: string,
  buildingId: string,
  cells: Array<{ cellX: number; cellY: number }>,
  commandId: string = randomUUID(),
  expectedCosts: Array<{ resourceCode: string; amount: number }> = [],
  syncBase?: VillageSyncBase,
): Promise<TimedConstructionUpdate> {
  return requestVillageCommandState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/buildings/${encodeURIComponent(buildingId)}/expansions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId, expectedCosts, cells }),
    },
    syncBase,
    { commandId, villageId },
  );
}

export function upgradeBuilding(
  worldSlug: string,
  villageId: string,
  buildingId: string,
  commandId: string = randomUUID(),
  expectedCosts: Array<{ resourceCode: string; amount: number }> = [],
  expectedLevel?: number,
  syncBase?: VillageSyncBase,
): Promise<TimedConstructionUpdate> {
  return requestVillageCommandState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/buildings/${encodeURIComponent(buildingId)}/upgrade`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId, expectedCosts, expectedLevel }),
    },
    syncBase,
    { commandId, villageId },
  );
}

export function harvestGardenSelection(
  worldSlug: string,
  villageId: string,
  cells: Array<{ cellX: number; cellY: number }>,
  commandId: string,
): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/garden-harvests`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId, cells }) },
  );
}
export function harvestGarden(
  worldSlug: string,
  villageId: string,
  buildingId: string,
  cellX: number,
  cellY: number,
  commandId: string = randomUUID(),
): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/buildings/${encodeURIComponent(buildingId)}/harvest`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId, cellX, cellY }),
    },
  );
}

export function discoverBuildingSupplies(
  worldSlug: string,
  villageId: string,
  buildingId: string,
): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/buildings/${encodeURIComponent(buildingId)}/discover-supplies`,
    { method: 'POST' },
  );
}

export async function discoverOrRefreshSupplies(worldSlug: string, villageId: string, buildingId: string) {
  try {
    return { snapshot: await discoverBuildingSupplies(worldSlug, villageId, buildingId), alreadyDiscovered: false };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'SUPPLIES_ALREADY_DISCOVERED') throw error;
    return { snapshot: await getVillage(worldSlug), alreadyDiscovered: true };
  }
}

function populationCommand(
  worldSlug: string,
  villageId: string,
  action: 'feed' | 'rest',
  count: number,
  commandId: string,
): Promise<TimedVillageState> {
  return requestState(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/population/${action}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId, count }),
    },
  );
}

export function feedPopulation(
  worldSlug: string,
  villageId: string,
  count: number,
  commandId: string,
): Promise<TimedVillageState> {
  return populationCommand(worldSlug, villageId, 'feed', count, commandId);
}

export function restPopulation(
  worldSlug: string,
  villageId: string,
  count: number,
  commandId: string,
): Promise<TimedVillageState> {
  return populationCommand(worldSlug, villageId, 'rest', count, commandId);
}

export async function getStoneDepositDetails(
  worldSlug: string,
  villageId: string,
  featureId: string,
): Promise<DepositDetails> {
  return parseResponse<DepositDetails>(
    await fetch(
      `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/features/${encodeURIComponent(featureId)}`,
      { credentials: 'same-origin' },
    ),
  );
}

export async function startStoneExtraction(
  worldSlug: string,
  villageId: string,
  featureId: string,
  workerCount: number,
  commandId: string,
): Promise<ExtractionResponse & { serverOffsetMs: number; requestGeneration: number }> {
  const requestedAt = Date.now();
  const requestGeneration = villageRequestGeneration();
  const response = await fetch(
    '/api/worlds/' +
      encodeURIComponent(worldSlug) +
      '/villages/' +
      encodeURIComponent(villageId) +
      '/features/' +
      encodeURIComponent(featureId) +
      '/extractions',
    {
      credentials: 'same-origin',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId, workerCount }),
    },
  );
  const receivedAt = Date.now();
  const result = await parseResponse<ExtractionResponse>(response);
  return {
    ...result,
    requestGeneration,
    serverOffsetMs: Date.parse(result.villageState.serverTime) - (requestedAt + receivedAt) / 2,
  };
}

export async function clearWoodland(
  worldSlug: string,
  villageId: string,
  featureId: string,
): Promise<TimedVillageState> {
  const requestedAt = Date.now();
  const requestGeneration = villageRequestGeneration();
  const response = await fetch(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/features/${encodeURIComponent(featureId)}/clear`,
    { credentials: 'same-origin', method: 'POST' },
  );
  const receivedAt = Date.now(),
    state = await parseResponse<VillageState>(response);
  return { state, requestGeneration, serverOffsetMs: Date.parse(state.serverTime) - (requestedAt + receivedAt) / 2 };
}

export async function discoverCatEyes(
  worldSlug: string,
  villageId: string,
): Promise<TimedVillageState & { newlyCompleted: boolean }> {
  const requestedAt = Date.now();
  const requestGeneration = villageRequestGeneration();
  const response = await fetch(
    `/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}/discover-cat-eyes`,
    { method: 'POST', credentials: 'same-origin' },
  );
  const receivedAt = Date.now(),
    result = await parseResponse<CatDiscoveryResponse>(response);
  return {
    state: result.villageState,
    newlyCompleted: result.newlyCompleted,
    requestGeneration,
    serverOffsetMs: Date.parse(result.villageState.serverTime) - (requestedAt + receivedAt) / 2,
  };
}
export async function setFactoryEnabled(
  worldSlug: string,
  enabled: boolean,
  villageId?: string,
): Promise<TimedVillageState> {
  const response = await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/dev/factory-access`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  await parseResponse(response);
  return getVillage(worldSlug, villageId);
}
import { timedFetch as fetch, timedJson } from '../dev/statistics';

export async function previewLeveling(
  slug: string,
  villageId: string,
  request: import('@arbestra/contracts').LevelingRequest,
  signal?: AbortSignal,
): Promise<import('@arbestra/contracts').LevelingPreview> {
  return parseResponse(
    await fetch(`/api/worlds/${encodeURIComponent(slug)}/villages/${encodeURIComponent(villageId)}/leveling/preview`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: signal ?? null,
    }),
  );
}
export function commandLeveling(
  slug: string,
  villageId: string,
  command: import('@arbestra/contracts').LevelingCommand,
): Promise<TimedVillageState> {
  return requestState(`/api/worlds/${encodeURIComponent(slug)}/villages/${encodeURIComponent(villageId)}/leveling`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
}

export async function commandTerraform(
  slug: string,
  villageId: string,
  command: import('@arbestra/contracts').TerraformCommand,
): Promise<
  | { status: 'changed'; preview: import('@arbestra/contracts').LevelingPreview }
  | { status: 'started'; snapshot: TimedVillageState }
> {
  const sentAt = Date.now(),
    requestGeneration = villageRequestGeneration();
  const response = await fetch(
    `/api/worlds/${encodeURIComponent(slug)}/villages/${encodeURIComponent(villageId)}/terraform`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(60000),
    },
  );
  const receivedAt = Date.now(),
    result = await parseResponse<
      | { status: 'changed'; preview: import('@arbestra/contracts').LevelingPreview }
      | { status: 'started'; state: VillageState }
    >(response);
  return result.status === 'changed'
    ? result
    : {
        status: 'started',
        snapshot: {
          state: result.state,
          requestGeneration,
          serverOffsetMs: Date.parse(result.state.serverTime) - (sentAt + receivedAt) / 2,
        },
      };
}

import { hudWorkforceConfirmationIsValid, type HudWorkforceIntent } from '@arbestra/contracts';
export type { HudWorkforceIntent } from '@arbestra/contracts';
export async function commandHudWorkforce(slug: string, villageId: string, intent: HudWorkforceIntent) {
  const response = await fetch(
    `/api/worlds/${encodeURIComponent(slug)}/villages/${encodeURIComponent(villageId)}/${intent.kind === 'pool' ? 'extraction-pools' : 'population/gestures'}`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(intent.command),
      signal: AbortSignal.timeout(15000),
    },
  );
  const result = await parseResponse<unknown>(response);
  if (
    !hudWorkforceConfirmationIsValid(result) ||
    result.commandId !== intent.command.commandId ||
    result.hud.villageId !== villageId
  )
    throw Error('Confirmation de geste invalide.');
  return result;
}
