import { expect, it } from 'vitest';
import { observationCommandKind } from './observation-actions.js';
const base = '/api/worlds/:worldSlug/villages/:villageId/';
it('covers command families without capturing previews, camera publications or reads', () => {
  for (const tail of [
    'buildings',
    'buildings/:buildingId/expansions',
    'buildings/:buildingId/upgrade',
    'buildings/:buildingId/discover-supplies',
    'harvest-intents',
    'harvest-intents/:commandId/cancel',
    'worksites/:worksiteId',
    'extraction-pools',
    'population/gestures',
    'processing',
    'market/trades',
    'science',
    'infrastructure',
    'exploitation',
    'leveling',
    'terraform',
  ])
    expect(observationCommandKind(base + tail), tail).toBe(tail);
  for (const tail of [
    'market/trade-preview',
    'leveling/preview',
    'processing/preview',
    'infrastructure/preview',
    'exploitation/preview',
    'events',
    'observation/camera',
    'observation/sources',
    'science/expeditions',
  ])
    expect(observationCommandKind(base + tail), tail).toBeNull();
  expect(observationCommandKind('/api/admin/session')).toBeNull();
});
