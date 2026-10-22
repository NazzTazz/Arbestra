import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { BuildingFootprintSchema, VillageStateSchema } from './villages.js';
import { MarketStateSchema } from './market.js';
import type { SyncV2Change } from './sync-v2.js';

const id = Type.String({ format: 'uuid' });
/** Presentation geometry absent from every V2 stream: placement aids, the
 * displayed travel network and market configuration. It is a separate,
 * versioned read refreshed on invalidation, never per economic change. */
export const VillagePresentationSchema = Type.Object({
  protocol: Type.Literal(2), worldId: id, villageId: id,
  /** Content digest: equal versions carry identical presentations. */
  version: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  observedAt: Type.String({ format: 'date-time' }),
  // Same presence rule as the historical village cells: buildable or occupied.
  cells: Type.Array(Type.Object({ cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }),
    canBuild: Type.Boolean(), footprint: Type.Union([BuildingFootprintSchema, Type.Null()]) }, { additionalProperties: false })),
  travelRoutes: VillageStateSchema.properties.travelRoutes,
  market: Type.Pick(MarketStateSchema, ['unlocked', 'deliveryMs', 'commissionPercent', 'resources'], { additionalProperties: false }),
}, { additionalProperties: false });
export type VillagePresentation = Static<typeof VillagePresentationSchema>;
export const villagePresentationIsValid = (value: unknown): value is VillagePresentation => Value.Check(VillagePresentationSchema, value);

/** Private-stream components whose change can alter the presentation:
 * footprints, construction state and Town Hall level, pending extensions,
 * committed woodland paths, roads and terrain edits. Economic counters
 * (stocks, cohorts, orders, plot yields) never require a new read.
 * Changes made by other villages are not on this stream: a reconnection or
 * resynchronization rereads the presentation as well. */
export const VILLAGE_PRESENTATION_COMPONENTS = ['buildings', 'buildingExpansions', 'extractions', 'infrastructure',
  'installation', 'levelingJobs'] as const satisfies readonly SyncV2Change['component'][];
