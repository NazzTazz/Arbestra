import { expect, it } from 'vitest';
import { villageStateFromSyncV2 } from './sync-v2-village-state.js';
import type { SyncV2Scope, SyncV2State } from './sync-v2.js';
import type { ResolvedVillagePresentation } from './village-presentation.js';

const worldId = '11111111-1111-4111-8111-111111111111', villageId = '22222222-2222-4222-8222-222222222222';
const scope = (entries: Array<[string, unknown]>): SyncV2Scope =>
  ({ epoch: worldId, revision: '1', base: new Map(entries) as SyncV2Scope['base'], effects: new Map() });
const at = (minute: number) => new Date(Date.UTC(2026, 9, 22, 12, minute)).toISOString();
const worksite = (index: number) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, resourceCode: 'wood', mode: 'cut',
  status: 'completed', workerCap: 1, deliveredAmount: 0, waitReason: null, nextWakeAt: null, createdAt: at(index), targets: [], activeExtraction: null });

it('shows the 32 most recent worksites, as the historical snapshot', () => {
  const sync: SyncV2State = { worldId, villageId, generation: 1, scopes: new Map([
    [`village:${villageId}`, scope([
      [`identity:${villageId}`, { id: villageId, name: 'Fixture', anchorCellX: 0, anchorCellY: 0 }],
      ['populationSummary:*', { id: '*', total: 0 }],
      ['resources:wood', { code: 'wood', amount: 0, productionPerHour: 0, productionUpdatedAt: at(0) }],
      ['resources:carrot', { code: 'carrot', amount: 0, productionPerHour: 0, productionUpdatedAt: null }],
      ...Array.from({ length: 33 }, (_, index) => [`worksites:${worksite(index).id}`, worksite(index)] as [string, unknown]),
    ])],
    ['knowledge:account', scope([['knowledgeScience:*', { id: '*', state: {} }]])],
    [`manifest:${worldId}`, scope([['gameManifest:*', { id: '*', world: { widthCells: 64, heightCells: 64 }, buildingTypes: [], factoryEnabled: false }]])],
  ]) };
  const presentation = { protocol: 2, worldId, villageId, version: '0'.repeat(64), observedAt: at(40), cells: [], travelRoutes: [],
    region: {}, market: { unlocked: false, deliveryMs: 0, commissionPercent: 30, resources: [] } } as unknown as ResolvedVillagePresentation;
  const worksites = villageStateFromSyncV2(sync, presentation, at(40))!.village.worksites;
  expect(worksites).toHaveLength(32);
  expect(worksites[0]!.createdAt).toBe(at(32));
  expect(worksites.some(row => row.createdAt === at(0))).toBe(false);
});
