import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { ResolvedVillagePresentation, TravelRoute, VillageState } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { networkJob, type NetworkJob, type TravelNetworkExecutor } from '../navigation/network-job.js';
import type { readRc1Ground } from '../worlds/rc1-ground.js';
import { devTime } from '../operations/dev-timing.js';
import { ownedVillage, state, withVillageProjection, type OwnedVillage } from './service.js';
import type { SyncScope } from './sync-v2-journal.js';

/** Selection of the historical read-only projection: placement and routing
 * rules stay in one place. Collections are ordered canonically because
 * occupancy rows have no SQL order and the version digests the content. */
export function villagePresentation(state: VillageState): ResolvedVillagePresentation {
  const cells = state.cells
    .map(({ cellX, cellY, canBuild, footprint, building }) => ({
      cellX,
      cellY,
      canBuild,
      footprint,
      displaysBuilding: building !== null,
    }))
    .sort((a, b) => a.cellY - b.cellY || a.cellX - b.cellX);
  const travelRoutes = [...state.travelRoutes].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const market = state.village.market;
  if (!market) throw Error('Village projection has no market configuration');
  const region = {
    ...state.region,
    features: [...state.region.features].sort(
      (a, b) => a.cellY - b.cellY || a.cellX - b.cellX || a.id.localeCompare(b.id),
    ),
  };
  const content = {
    cells,
    travelRoutes,
    region,
    market: {
      unlocked: market.unlocked,
      deliveryMs: market.deliveryMs,
      commissionPercent: market.commissionPercent,
      resources: market.resources,
    },
  };
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    protocol: 2,
    worldId: state.world.id,
    villageId: state.village.id,
    version: digest(content),
    regionVersion: digest(region),
    observedAt: state.serverTime,
    ...content,
  };
}

type Ground = Awaited<ReturnType<typeof readRc1Ground>> | undefined;
interface Entry {
  worldId: string;
  /** Instant of the capture; the freshness bound counts from here. */
  at: number;
  scopes: SyncScope[];
  revisions: string;
  presentation: ResolvedVillagePresentation;
  /** Routes are a pure function of the planner input: reused across captures. */
  network: { fingerprint: string; routes: TravelRoute[] };
}
export interface PresentationReaderOptions {
  /** Upper bound on the age of time-projected quantities (woodland regrowth)
   * served from a capture whose structural journal has not moved. */
  freshMs: number;
  capacity: number;
  now: () => number;
}

/** Chunks of one axis crossed by a window, on the torus. A window sampled
 * every chunk length plus its last cell reaches every chunk it touches. */
function chunkAxis(origin: number, size: number, cells: number, chunk: number): number[] {
  const count = Math.ceil(cells / chunk);
  if (size >= cells) return Array.from({ length: count }, (_, i) => i);
  const indexes = new Set<number>();
  for (const cell of [
    ...Array.from({ length: Math.ceil(size / chunk) }, (_, i) => origin + i * chunk),
    origin + size - 1,
  ])
    indexes.add(Math.floor((((cell % cells) + cells) % cells) / chunk));
  return [...indexes].sort((a, b) => a - b);
}
/** Journal streams whose writers cover every structural input of the
 * presentation: the village's own entities (buildings, plots, extractions,
 * infrastructure), the world manifest (catalog, market prices, topology)
 * and the spatial chunks of the terrain window (ground, features, deposits).
 * Only projected deposit stocks move without a journal write. */
export function presentationScopes(
  village: Pick<OwnedVillage, 'worldId' | 'villageId' | 'widthCells' | 'heightCells' | 'chunkSize'>,
  region: Pick<VillageState['region'], 'originCellX' | 'originCellY' | 'width' | 'height'>,
): SyncScope[] {
  const xs = chunkAxis(region.originCellX, region.width, village.widthCells, village.chunkSize);
  const ys = chunkAxis(region.originCellY, region.height, village.heightCells, village.chunkSize);
  return [
    { kind: 'village', key: village.villageId },
    { kind: 'manifest', key: village.worldId },
    ...ys.flatMap((y) => xs.map((x) => ({ kind: 'spatial' as const, key: `${x},${y}` }))),
  ];
}
/** One indexed read of the stream counters. A stream without a row yet is a
 * stable "none" until its first change creates it. */
