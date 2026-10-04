import { expect, it } from 'vitest';
import { WorldModeNavigation } from './world-mode';

it('restores the village mode after both regional and world navigation', () => {
  const navigation = new WorldModeNavigation();
  navigation.choose('exploitation');
  expect(navigation.changeView('region')).toBe('exploration');
  expect(navigation.changeView('world')).toBe('exploration');
  navigation.changeView('region');
  expect(navigation.changeView('village')).toBe('exploitation');
});
it('gives an explicit village destination priority over the remembered mode', () => {
  const navigation = new WorldModeNavigation(); navigation.choose('construction'); navigation.changeView('region');
  expect(navigation.choose('population')).toBe(true);
  expect(navigation.mode).toBe('exploration');
  navigation.changeView('world');
  expect(navigation.changeView('village')).toBe('population');
});
it('can cancel a pending destination by explicitly choosing exploration', () => {
  const navigation = new WorldModeNavigation(); navigation.changeView('world'); navigation.choose('population');
  expect(navigation.choose('exploration')).toBe(false);
  expect(navigation.changeView('village')).toBe('exploration');
});
