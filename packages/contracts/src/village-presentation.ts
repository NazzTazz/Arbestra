import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { BuildingFootprintSchema, VillageStateSchema, type VillageState } from './villages.js';
import { MarketStateSchema } from './market.js';
import type { SyncV2Change } from './sync-v2.js';

const id = Type.String({ format: 'uuid' });
/** Presentation geometry absent from every V2 stream: placement aids, the
 * displayed travel network, the village terrain window and market
 * configuration. It is a separate,
 * versioned read refreshed on invalidation, never per economic change. */
export const VillagePresentationSchema = Type.Object(
  {
    protocol: Type.Literal(2),
    worldId: id,
    villageId: id,
    /** Content digest: equal versions carry identical presentations. */
    version: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    observedAt: Type.String({ format: 'date-time' }),
    // Same presence rule as the historical village cells: buildable or occupied.
    cells: Type.Array(
      Type.Object(
        {
          cellX: Type.Integer({ minimum: 0 }),
          cellY: Type.Integer({ minimum: 0 }),
          canBuild: Type.Boolean(),
          footprint: Type.Union([BuildingFootprintSchema, Type.Null()]),
          // The cell that displays its logical building: a merged garden has one,
          // although every member keeps an anchor role in its footprint.
          displaysBuilding: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
    travelRoutes: VillageStateSchema.properties.travelRoutes,
    // Terrain window around the footprints, with its features and deposits.
    // Spatial chunk subscriptions are the eventual target for this data. Its
    // own digest lets a client that already holds it receive null instead:
    // placing a building changes cells and routes, rarely this window.
    regionVersion: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    region: Type.Union([VillageStateSchema.properties.region, Type.Null()]),
    market: Type.Pick(MarketStateSchema, ['unlocked', 'deliveryMs', 'commissionPercent', 'resources'], {
      additionalProperties: false,
    }),
  },
  { additionalProperties: false },
);
export type VillagePresentation = Static<typeof VillagePresentationSchema>;
/** A presentation whose omitted region was restored from the client's copy. */
export type ResolvedVillagePresentation = VillagePresentation & { region: VillageState['region'] };
export const villagePresentationIsValid = (value: unknown): value is VillagePresentation =>
  Value.Check(VillagePresentationSchema, value);

/** Private-stream components whose change can alter the presentation:
 * footprints (hence the terrain window), construction state and Town Hall
 * level, pending extensions, extractions (woodland paths, deposit amounts),
 * roads and terrain edits. Economic counters
 * (stocks, cohorts, orders, plot yields) never require a new read.
 * Changes made by other villages are not on this stream: a reconnection or
 * resynchronization rereads the presentation as well. */
export const VILLAGE_PRESENTATION_COMPONENTS = [
  'buildings',
  'buildingExpansions',
  'extractions',
  'infrastructure',
  'installation',
  'levelingJobs',
] as const satisfies readonly SyncV2Change['component'][];
