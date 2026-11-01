import {
  applySyncV2Batch,
  applySyncV2SnapshotPages,
  syncV2BatchIsValid,
  syncV2SnapshotPageIsValid,
  villageStateFromSyncV2,
  SYNC_V2_SNAPSHOT_MAX_PAGES,
  VILLAGE_PRESENTATION_COMPONENTS,
  type ResolvedVillagePresentation,
  type SyncV2Batch,
  type SyncV2ReadRequest,
  type SyncV2SnapshotPage,
  type SyncV2State,
  type VillageState,
} from '@arbestra/contracts';
import type { SyncV2SharedInclude } from '../villages/sync-v2-capture.js';

/** The V2 readers an observation uses, with the observed owner's identity. */
export interface ObservationSource {
  capture(
    accountId: string,
    worldSlug: string,
    villageId: string,
    request: SyncV2ReadRequest,
    options: { include?: readonly SyncV2SharedInclude[]; pages?: boolean },
  ): Promise<SyncV2Batch | SyncV2SnapshotPage>;
  presentation(accountId: string, worldSlug: string, villageId: string): Promise<ResolvedVillagePresentation>;
}

// The scopes the player's client reads, so the operator sees the same village.
const INCLUDE = ['knowledge', 'manifest', 'traffic'] as const;
const isSnapshot = (input: unknown) =>
  (syncV2BatchIsValid(input) && input.coverage === 'scope-snapshot') || syncV2SnapshotPageIsValid(input);
const structural = (batch: SyncV2Batch) =>
  batch.groups.some((group) =>
    group.changes.some(
      (change) =>
        (VILLAGE_PRESENTATION_COMPONENTS as readonly string[]).includes(change.component) &&
        (change.upsert.length > 0 || change.remove.length > 0),
    ),
  );

/** One observed village, read like the player's client: a private snapshot
 * (paged when large), then journal deltas from its cursors; the presentation
 * is reread after a snapshot or a structural change. No world-wide revision,
 * no historical `state()` per tick. `syncRevision` counts this observation's
 * published states, so the NOC keeps applying historical frames. */
export class ObservedVillage {
  private sync: SyncV2State | undefined;
  private presentation?: ResolvedVillagePresentation;
  private observedAt = '';
  private state?: VillageState;
  private revision = 0;
  private generation = 0;
  constructor(
    private readonly source: ObservationSource,
    private readonly accountId: string,
    private readonly worldSlug: string,
    private readonly villageId: string,
  ) {}
  private read(request: SyncV2ReadRequest, options: { include?: readonly SyncV2SharedInclude[]; pages?: boolean }) {
    return this.source.capture(this.accountId, this.worldSlug, this.villageId, request, options);
  }
  async current(): Promise<VillageState> {
    let changed = false,
      reread = !this.presentation;
    if (this.sync) {
      const cursors = [...this.sync.scopes].map(([scope, value]) => {
        const separator = scope.indexOf(':');
        return {
          kind: scope.slice(0, separator) as SyncV2ReadRequest['scopes'][number]['kind'],
          key: scope.slice(separator + 1),
          epoch: value.epoch,
          revision: value.revision,
        };
      });
      const input = await this.read(
        {
          protocol: 2,
          generation: this.sync.generation,
          scopes: cursors.map(({ kind, key }) => ({ kind, key })),
          cursors,
        },
        {},
      );
      if (isSnapshot(input)) this.sync = undefined;
      else {
        const result = applySyncV2Batch(this.sync, input);
        if (result.kind === 'resync') this.sync = undefined;
        else if (result.kind === 'applied') {
          this.sync = result.state;
          this.observedAt = (input as SyncV2Batch).observedAt;
          changed = true;
          reread ||= structural(input as SyncV2Batch);
        }
      }
    }
    if (!this.sync) {
      await this.snapshot();
      changed = reread = true;
    }
    if (reread) {
      const presentation = await this.source.presentation(this.accountId, this.worldSlug, this.villageId);
      if (presentation.version !== this.presentation?.version) changed = true;
      this.presentation = presentation;
    }
    if (!changed && this.state) return this.state;
    const state = villageStateFromSyncV2(this.sync!, this.presentation!, this.observedAt);
    if (!state) throw Error('Projection V2 incomplète.');
    // The operator never builds: no cell is offered for construction.
    const cells = state.cells.map((cell) => (cell.canBuild ? { ...cell, canBuild: false } : cell));
    this.state = { ...state, cells, syncRevision: ++this.revision };
    return this.state;
  }
  private async snapshot() {
    const generation = ++this.generation;
    const first = await this.read(
      { protocol: 2, generation, scopes: [], cursors: [] },
      { include: INCLUDE, pages: true },
    );
    const initial: SyncV2State = {
      worldId: first.worldId,
      villageId: first.villageId,
      generation,
      scopes: new Map(),
      subscribedScopes: new Set(first.groups.map((group) => `${group.stream.kind}:${group.stream.key}`)),
    };
    if (!syncV2SnapshotPageIsValid(first)) {
      const result = applySyncV2Batch(initial, first);
      if (result.kind !== 'applied') throw Error('Instantané V2 refusé.');
      this.sync = result.state;
      this.observedAt = (first as SyncV2Batch).observedAt;
      return;
    }
    const pages: SyncV2SnapshotPage[] = [first];
    for (let next = first.next; next; next = pages.at(-1)!.next) {
      if (pages.length >= SYNC_V2_SNAPSHOT_MAX_PAGES) throw Error('Instantané V2 trop long.');
      const page = await this.read(
        {
          protocol: 2,
          generation,
          scopes: [{ kind: 'village', key: this.villageId }],
          cursors: [],
          page: { after: next },
        },
        { pages: true },
      );
      if (!syncV2SnapshotPageIsValid(page)) throw Error('Page d’instantané V2 invalide.');
      pages.push(page);
    }
    const delta = await this.read(
      {
        protocol: 2,
        generation,
        scopes: first.groups.map(({ stream }) => ({ kind: stream.kind, key: stream.key })),
        cursors: first.groups.map(({ stream, toRevision }) => ({ ...stream, revision: toRevision })),
      },
      {},
    );
    const result = applySyncV2SnapshotPages(initial, pages, delta);
    if (result.kind !== 'applied') throw Error('Instantané V2 paginé refusé.');
    this.sync = result.state;
    this.observedAt = (delta as SyncV2Batch).observedAt;
  }
}
