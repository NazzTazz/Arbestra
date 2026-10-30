import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { journeySubject, journeyType, observationCommandKind } from './observation-actions.js';
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
    'discover-cat-eyes',
    'starter',
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
it('journals every village mutation of the command inventory and no read', () => {
  const inventory = JSON.parse(readFileSync('tests/fixtures/command-inventory.json', 'utf8')) as Array<{
    method: string;
    url: string;
    role: string;
  }>;
  const village = inventory.filter((row) => row.method === 'POST' && row.url.startsWith(base));
  const mutations = village.filter((row) => row.role === 'mutation');
  expect(mutations.length).toBeGreaterThanOrEqual(18);
  for (const row of village) expect(observationCommandKind(row.url) !== null, row.url).toBe(row.role === 'mutation');
  // Every journal type fits the table's check constraint.
  for (const row of mutations) expect(journeyType(observationCommandKind(row.url)!)).toMatch(/^[a-z][a-z0-9.-]{0,63}$/);
  expect(journeyType('buildings/:buildingId/upgrade')).toBe('buildings.upgrade');
  expect(journeyType('harvest-intents/:commandId/cancel')).toBe('harvest-intents.cancel');
  expect(journeyType('worksites/:worksiteId')).toBe('worksites');
});
it('keeps only allow-listed catalogue codes as subject', () => {
  expect(journeySubject({ buildingType: 'dwelling', anchorCellX: 3, action: 'x' })).toBe('dwelling');
  expect(journeySubject({ action: 'rest', commandId: 'c' })).toBe('rest');
  expect(journeySubject({ action: 'Free text with spaces' })).toBeUndefined();
  expect(journeySubject({ cellX: 1, cellY: 2 })).toBeUndefined();
  expect(journeySubject(undefined)).toBeUndefined();
});
