import { Type } from '@sinclair/typebox';
import { ScienceStateSchema } from './science.js';
import { VillageStateSchema } from './villages.js';

const singleton = Type.Literal('*');
const cell = Type.Object({ cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
// Known places are not part of this projection: no screen displays them and
// a visited village holds thousands (535 of 546 KB of a former bootstrap).
// Their journal references are skipped; a paginated read can expose them.
export const SYNC_V2_KNOWLEDGE_COMPONENTS = ['knowledgeScience', 'knowledgeCoverage'] as const;
export const SYNC_V2_MANIFEST_COMPONENTS = ['gameManifest'] as const;
export const SYNC_V2_OFFER_COMPONENTS = ['offerIndex'] as const;
/** Public world traffic: observable convoys of every village. */
export const SYNC_V2_TRAFFIC_COMPONENTS = ['convoys'] as const;
// Presence, route and timing are observable; offers and cargo are private
// and must never be added here.
export const SyncV2PublicConvoySchema = Type.Object({ id: Type.String({ format: 'uuid' }),
  villageId: Type.String({ format: 'uuid' }), destinationVillageId: Type.String({ format: 'uuid' }),
  workerCount: Type.Integer({ minimum: 1 }), path: Type.Array(Type.Object({ cellX: Type.Number(), cellY: Type.Number() }, { additionalProperties: false })),
  startedAt: Type.String({ format: 'date-time' }), arrivesAt: Type.String({ format: 'date-time' }), returnsAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false });
export const SyncV2SharedChangeSchema = Type.Union([
  Type.Object({ component: Type.Literal('convoys'), upsert: Type.Array(SyncV2PublicConvoySchema, { maxItems: 1024 }),
    remove: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 1024 }) }, { additionalProperties: false }),
  Type.Object({ component: Type.Literal('knowledgeScience'), upsert: Type.Array(Type.Object({ id: singleton, state: ScienceStateSchema }), { maxItems: 1 }), remove: Type.Array(singleton, { maxItems: 1 }) }, { additionalProperties: false }),
  Type.Object({ component: Type.Literal('knowledgeCoverage'), upsert: Type.Array(Type.Object({ id: singleton,
    anchors: Type.Array(cell, { maxItems: 1024 }), footprints: Type.Array(cell, { maxItems: 65536 }),
  }, { additionalProperties: false }), { maxItems: 1 }), remove: Type.Array(singleton, { maxItems: 1 }) }, { additionalProperties: false }),
  Type.Object({ component: Type.Literal('gameManifest'), upsert: Type.Array(Type.Object({ id: singleton,
    world: VillageStateSchema.properties.world, terrainModel: Type.Union([Type.Literal('terraces'), Type.Literal('vertices')]),
    buildingTypes: VillageStateSchema.properties.buildingTypes,
    resources: Type.Array(Type.Object({ code: Type.String(), displayName: Type.String(), iconKey: Type.String(),
      valueUnits: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]) }, { additionalProperties: false })),
    terrainTypes: Type.Array(Type.Object({ code: Type.Integer(), slug: Type.String(), buildable: Type.Boolean() }, { additionalProperties: false })),
    featureTypes: Type.Array(Type.Object({ code: Type.String(), blocksConstruction: Type.Boolean() }, { additionalProperties: false })),
    factoryEnabled: Type.Boolean(), sourceChecksum: Type.Union([Type.String(), Type.Null()]),
    presentation: Type.Union([Type.Object({ title: Type.String(), slogan: Type.String() }, { additionalProperties: false }), Type.Null()]),
  }, { additionalProperties: false }), { maxItems: 1 }), remove: Type.Array(singleton, { maxItems: 1 }) }, { additionalProperties: false }),
  // This stream versions the paginated query index. It deliberately carries
  // no offer page, so advancing it cannot imply that page contents arrived.
  Type.Object({ component: Type.Literal('offerIndex'), upsert: Type.Array(Type.Object({ id: singleton,
    invalidate: Type.Literal('offer-pages'),
  }, { additionalProperties: false }), { maxItems: 1 }), remove: Type.Array(singleton, { maxItems: 1 }) }, { additionalProperties: false }),
]);
