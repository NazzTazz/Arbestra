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
/** « Annuler » a harvest gesture's wood (slice 2e): idempotent, the first receipt is replayed. */
export async function cancelHarvestIntent(
  slug: string,
  villageId: string,
  commandId: string,
): Promise<import('@arbestra/contracts').HarvestCancelReceipt> {
  return parseResponse(
    await fetch(
      '/api/worlds/' +
        encodeURIComponent(slug) +
        '/villages/' +
        encodeURIComponent(villageId) +
        '/harvest-intents/' +
        encodeURIComponent(commandId) +
        '/cancel',
      { signal: AbortSignal.timeout(15000), method: 'POST', credentials: 'same-origin' },
    ),
  );
}
import type {
  DepositDetails,
  VillageState,
  TerrainResponse,
  TerrainUpdatesResponse,
  TerrainOverview,
  TerrainVegetationOverview,
  TerrainVillageOverview,
} from '@arbestra/contracts';
import type { ProcessingPreview } from '@arbestra/contracts';
import type { TradePage, TradePreview } from '@arbestra/contracts';
const tradeUrl = (slug: string, villageId: string) =>
  `/api/worlds/${encodeURIComponent(slug)}/villages/${encodeURIComponent(villageId)}/market`;
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

export const sciencePreview = () =>
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('sciencePreview') === '1';
const terrainHeaders = () => (sciencePreview() ? { 'x-arbestra-science-preview': '1' } : {});

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

/** A village state projected from the V2 streams, with the server's clock offset. */
export interface TimedVillageState {
  state: VillageState;
  serverOffsetMs: number;
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

/** Development switch of the workshop access. The village learns the new value
 * through its V2 streams: the caller asks for a refresh, there is nothing to read. */
export async function setFactoryEnabled(worldSlug: string, enabled: boolean): Promise<void> {
  const response = await fetch(`/api/worlds/${encodeURIComponent(worldSlug)}/dev/factory-access`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  await parseResponse(response);
}
import { timedFetch as fetch, timedJson } from '../dev/statistics';
