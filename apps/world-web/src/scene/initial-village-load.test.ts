import {expect, it} from 'vitest';
import {InitialVillageLoad, type InitialLoadEvidence} from './initial-village-load';

const complete = (): InitialLoadEvidence => ({ground: {completed: 4, total: 4}, detailsPending: 0, terrainFailed: false,
  buildingsPending: false, buildingsFailed: false, routesPrepared: true, rendered: true});
it('keeps the village covered until real terrain, buildings, roads and a frame are available', () => {
  const load = new InitialVillageLoad();
  for (const evidence of [ {...complete(), ground: {completed: 0, total: 0}}, {...complete(), ground: {completed: 3, total: 4}},
    {...complete(), detailsPending: 1}, {...complete(), buildingsPending: true}, {...complete(), routesPrepared: false},
    {...complete(), rendered: false}, {...complete(), terrainFailed: true}, {...complete(), buildingsFailed: true}]) {
    expect(load.observe(evidence).phase).not.toBe('ready'); expect(load.ready).toBe(false);
  }
  expect(load.observe(complete()).phase).toBe('ready'); expect(load.ready).toBe(true);
  // Later streaming or a network interruption must not cover an already playable village again.
  expect(load.observe({...complete(), ground: {completed: 0, total: 20}, terrainFailed: true}).phase).toBe('ready');
});
it('recovers after a failed load and starts closed for a new scene', () => {
  const load = new InitialVillageLoad();
  expect(load.observe({...complete(), terrainFailed: true}).error).toBeTruthy();
  expect(load.observe(complete()).error).toBeNull(); expect(load.ready).toBe(true);
  expect(new InitialVillageLoad().ready).toBe(false);
});
