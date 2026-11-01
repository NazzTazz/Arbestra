import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RECONNECT_BACKOFF_MS, SpacedRetry, reconnectDelayMs } from './reconnect';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('waits 1, 2, 5, 10, 20 then 30 s, and keeps 30 s after that', () => {
  expect([1, 2, 3, 4, 5, 6, 7, 40].map((failures) => reconnectDelayMs(failures))).toEqual([
    1000, 2000, 5000, 10000, 20000, 30000, 30000, 30000,
  ]);
  expect(RECONNECT_BACKOFF_MS.at(-1)).toBe(30000);
  // A count below the first failure is the first step, never a crash.
  expect(reconnectDelayMs(0)).toBe(1000);
});

it("lets a busy server's Retry-After lengthen a step, never shorten it and never more than double it", () => {
  expect(reconnectDelayMs(3, 0)).toBe(5000);
  expect(reconnectDelayMs(3, 2000)).toBe(5000);
  expect(reconnectDelayMs(3, 7000)).toBe(7000);
  expect(reconnectDelayMs(3, 60000)).toBe(10000);
  expect(reconnectDelayMs(1, 1500)).toBe(1500);
});

it('attempts again after each reported failure at the spaced cadence, until success', async () => {
  const attempt = vi.fn();
  const retry = new SpacedRetry(attempt);
  retry.failed();
  await vi.advanceTimersByTimeAsync(999);
  expect(attempt).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(attempt).toHaveBeenCalledTimes(1);
  // Nothing is scheduled until the attempt itself reports its failure.
  await vi.advanceTimersByTimeAsync(60000);
  expect(attempt).toHaveBeenCalledTimes(1);
  retry.failed();
  await vi.advanceTimersByTimeAsync(1999);
  expect(attempt).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(attempt).toHaveBeenCalledTimes(2);
  expect(retry.failures).toBe(2);
  retry.reset();
  expect(retry.failures).toBe(0);
  retry.failed();
  await vi.advanceTimersByTimeAsync(1000);
  expect(attempt).toHaveBeenCalledTimes(3);
});

it("runs the player's retry at once, drops the scheduled attempt and keeps the cadence growing", async () => {
  const attempt = vi.fn();
  const retry = new SpacedRetry(attempt);
  retry.failed();
  retry.now();
  expect(attempt).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000);
  expect(attempt).toHaveBeenCalledTimes(1);
  retry.failed();
  await vi.advanceTimersByTimeAsync(1999);
  expect(attempt).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(attempt).toHaveBeenCalledTimes(2);
});

it('starts at the capped step when told how many failures already happened', async () => {
  const attempt = vi.fn();
  const retry = new SpacedRetry(attempt, RECONNECT_BACKOFF_MS.length);
  retry.failed();
  await vi.advanceTimersByTimeAsync(29999);
  expect(attempt).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(attempt).toHaveBeenCalledTimes(1);
});

it('schedules nothing once cancelled or stopped', async () => {
  const attempt = vi.fn();
  const retry = new SpacedRetry(attempt);
  retry.failed();
  retry.cancel();
  await vi.advanceTimersByTimeAsync(60000);
  expect(attempt).not.toHaveBeenCalled();
  expect(retry.failures).toBe(1);
  retry.stop();
  retry.failed();
  retry.now();
  await vi.advanceTimersByTimeAsync(60000);
  expect(attempt).not.toHaveBeenCalled();
});
