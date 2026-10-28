import { expect, it } from 'vitest';
import type { NetworkJob } from '../navigation/network-job.js';
import { networkFingerprint } from './presentation.js';

type Ground = Parameters<typeof networkFingerprint>[1];
const grove = (state: string, blocksCell: boolean, cleared: boolean) => ({
  id: 'grove',
  type: 'woodland',
  cellX: 4,
  cellY: 5,
  deposit: { state, blocksCell, cleared },
});
const input = (feature: ReturnType<typeof grove>, stone = 'available') =>
  ({
    world: { id: 'w', widthCells: 64, heightCells: 64 },
    village: { anchorCellX: 1, anchorCellY: 1 },
    region: {
      originCellX: 0,
      originCellY: 0,
      width: 8,
      height: 8,
      terrainCodes: [],
      features: [
        feature,
        { id: 'rock', type: 'stone_outcrop', cellX: 6, cellY: 6, deposit: { state: stone, blocksCell: true } },
      ],
    },
    cells: [],
  }) as unknown as NetworkJob['state'];
const rc1 = (removed: number[]) =>
  ({ data: { seed: 7 }, navigationEdits: { trees: [{ removed }] } }) as unknown as Ground;

it('ignores a grove crossing its stock threshold on RC1 ground, where only trunks block travel', () => {
  const full = networkFingerprint(input(grove('available', true, false)), rc1([]));
  expect(networkFingerprint(input(grove('available', false, false)), rc1([]))).toBe(full);
  expect(networkFingerprint(input(grove('depleted', false, true)), rc1([]))).toBe(full);
  // Clearing removes trunks: the ground edits change the network.
  expect(networkFingerprint(input(grove('depleted', false, true)), rc1([0, 1]))).not.toBe(full);
  // A stone outcrop still blocks its cell until depleted.
  expect(networkFingerprint(input(grove('available', true, false), 'depleted'), rc1([]))).not.toBe(full);
});

it('keeps the grove threshold in the fingerprint of a pre-RC1 world, where it blocks the cell', () => {
  expect(networkFingerprint(input(grove('available', true, false)), undefined)).not.toBe(
    networkFingerprint(input(grove('available', false, false)), undefined),
  );
});
