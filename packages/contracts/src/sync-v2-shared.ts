import { Type } from '@sinclair/typebox';
import { ScienceStateSchema } from './science.js';
import { VillageStateSchema } from './villages.js';

const singleton = Type.Literal('*');
const cell = Type.Object({ cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
const cellKey = Type.String({ pattern: '^[0-9]+,[0-9]+$' });
export const SYNC_V2_KNOWLEDGE_COMPONENTS = ['knowledgeScience', 'knowledgePlaces', 'knowledgeCoverage'] as const;
export const SYNC_V2_MANIFEST_COMPONENTS = ['gameManifest'] as const;
export const SYNC_V2_OFFER_COMPONENTS = ['offerIndex'] as const;
export const SyncV2SharedChangeSchema = Type.Union([
  Type.Object({ component: Type.Literal('knowledgeScience'), upsert: Type.Array(Type.Object({ id: singleton, state: ScienceStateSchema }), { maxItems: 1 }), remove: Type.Array(singleton, { maxItems: 1 }) }, { additionalProperties: false }),
  Type.Object({ component: Type.Literal('knowledgePlaces'), upsert: Type.Array(Type.Object({ id: cellKey, ...cell.properties,
    terrainCode: Type.Integer(), elevation: Type.Number(), surveyed: Type.Boolean(), observedAt: Type.String({ format: 'date-time' }),
  }, { additionalProperties: false }), { maxItems: 65536 }), remove: Type.Array(cellKey, { maxItems: 65536 }) }, { additionalProperties: false }),
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
