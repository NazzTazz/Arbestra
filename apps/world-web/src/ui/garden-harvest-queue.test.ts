import { expect, it, vi } from 'vitest';
import { ApiError, type TimedVillageState } from '../api/client';
import { GardenHarvestQueue, type HarvestIntent } from './garden-harvest-queue';

const plot = { worldSlug: 'aube', villageId: 'village', buildingId: 'old-garden', cellX: 4, cellY: 5 };
const snapshot = {} as TimedVillageState;

it('resolves a lost response with the same receipt after fusion, before the next plot', async () => {
  const sent: HarvestIntent[] = [];
  let lost = true;
  const accepted = vi.fn(), warning = vi.fn();
  const queue = new GardenHarvestQueue({ changed: vi.fn(), accepted, warning, send: async (intent) => {
    sent.push({ ...intent });
    if (lost) { lost = false; throw new TypeError('response lost after accepted departure'); }
    return snapshot;
  } });
  queue.enqueue(plot, true);
  queue.enqueue({ ...plot, cellX: 5 }, false);
  await queue.settled();
  expect(sent).toHaveLength(1);
  expect(queue.pending()[0]?.status).toBe('uncertain');
  // A refreshed snapshot may show a different canonical Garden and an active
  // harvest. It must not turn the unresolved intention into a new departure.
  queue.enqueue({ ...plot, buildingId: 'merged-garden' }, true);
  await queue.settled();
  expect(sent.map((item) => item.cellX)).toEqual([4, 4, 5]);
  expect(sent[1]!.commandId).toBe(sent[0]!.commandId);
  expect(sent[1]!.buildingId).toBe('old-garden');
  expect(accepted).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
  expect(queue.pending()).toEqual([]);
});

it('stops unsent plots of the exhausted gesture and allows a later explicit gesture', async () => {
  const send = vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValueOnce(
    new ApiError('Aucun habitant disponible et reposé.', 409, 'HARVESTERS_UNAVAILABLE')).mockResolvedValue(snapshot);
  const warning = vi.fn();
  const queue = new GardenHarvestQueue({ send, accepted: vi.fn(), changed: vi.fn(), warning });
  queue.enqueue(plot, true);
  queue.enqueue({ ...plot, cellX: 5 }, false);
  queue.enqueue({ ...plot, cellX: 6 }, false);
  await queue.settled();
  queue.enqueue({ ...plot, cellX: 7 }, false);
  await queue.settled();
  expect(send.mock.calls.map(([intent]) => intent.cellX)).toEqual([4, 5]);
  expect(queue.pending()).toEqual([]);
  expect(warning).toHaveBeenCalledTimes(1);
  queue.enqueue({ ...plot, cellX: 6 }, true);
  await queue.settled();
  expect(send.mock.calls.map(([intent]) => intent.cellX)).toEqual([4, 5, 6]);
});

it('deduplicates a pending plot and retains an uncertain command across retries', async () => {
  const send = vi.fn().mockRejectedValue(new TypeError('offline'));
  const queue = new GardenHarvestQueue({ send, accepted: vi.fn(), changed: vi.fn(), warning: vi.fn() });
  queue.enqueue(plot, true); queue.enqueue(plot, false);
  await queue.settled();
  const receipt = queue.pending()[0]!.commandId;
  queue.retry(); await queue.settled();
  expect(queue.pending()).toHaveLength(1);
  expect(send.mock.calls.map(([intent]) => intent.commandId)).toEqual([receipt, receipt]);
});