async function readScopeRevisions(db: Kysely<Database>, worldId: string, scopes: readonly SyncScope[]) {
  const rows = (
    await sql<{ kind: string; key: string; epoch: string; revision: string }>`select s.stream_kind as kind,
      s.scope_key as key,s.epoch::text as epoch,s.revision::text as revision from game_sync_streams s
    join jsonb_to_recordset(${JSON.stringify(scopes)}::jsonb) r(kind text,key text)
      on r.kind=s.stream_kind and r.key=s.scope_key where s.world_id=${worldId}`.execute(db)
  ).rows;
  const counters = new Map(rows.map((row) => [`${row.kind}:${row.key}`, `${row.epoch}/${row.revision}`]));
  return scopes
    .map((scope) => `${scope.kind}:${scope.key}=${counters.get(`${scope.kind}:${scope.key}`) ?? '-'}`)
    .join('\n');
}
function networkFingerprint(input: NetworkJob['state'], ground: Ground) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        state: input,
        ground: ground ? { seed: ground.data.seed, edits: ground.navigationEdits } : null,
      }),
    )
    .digest('hex');
}

/** Presentation reads of one process. Ownership is verified on every call;
 * the capture (one read-only MVCC snapshot, then the shared CPU pool) is
 * reused while the covering journal streams have not moved and the capture
 * is younger than the freshness bound. Concurrent reads of one village share
 * a single capture instead of queueing for CPU lanes. No economic wake-up,
 * admission or notification. */
export class VillagePresentationReader {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Entry>>();
  private readonly options: PresentationReaderOptions;
  constructor(
    private readonly db: Kysely<Database>,
    private readonly compute: TravelNetworkExecutor,
    options: Partial<PresentationReaderOptions> = {},
  ) {
    this.options = { freshMs: 60_000, capacity: 64, now: Date.now, ...options };
  }
  async read(accountId: string, worldSlug: string, villageId: string): Promise<ResolvedVillagePresentation> {
    const village = await ownedVillage(this.db, accountId, worldSlug, villageId);
    const key = village.villageId;
    const cached = this.entries.get(key);
    if (cached && cached.worldId === village.worldId && this.options.now() - cached.at < this.options.freshMs) {
      const revisions = await devTime('presentation_revisions', () =>
        readScopeRevisions(this.db, village.worldId, cached.scopes),
      );
      if (revisions === cached.revisions) return cached.presentation;
    }
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.capture(accountId, worldSlug, village).finally(() => {
        if (this.inflight.get(key) === pending) this.inflight.delete(key);
      });
      this.inflight.set(key, pending);
    }
    return (await pending).presentation;
  }
  private async capture(accountId: string, worldSlug: string, village: OwnedVillage): Promise<Entry> {
    const at = this.options.now();
    let captured: { input: NetworkJob['state']; ground: Ground } | undefined;
    // Counters and projection come from the same MVCC snapshot: a later read
    // seeing equal counters proves nothing structural committed after it.
    const { projected, scopes, revisions } = await withVillageProjection(
      this.db,
      accountId,
      worldSlug,
      village.villageId,
      async (tx, economy, current) => {
        const projected = await state(
          tx,
          accountId,
          worldSlug,
          economy,
          false,
          true,
          (input, ground) => {
            captured = { input, ground };
          },
          current,
        );
        const scopes = presentationScopes(current, projected.region);
        return { projected, scopes, revisions: await readScopeRevisions(tx, current.worldId, scopes) };
      },
    );
    if (!captured) throw Error('Missing navigation projection');
    const { input, ground } = captured;
    const fingerprint = networkFingerprint(input, ground);
    const previous = this.entries.get(village.villageId)?.network;
    const network =
      previous?.fingerprint === fingerprint
        ? previous
        : {
            fingerprint,
            // SQL is finished before any lane wait: no connection is held in the queue.
            routes: await this.compute.network((known) => Promise.resolve(networkJob(input, ground, known))),
          };
    projected.travelRoutes.unshift(...network.routes); // Committed woodland paths were captured with the snapshot.
    const entry: Entry = {
      worldId: village.worldId,
      at,
      scopes,
      revisions,
      presentation: villagePresentation(projected),
      network,
    };
    this.entries.delete(village.villageId);
    while (this.entries.size >= this.options.capacity) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(village.villageId, entry);
    return entry;
  }
}
