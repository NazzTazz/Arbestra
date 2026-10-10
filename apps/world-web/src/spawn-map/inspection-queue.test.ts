import { describe, expect, it } from 'vitest';
import { createInspectionQueue, type SpawnInspectionTask } from './inspection-queue';
const task = (sequence: number, channel: SpawnInspectionTask['channel'] = 'disk'): SpawnInspectionTask => ({
  kind: 'inspect', sequence, channel, point: { x: sequence, y: 0 }, turns: 0, requestedAt: sequence,
});
describe('spawn inspection delivery', () => {
  it('coalesces continuous movement, prioritizes a click and discards a late disk', () => {
    const sent: SpawnInspectionTask[] = [], queue = createInspectionQueue(t => sent.push(t));
    queue.request(task(1)); expect(sent).toEqual([]); queue.ready();
    for (let n = 2; n <= 100; n++) queue.request(task(n));
    queue.request(task(1, 'selection'));
    expect(sent.map(t => t.sequence)).toEqual([1]);
    expect(queue.complete('disk', 1)).toBeUndefined();
    expect(sent.at(-1)?.channel).toBe('selection');
    expect(queue.complete('selection', 1)).toEqual(task(1, 'selection'));
    expect(sent.at(-1)).toEqual(task(100));
    expect(queue.complete('disk', 100)).toEqual(task(100));
    expect(sent).toHaveLength(3);
  });
  it('invalidates a running result as soon as movement resumes, before the debounce fires', () => {
    const sent: SpawnInspectionTask[] = [], queue = createInspectionQueue(t => sent.push(t)); queue.ready();
    queue.request(task(1)); queue.cancel('disk');
    expect(queue.complete('disk', 1)).toBeUndefined();
    queue.request(task(2)); expect(sent).toHaveLength(2);
    expect(queue.complete('disk', 1)).toBeUndefined();
    expect(queue.complete('disk', 2)).toEqual(task(2));
  });
});
