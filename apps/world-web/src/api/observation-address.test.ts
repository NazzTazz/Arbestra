import { expect, it } from 'vitest';
import { observationAddress } from './observation-address';
it('keeps the village route and removes the launch credential from the address', () => {
  const result = observationAddress(
    'https://alpha.arbestra.world/village?world=rc1&observe=lease#observationToken=secret&section=journal',
  );
  expect(result.leaseId).toBe('lease');
  expect(result.token).toBe('secret');
  expect(result.cleanHref).toBe('https://alpha.arbestra.world/village?world=rc1&observe=lease#section=journal');
  expect(observationAddress(result.cleanHref).token).toBeNull();
});
