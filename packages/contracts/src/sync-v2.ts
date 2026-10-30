import { Type, FormatRegistry, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { ProcessingOrderSchema, ProcessingCommandSchema, type ProcessingCommand } from './processing.js';
import {
  ResourceStockSchema,
  VillageStateSchema,
  BuildingSchema,
  VillageAccomplishmentSchema,
  GardenHarvestStopSchema,
  ExtractionSchema,
  ExtractionWorksiteSchema,
} from './villages.js';
import { ExtractionPoolSchema } from './hud-workforce.js';
import { ExploitationOrderSchema } from './exploitation.js';
import { LevelingJobSchema } from './leveling.js';
import { MarketExchangeSchema, TradeOfferSchema, MarketJourneySchema } from './market.js';
import { ScienceStateSchema } from './science.js';
import { InfrastructurePlanSchema } from './infrastructure.js';
import { RoadCellSchema, RoadCellsResultSchema } from './road-cells.js';
import { RoadAnchorSchema, RoadAnchorsResultSchema } from './road-anchors.js';
import { StarterInstallationSchema } from './spawn-installation.js';
import { SYNC_V2_SPATIAL_COMPONENTS, SyncV2SpatialChangeSchema } from './sync-v2-spatial.js';
import {
  SYNC_V2_KNOWLEDGE_COMPONENTS,
  SYNC_V2_MANIFEST_COMPONENTS,
  SYNC_V2_OFFER_COMPONENTS,
  SYNC_V2_TRAFFIC_COMPONENTS,
  SyncV2SharedChangeSchema,
} from './sync-v2-shared.js';

if (!FormatRegistry.Has('uuid'))
  FormatRegistry.Set('uuid', (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
if (!FormatRegistry.Has('date-time'))
  FormatRegistry.Set('date-time', (value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));

// Foundation only: a stream must not be activated until its entire component
// registry and every writer are covered. These schemas do not negotiate V2.
const revision = Type.String({ pattern: '^(0|[1-9][0-9]{0,18})$' });
const id = Type.String({ format: 'uuid' });
const time = Type.String({ format: 'date-time' });
// Cohorts, buildings, homes, plots and contributions grow with the village and
// have no finished history to leave out: they share the private snapshot's
// own bound (4096 references) instead of the 1024 of history components.
const LIVE_ENTITIES = 4096;
export const SyncV2PopulationSummarySchema = Type.Object(
  {
    id: Type.Literal('*'),
    ...Type.Omit(VillageStateSchema.properties.village.properties.population, ['cohorts', 'restHousing']).properties,
  },
  { additionalProperties: false },
);
export const SyncV2CohortSchema = Type.Object(
  {
    ...VillageStateSchema.properties.village.properties.population.properties.cohorts.items.properties,
    clock: Type.Object(
      {
        energy: Type.Integer({ minimum: 0, maximum: 10 }),
        progress: Type.Integer(),
        activity: Type.Union([Type.Literal('idle'), Type.Literal('working'), Type.Literal('resting')]),
        restingSince: Type.Union([time, Type.Null()]),
        foodUsedSinceRest: Type.Integer({ minimum: 0 }),
        updatedAt: time,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
const restHousing = VillageStateSchema.properties.village.properties.population.properties.restHousing.items;
export const SYNC_V2_PRIVATE_COMPONENTS = [
  'resources',
  'processingOrders',
  'cohorts',
  'populationSummary',
  'restHousing',
  'buildings',
  'accomplishments',
  'extractionPools',
  'gardenPlots',
  'gardenHarvests',
  'buildingExpansions',
  'extractions',
  'worksites',
  'exploitationOrders',
  'levelingJobs',
  'marketExchanges',
  'tradeOffers',
  'tradeJourneys',
  'scienceActivities',
  'scienceContributions',
  'identity',
  'infrastructure',
  'installation',
  'roadCells',
  'roadAnchors',
] as const;
export const SyncV2IdentitySchema = Type.Object(
  { id, name: Type.String(), anchorCellX: Type.Integer(), anchorCellY: Type.Integer() },
  { additionalProperties: false },
);
/** One entity per building (the journal key): a building contributes to
 * several programs, each its own row server-side. */
export const SyncV2ContributionSchema = Type.Object(
  {
    id,
    programs: Type.Array(
      Type.Object(
        {
          programCode: Type.String(),
          workerCap: Type.Integer(),
          requestedAt: time,
          lastStartedAt: Type.Union([time, Type.Null()]),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
export type SyncV2Contribution = Static<typeof SyncV2ContributionSchema>;
export const SyncV2BuildingSchema = Type.Omit(BuildingSchema, ['garden'], { additionalProperties: false });
const cell = Type.Object(
  { cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
const point = Type.Object({ cellX: Type.Number(), cellY: Type.Number() }, { additionalProperties: false });
export const SyncV2GardenPlotSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[0-9]+,[0-9]+$' }),
    buildingId: id,
    ...cell.properties,
    amount: Type.Integer({ minimum: 0 }),
    capacity: Type.Integer({ minimum: 0 }),
    productionPerHour: Type.Number({ minimum: 0 }),
    productionUpdatedAt: time,
  },
  { additionalProperties: false },
);
export const SyncV2GardenHarvestSchema = Type.Object(
  {
    id,
    buildingId: id,
    workerCount: Type.Integer({ minimum: 1 }),
    startedAt: time,
    completesAt: time,
    reservedCarrots: Type.Integer({ minimum: 0 }),
    transportMs: Type.Integer({ minimum: 0 }),
    plotCellX: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    plotCellY: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    // Team paths follow sub-cell road positions, as in the historical garden.
    path: Type.Array(point),
    returnPath: Type.Array(point),
    stops: Type.Array(GardenHarvestStopSchema),
  },
  { additionalProperties: false },
);
export const SyncV2ExpansionSchema = Type.Object(
  { id, buildingId: id, startedAt: time, completesAt: time, cells: Type.Array(cell) },
  { additionalProperties: false },
);
export const SyncV2StreamSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal('village'),
      Type.Literal('knowledge'),
      Type.Literal('spatial'),
      Type.Literal('offers'),
      Type.Literal('manifest'),
      Type.Literal('traffic'),
    ]),
    key: Type.String({ minLength: 1, maxLength: 128 }),
    epoch: id,
  },
  { additionalProperties: false },
);
export const SyncV2ChangeSchema = Type.Union([
  ...SyncV2SpatialChangeSchema.anyOf,
  ...SyncV2SharedChangeSchema.anyOf,
  Type.Object(
    {
      component: Type.Literal('processingOrders'),
      upsert: Type.Array(ProcessingOrderSchema, { maxItems: 1024 }),
      remove: Type.Array(id, { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('resources'),
      upsert: Type.Array(ResourceStockSchema, { maxItems: 64 }),
      remove: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 64 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('cohorts'),
      upsert: Type.Array(SyncV2CohortSchema, { maxItems: LIVE_ENTITIES }),
      remove: Type.Array(id, { maxItems: LIVE_ENTITIES }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('populationSummary'),
      upsert: Type.Array(SyncV2PopulationSummarySchema, { maxItems: 1 }),
      remove: Type.Array(Type.Literal('*'), { maxItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('restHousing'),
      upsert: Type.Array(restHousing, { maxItems: LIVE_ENTITIES }),
      remove: Type.Array(id, { maxItems: LIVE_ENTITIES }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('buildings'),
      upsert: Type.Array(SyncV2BuildingSchema, { maxItems: LIVE_ENTITIES }),
      remove: Type.Array(id, { maxItems: LIVE_ENTITIES }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('accomplishments'),
      upsert: Type.Array(VillageAccomplishmentSchema, { maxItems: 128 }),
      remove: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 128 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('extractionPools'),
      upsert: Type.Array(ExtractionPoolSchema, { maxItems: 2 }),
      remove: Type.Array(Type.Union([Type.Literal('wood'), Type.Literal('stone')]), { maxItems: 2 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('gardenPlots'),
      upsert: Type.Array(SyncV2GardenPlotSchema, { maxItems: LIVE_ENTITIES }),
      remove: Type.Array(Type.String({ pattern: '^[0-9]+,[0-9]+$' }), { maxItems: LIVE_ENTITIES }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('gardenHarvests'),
      upsert: Type.Array(SyncV2GardenHarvestSchema, { maxItems: 1024 }),
      remove: Type.Array(id, { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('buildingExpansions'),
      upsert: Type.Array(SyncV2ExpansionSchema, { maxItems: 1024 }),
      remove: Type.Array(id, { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('extractions'),
      upsert: Type.Array(ExtractionSchema, { maxItems: 1024 }),
      remove: Type.Array(id, { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('worksites'),
      upsert: Type.Array(ExtractionWorksiteSchema, { maxItems: 1024 }),
      remove: Type.Array(id, { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('exploitationOrders'),
      upsert: Type.Array(ExploitationOrderSchema, { maxItems: 1024 }),
      remove: Type.Array(id, { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('levelingJobs'),
      upsert: Type.Array(LevelingJobSchema, { maxItems: 1024 }),
      remove: Type.Array(id, { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('marketExchanges'),
      upsert: Type.Array(MarketExchangeSchema, { maxItems: 1024 }),
      remove: Type.Array(id, { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('tradeOffers'),
      upsert: Type.Array(TradeOfferSchema, { maxItems: 1024 }),
      remove: Type.Array(id, { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('tradeJourneys'),
      upsert: Type.Array(MarketJourneySchema, { maxItems: 1024 }),
      remove: Type.Array(id, { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('scienceActivities'),
      upsert: Type.Array(ScienceStateSchema.properties.activities.items, { maxItems: 1024 }),
      remove: Type.Array(id, { maxItems: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('scienceContributions'),
      upsert: Type.Array(SyncV2ContributionSchema, { maxItems: LIVE_ENTITIES }),
      remove: Type.Array(id, { maxItems: LIVE_ENTITIES }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('identity'),
      upsert: Type.Array(SyncV2IdentitySchema, { maxItems: 1 }),
      remove: Type.Array(id, { maxItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('infrastructure'),
      upsert: Type.Array(Type.Object({ id: Type.Literal('*'), plan: InfrastructurePlanSchema }), { maxItems: 1 }),
      remove: Type.Array(Type.Literal('*'), { maxItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('installation'),
      upsert: Type.Array(Type.Object({ id: Type.Literal('*'), ...StarterInstallationSchema.properties }), {
        maxItems: 1,
      }),
      remove: Type.Array(Type.Literal('*'), { maxItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('roadCells'),
      upsert: Type.Array(RoadCellSchema, { maxItems: LIVE_ENTITIES }),
      remove: Type.Array(Type.String({ pattern: '^[0-9]+,[0-9]+$' }), { maxItems: LIVE_ENTITIES }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      component: Type.Literal('roadAnchors'),
      upsert: Type.Array(RoadAnchorSchema, { maxItems: LIVE_ENTITIES }),
      remove: Type.Array(Type.String({ pattern: '^[0-9]+,[0-9]+$' }), { maxItems: LIVE_ENTITIES }),
    },
    { additionalProperties: false },
  ),
]);
const group = { stream: SyncV2StreamSchema, changes: Type.Array(SyncV2ChangeSchema, { maxItems: 32 }) };
export const SyncV2BatchSchema = Type.Object(
  {
    protocol: Type.Literal(2),
    worldId: id,
    villageId: id,
    generation: Type.Integer({ minimum: 0 }),
    observedAt: time,
    coverage: Type.Union([Type.Literal('effects'), Type.Literal('delta'), Type.Literal('scope-snapshot')]),
    groups: Type.Array(
      Type.Object({ ...group, fromRevision: revision, toRevision: revision }, { additionalProperties: false }),
      { minItems: 1, maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
export type SyncV2Batch = Static<typeof SyncV2BatchSchema>;
export const ProcessingConfirmationV2Schema = Type.Object(
  {
    protocol: Type.Literal(2),
    worldId: id,
    villageId: id,
    commandId: id,
    status: Type.Literal('applied'),
    commandTime: Type.Union([time, Type.Null()]),
    result: Type.Object({ orderId: Type.Union([id, Type.Null()]) }, { additionalProperties: false }),
    effects: Type.Optional(SyncV2BatchSchema),
  },
  { additionalProperties: false },
);
export type ProcessingConfirmationV2 = Static<typeof ProcessingConfirmationV2Schema>;
/** Building placement: same envelope as the workshop. A replay carries the
 * original result without effects; the presentation is reread by the client
 * because the new footprint is a structural change. */
export const ConstructionConfirmationV2Schema = Type.Object(
  {
    protocol: Type.Literal(2),
    worldId: id,
    villageId: id,
    commandId: id,
    status: Type.Literal('applied'),
    // Null only when a replayed garden has merged into another logical one.
    commandTime: time,
    result: Type.Object({ buildingId: Type.Union([id, Type.Null()]) }, { additionalProperties: false }),
    effects: Type.Optional(SyncV2BatchSchema),
  },
  { additionalProperties: false },
);
export type ConstructionConfirmationV2 = Static<typeof ConstructionConfirmationV2Schema>;
/** A village gesture with no domain result (science, discoveries): the same
 * envelope, the private effects of the commit and nothing else. A retried
 * naturally idempotent gesture applies nothing and carries no effects. */
export const VillageCommandConfirmationV2Schema = Type.Object(
  {
    protocol: Type.Literal(2),
    worldId: id,
    villageId: id,
    commandId: id,
    status: Type.Literal('applied'),
    commandTime: time,
    effects: Type.Optional(SyncV2BatchSchema),
  },
  { additionalProperties: false },
);
export type VillageCommandConfirmationV2 = Static<typeof VillageCommandConfirmationV2Schema>;
/** Road cells gesture (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §4.2):
 * compact receipt (counts, stone debited) and the private effects. A replay
 * returns the original result and instant, without effects. */
export const RoadCellsConfirmationV2Schema = Type.Object(
  {
    protocol: Type.Literal(2),
    worldId: id,
    villageId: id,
    commandId: id,
    status: Type.Literal('applied'),
    commandTime: time,
    result: RoadCellsResultSchema,
    effects: Type.Optional(SyncV2BatchSchema),
  },
  { additionalProperties: false },
);
export type RoadCellsConfirmationV2 = Static<typeof RoadCellsConfirmationV2Schema>;
/** Road anchors gesture (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §5.1):
 * compact receipt (counts, stone and wood debited) and the private effects
 * (`roadAnchors`, `resources`). A replay returns the original result and
 * instant, without effects. */
export const RoadAnchorsConfirmationV2Schema = Type.Object(
  {
    protocol: Type.Literal(2),
    worldId: id,
    villageId: id,
    commandId: id,
    status: Type.Literal('applied'),
    commandTime: time,
    result: RoadAnchorsResultSchema,
    effects: Type.Optional(SyncV2BatchSchema),
  },
  { additionalProperties: false },
);
export type RoadAnchorsConfirmationV2 = Static<typeof RoadAnchorsConfirmationV2Schema>;
export const villageCommandConfirmationV2IsValid = (value: unknown): value is VillageCommandConfirmationV2 =>
  Value.Check(VillageCommandConfirmationV2Schema, value);
export const constructionConfirmationV2IsValid = (value: unknown): value is ConstructionConfirmationV2 =>
  Value.Check(ConstructionConfirmationV2Schema, value);
export const syncV2BatchIsValid = (value: unknown): value is SyncV2Batch => Value.Check(SyncV2BatchSchema, value);
export const processingConfirmationV2IsValid = (value: unknown): value is ProcessingConfirmationV2 =>
  Value.Check(ProcessingConfirmationV2Schema, value);
export const processingCommandIsValid = (value: unknown): value is ProcessingCommand =>
  Value.Check(ProcessingCommandSchema, value);
export type SyncV2Change = Static<typeof SyncV2ChangeSchema>;
/** Most entities a single change of each component may carry: the bound of
 * its schema above, shared by the server's snapshot pages. */
export const SYNC_V2_COMPONENT_LIMITS: Readonly<Record<string, number>> = Object.fromEntries(
  (
    SyncV2ChangeSchema.anyOf as unknown as Array<{
      properties: { component: { const: string }; upsert: { maxItems: number } };
    }>
  ).map((branch) => [branch.properties.component.const, branch.properties.upsert.maxItems]),
);
/** Paged private snapshots (docs/DESIGN-PAGINATION-SNAPSHOT-V2.md). A client
 * opts in with this header; without it a snapshot is complete or refused. */
export const SYNC_V2_PAGES_HEADER = 'x-arbestra-sync-pages';
export const SYNC_V2_SNAPSHOT_PAGE_REFERENCES = 4096;
export const SYNC_V2_SNAPSHOT_MAX_PAGES = 64;
const pageCursor = Type.String({ pattern: '^[A-Za-z0-9_-]{1,1024}$' });
const scope = Type.Omit(SyncV2StreamSchema, ['epoch']);
export const SyncV2ReadRequestSchema = Type.Object(
  {
    protocol: Type.Literal(2),
    generation: Type.Integer({ minimum: 0 }),
    scopes: Type.Array(scope, { maxItems: 64 }),
    cursors: Type.Array(Type.Object({ ...SyncV2StreamSchema.properties, revision }, { additionalProperties: false }), {
      maxItems: 64,
    }),
    /** Next page of a paged private snapshot, with the opaque cursor the
     * previous page returned. Only the private scope is read. */
    page: Type.Optional(Type.Object({ after: pageCursor }, { additionalProperties: false })),
  },
  { additionalProperties: false },
);
export type SyncV2ReadRequest = Static<typeof SyncV2ReadRequestSchema>;
/** One page of a private snapshot too large for a single batch. The first
 * page also carries every other requested scope, complete; each page is its
 * own capture. Never applied alone: see applySyncV2SnapshotPages. */
export const SyncV2SnapshotPageSchema = Type.Object(
  {
    protocol: Type.Literal(2),
    worldId: id,
    villageId: id,
    generation: Type.Integer({ minimum: 0 }),
    observedAt: time,
    coverage: Type.Literal('scope-snapshot-page'),
    next: Type.Union([pageCursor, Type.Null()]),
    groups: Type.Array(
      Type.Object({ ...group, fromRevision: revision, toRevision: revision }, { additionalProperties: false }),
      { minItems: 1, maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
export type SyncV2SnapshotPage = Static<typeof SyncV2SnapshotPageSchema>;
export const syncV2SnapshotPageIsValid = (value: unknown): value is SyncV2SnapshotPage =>
  Value.Check(SyncV2SnapshotPageSchema, value);
type Entity = SyncV2Change['upsert'][number];
type Versioned = { revision: string; value: Entity | null };
export interface SyncV2Scope {
  epoch: string;
  revision: string;
  base: ReadonlyMap<string, Entity>;
  effects: ReadonlyMap<string, Versioned>;
}
export interface SyncV2State {
  worldId: string;
  villageId: string;
  generation: number;
  scopes: ReadonlyMap<string, SyncV2Scope>;
  subscribedScopes?: ReadonlySet<string>;
}
const streamKey = (stream: SyncV2Batch['groups'][number]['stream']) => `${stream.kind}:${stream.key}`;
const entityKey = (component: SyncV2Change['component'], entity: Entity) =>
  `${component}:${
    component === 'resources' || component === 'accomplishments'
      ? (entity as { code: string }).code
      : component === 'extractionPools'
        ? (entity as { resource: string }).resource
        : component === 'restHousing'
          ? (entity as { buildingId: string }).buildingId
          : (entity as { id: string }).id
  }`;
const compare = (a: string, b: string) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
const MAX_REVISION = 9223372036854775807n;
const registryOf = (kind: SyncV2Batch['groups'][number]['stream']['kind']): readonly string[] =>
  kind === 'village'
    ? SYNC_V2_PRIVATE_COMPONENTS
    : kind === 'spatial'
      ? SYNC_V2_SPATIAL_COMPONENTS
      : kind === 'knowledge'
        ? SYNC_V2_KNOWLEDGE_COMPONENTS
        : kind === 'manifest'
          ? SYNC_V2_MANIFEST_COMPONENTS
          : kind === 'offers'
            ? SYNC_V2_OFFER_COMPONENTS
            : kind === 'traffic'
              ? SYNC_V2_TRAFFIC_COMPONENTS
              : [];

/** Validate every group before replacing anything. ACKs overlay keys; only a
 * complete delta/snapshot can advance a stream's canonical applied cursor. */
export function applySyncV2Batch(
  state: SyncV2State,
  input: unknown,
): { kind: 'applied'; state: SyncV2State } | { kind: 'ignored' | 'resync'; state: SyncV2State } {
  if (!Value.Check(SyncV2BatchSchema, input)) return { kind: 'resync', state };
  if (input.worldId !== state.worldId || input.villageId !== state.villageId || input.generation !== state.generation)
    return { kind: 'ignored', state };
  const positions = input.groups.map((group) => ({ group, previous: state.scopes.get(streamKey(group.stream)) }));
  if (
    positions.some(
      ({ group, previous }) =>
        previous?.epoch === group.stream.epoch && compare(previous.revision, group.toRevision) > 0,
    ) &&
    positions.some(({ group, previous }) => !previous || compare(previous.revision, group.toRevision) < 0)
  )
    return { kind: 'resync', state };
  const scopes = new Map(state.scopes),
    seen = new Set<string>();
  let changed = false;
  for (const group of input.groups) {
    if (BigInt(group.fromRevision) > MAX_REVISION || BigInt(group.toRevision) > MAX_REVISION)
      return { kind: 'resync', state };
    // Covered/stale groups still have to be valid. Otherwise a malformed
    // companion could be silently skipped while another group is published.
    const validatedKeys = new Set<string>();
    for (const change of group.changes) {
      for (const key of [
        ...change.upsert.map((entity) => entityKey(change.component, entity)),
        ...change.remove.map((id) => `${change.component}:${id}`),
      ]) {
        if (validatedKeys.has(key)) return { kind: 'resync', state };
        validatedKeys.add(key);
      }
    }
    const registry = registryOf(group.stream.kind);
    if (
      !registry.length ||
      (group.stream.kind === 'village'
        ? group.stream.key !== state.villageId
        : !state.subscribedScopes?.has(streamKey(group.stream)))
    )
      return { kind: 'resync', state };
    if (group.changes.some((change) => !registry.includes(change.component))) return { kind: 'resync', state };
    if (
      input.coverage === 'scope-snapshot' &&
      (group.changes.length !== registry.length ||
        new Set(group.changes.map((change) => change.component)).size !== registry.length)
    )
      return { kind: 'resync', state };
    const key = streamKey(group.stream);
    if (seen.has(key) || compare(group.fromRevision, group.toRevision) > 0) return { kind: 'resync', state };
    seen.add(key);
    const previous = scopes.get(key);
    // Epoch replacement is an explicit recovery in a new subscription
    // generation. An old snapshot from a previous epoch cannot roll it back.
    if (previous && previous.epoch !== group.stream.epoch) return { kind: 'resync', state };
    if (input.coverage !== 'scope-snapshot' && (!previous || previous.epoch !== group.stream.epoch))
      return { kind: 'resync', state };
    if (previous?.epoch === group.stream.epoch && compare(group.toRevision, previous.revision) < 0) continue;
    if (input.coverage === 'delta' && previous && compare(group.toRevision, previous.revision) <= 0) continue;
    if (input.coverage === 'delta' && previous?.revision !== group.fromRevision) return { kind: 'resync', state };
    const base = new Map(input.coverage === 'scope-snapshot' ? [] : previous?.base);
    const effects = new Map(previous?.epoch === group.stream.epoch ? previous.effects : []);
    const touched = new Set<string>();
    for (const change of group.changes) {
      const mutations: Array<[string, Entity | null]> = [
        ...change.upsert.map((entity) => [entityKey(change.component, entity), entity] as [string, Entity]),
        ...change.remove.map((id) => [`${change.component}:${id}`, null] as [string, null]),
      ];
      for (const [entity, value] of mutations) {
        if (touched.has(entity)) return { kind: 'resync', state };
        touched.add(entity);
        if (input.coverage === 'effects') {
          if (previous && compare(group.toRevision, previous.revision) <= 0) continue;
          const confirmed = effects.get(entity);
          if (!confirmed || compare(group.toRevision, confirmed.revision) > 0) {
            effects.set(entity, { revision: group.toRevision, value });
            changed = true;
          }
        } else if (value === null) base.delete(entity);
        else base.set(entity, value);
      }
    }
    const cursor = input.coverage === 'effects' ? previous!.revision : group.toRevision;
    if (input.coverage !== 'effects') changed = true;
    for (const [entity, effect] of effects) if (compare(effect.revision, cursor) <= 0) effects.delete(entity);
    scopes.set(key, { epoch: group.stream.epoch, revision: cursor, base, effects });
  }
  if (!changed) return { kind: 'ignored', state };
  return { kind: 'applied', state: { ...state, scopes } };
}

/** A paged snapshot, published as one state (docs/DESIGN-PAGINATION-SNAPSHOT-V2.md).
 * Each page is its own capture: entities of a later page may be newer than
 * the first page's revisions (the anchor). The pages are assembled at that
 * anchor, then `delta` (anchor → now, one capture of every stream) brings
 * every entity to a single version before anything replaces `state`.
 * `restart`: the pages or the delta do not form one snapshot, read again
 * from the first page. `resync`: a coherent snapshot this subscription
 * generation cannot accept (replaced epoch, older revision). */
export function applySyncV2SnapshotPages(
  state: SyncV2State,
  pages: readonly unknown[],
  delta: unknown,
): { kind: 'applied'; state: SyncV2State } | { kind: 'restart' | 'resync'; state: SyncV2State } {
  const restart = { kind: 'restart' as const, state };
  if (!pages.length || pages.length > SYNC_V2_SNAPSHOT_MAX_PAGES) return restart;
  const village = `village:${state.villageId}`;
  const assembled = new Map<string, { epoch: string; revision: string; base: Map<string, Entity> }>();
  for (const [index, page] of pages.entries()) {
    if (!Value.Check(SyncV2SnapshotPageSchema, page)) return restart;
    if (page.worldId !== state.worldId || page.villageId !== state.villageId || page.generation !== state.generation)
      return restart;
    // Only the last page ends the chain.
    if ((page.next === null) !== (index === pages.length - 1)) return restart;
    const streams = new Set<string>();
    for (const group of page.groups) {
      const key = streamKey(group.stream);
      const registry = registryOf(group.stream.kind);
      if (
        streams.has(key) ||
        !registry.length ||
        (group.stream.kind === 'village' ? key !== village : !state.subscribedScopes?.has(key)) ||
        group.fromRevision !== '0' ||
        BigInt(group.toRevision) > MAX_REVISION
      )
        return restart;
      streams.add(key);
      const components = new Set(group.changes.map((change) => change.component));
      // A snapshot page carries values, never tombstones.
      if (
        components.size !== group.changes.length ||
        group.changes.some((change) => !registry.includes(change.component) || change.remove.length)
      )
        return restart;
      if (index === 0) {
        // The first page lists the whole registry, like a complete snapshot.
        if (components.size !== registry.length) return restart;
        assembled.set(key, { epoch: group.stream.epoch, revision: group.toRevision, base: new Map() });
      } else {
        // Later pages continue the private stream only, in the anchor's epoch.
        const anchor = assembled.get(key);
        if (
          key !== village ||
          !anchor ||
          anchor.epoch !== group.stream.epoch ||
          compare(group.toRevision, anchor.revision) < 0
        )
          return restart;
      }
      const base = assembled.get(key)!.base;
      for (const change of group.changes)
        for (const entity of change.upsert) {
          const entry = entityKey(change.component, entity);
          if (base.has(entry)) return restart;
          base.set(entry, entity);
        }
    }
    if (index === 0 && !streams.has(village)) return restart;
  }
  // The catch-up delta starts at every anchor, in one capture.
  if (
    !Value.Check(SyncV2BatchSchema, delta) ||
    delta.coverage !== 'delta' ||
    delta.worldId !== state.worldId ||
    delta.villageId !== state.villageId ||
    delta.generation !== state.generation ||
    delta.groups.length !== assembled.size
  )
    return restart;
  for (const group of delta.groups) {
    const anchor = assembled.get(streamKey(group.stream));
    if (!anchor || anchor.epoch !== group.stream.epoch || group.fromRevision !== anchor.revision) return restart;
  }
  const provisional: SyncV2State = {
    ...state,
    scopes: new Map(
      [...assembled].map(([key, scope]) => [
        key,
        { epoch: scope.epoch, revision: scope.revision, base: scope.base, effects: new Map() },
      ]),
    ),
  };
  const caught = applySyncV2Batch(provisional, delta);
  if (caught.kind === 'resync') return restart;
  // Replace like a scope snapshot: newer confirmations stay overlaid.
  const scopes = new Map(state.scopes);
  for (const [key, scope] of caught.state.scopes) {
    const previous = state.scopes.get(key);
    if (previous && (previous.epoch !== scope.epoch || compare(previous.revision, scope.revision) > 0))
      return { kind: 'resync', state };
    const effects = new Map<string, Versioned>();
    for (const [entity, effect] of previous?.effects ?? [])
      if (compare(effect.revision, scope.revision) > 0) effects.set(entity, effect);
    scopes.set(key, { epoch: scope.epoch, revision: scope.revision, base: scope.base, effects });
  }
  return { kind: 'applied', state: { ...state, scopes } };
}

export function visibleSyncV2Scope(scope: SyncV2Scope): ReadonlyMap<string, Entity> {
  const values = new Map(scope.base);
  for (const [key, effect] of scope.effects) {
    if (effect.value === null) values.delete(key);
    else values.set(key, effect.value);
  }
  return values;
}
