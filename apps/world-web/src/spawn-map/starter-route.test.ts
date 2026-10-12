import { describe, expect, it } from 'vitest';
import { isStarterRoute, villageRoute } from './starter-route';

describe('starter route', () => {
  it('shows placement only for the first spawn or an unfinished starter kit', () => {
    expect(isStarterRoute('/spawn', '?world=rc1')).toBe(true);
    expect(isStarterRoute('/village', '?world=rc1&starter=1')).toBe(true);
    expect(isStarterRoute('/village', '?world=rc1')).toBe(false);
  });

  it('keeps the world while moving a placed town hall to the village route', () => {
    expect(villageRoute('rc1-receipt-123')).toBe('/village?world=rc1-receipt-123');
    expect(villageRoute('rc1-receipt-123', true)).toBe('/village?world=rc1-receipt-123&starter=1');
  });
});
