import type { Transaction } from 'kysely';
import type { SyncV2Change } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { scienceSnapshot } from '../science/service.js';
import { catalog } from './service.js';
import type { SyncEntityReference } from './sync-v2-readers.js';
import type { VillageEconomy } from './reconcile-economy.js';
import type { SyncScope } from './sync-v2-journal.js';

export async function readSharedScopeSnapshot(tx: Transaction<Database>, context: VillageEconomy & { accountId: string },
  scope: SyncScope): Promise<SyncV2Change[]> {
  const references: SyncEntityReference[] = scope.kind === 'knowledge'
    ? [{ component: 'knowledgeScience', key: '*' }, { component: 'knowledgeCoverage', key: '*' }]
    : [{ component: scope.kind === 'manifest' ? 'gameManifest' : 'offerIndex', key: '*' }];
  const changes = await readSharedChanges(tx, context, scope, references);
  return changes.map(change => ({ ...change, remove: [] }));
}

export async function readSharedChanges(tx: Transaction<Database>, context: VillageEconomy & { accountId: string },
  scope: SyncScope, references: readonly SyncEntityReference[]): Promise<SyncV2Change[]> {
  const { worldId, villageId, accountId } = context;
  if (scope.kind === 'knowledge' ? scope.key !== accountId : scope.kind === 'manifest' ? scope.key !== worldId
    : scope.kind !== 'offers' || scope.key !== 'all') throw Error('Invalid shared scope');
  // Writers still journal known places (054); they are outside the knowledge
  // projection, so their revisions advance the cursor with no change.
  references = references.filter(reference => reference.component !== 'knowledgePlaces');
  if (!references.length) return [];
  if (references.length > 65538) throw new RangeError('Shared selection too large');
  const selections = new Map<string, Set<string>>();
  const allowed = scope.kind === 'knowledge' ? ['knowledgeScience', 'knowledgeCoverage']
    : scope.kind === 'manifest' ? ['gameManifest'] : ['offerIndex'];
  for (const reference of references) {
    if (!allowed.includes(reference.component)) throw Error('Component outside shared scope');
    const keys = selections.get(reference.component) ?? new Set<string>(); keys.add(reference.key); selections.set(reference.component, keys);
  }
  if (scope.kind === 'knowledge') {
    const owner = await tx.selectFrom('villages').select('ownerAccountId').where('worldId', '=', worldId).where('id', '=', villageId).executeTakeFirst();
    if (owner?.ownerAccountId !== accountId) throw Error('Knowledge owner mismatch');
  }
  const changes: SyncV2Change[] = [];
  for (const [component, keys] of selections) {
    if (keys.size !== 1 || !keys.has('*')) throw Error('Invalid singleton shared key');
    if (component === 'knowledgeScience') changes.push({ component, upsert: [{ id: '*', state: await scienceSnapshot(tx, context, true) }], remove: [] });
    else if (component === 'knowledgeCoverage') {
      const [anchors, footprints] = await Promise.all([
        tx.selectFrom('villages').select(['anchorCellX as cellX', 'anchorCellY as cellY'])
          .where('worldId', '=', worldId).where('ownerAccountId', '=', accountId).orderBy('id').execute(),
        tx.selectFrom('worldCellOccupancies as o').innerJoin('buildings as b', join => join.onRef('b.worldId', '=', 'o.worldId').onRef('b.id', '=', 'o.buildingId'))
          .innerJoin('villages as v', join => join.onRef('v.worldId', '=', 'b.worldId').onRef('v.id', '=', 'b.villageId'))
          .select(['o.cellX', 'o.cellY']).where('o.worldId', '=', worldId).where('v.ownerAccountId', '=', accountId)
          .where('o.pendingExpansionId', 'is', null).where(eb => eb.or([eb('b.status', '=', 'completed'),
            eb.and([eb('b.buildingType', '=', 'town-hall'), eb('b.targetLevel', 'is not', null)])])).orderBy('o.cellX').orderBy('o.cellY').execute(),
      ]);
      if (anchors.length > 1024 || footprints.length > 65536) throw new RangeError('Knowledge coverage requires pagination');
      changes.push({ component, upsert: [{ id: '*', anchors, footprints }], remove: [] });
    } else if (component === 'gameManifest') {
      const [row, buildingTypes, resources, terrainTypes, featureTypes, factory, source, presentation] = await Promise.all([
        tx.selectFrom('worlds').select(['id', 'slug', 'name', 'topology', 'widthCells', 'heightCells', 'chunkSize', 'seed', 'generationVersion', 'terrainModel'])
          .where('id', '=', worldId).executeTakeFirstOrThrow(),
        catalog(tx),
        tx.selectFrom('resourceTypes as r').leftJoin('oracleMarketResources as m', 'm.resourceCode', 'r.code')
          .select(['r.code', 'r.displayName', 'r.iconKey', 'm.valueUnits']).orderBy('r.code').execute(),
        tx.selectFrom('terrainTypes').select(['code', 'slug', 'buildable']).orderBy('code').execute(),
        tx.selectFrom('worldFeatureTypes').select(['code', 'blocksConstruction']).orderBy('code').execute(),
        tx.selectFrom('worldFactorySettings').select('enabled').where('worldId', '=', worldId).executeTakeFirst(),
        tx.selectFrom('worldGenerationCandidates').select('checksum').where('worldId', '=', worldId).executeTakeFirst(),
        tx.selectFrom('worldAtlasPresentations').select(['title', 'slogan']).where('worldId', '=', worldId).executeTakeFirst(),
      ]);
      const { terrainModel, ...world } = row;
      changes.push({ component, upsert: [{ id: '*', world, terrainModel, buildingTypes, resources, terrainTypes, featureTypes,
        factoryEnabled: factory?.enabled ?? false, sourceChecksum: source?.checksum ?? null, presentation: presentation ?? null,
      }], remove: [] });
    } else if (component === 'offerIndex') changes.push({ component, upsert: [{ id: '*', invalidate: 'offer-pages' }], remove: [] });
  }
  return changes;
}
