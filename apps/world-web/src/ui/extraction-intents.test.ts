import { expect, it } from 'vitest';
import { ExtractionIntents } from './extraction-intents';

it('keeps a lost-response retry on its deposit without redirecting another deposit command', () => {
  const intents = new ExtractionIntents();
  const first = intents.begin('stone-a', 7);
  const other = intents.begin('stone-b', 3);
  expect(other).toMatchObject({ featureId: 'stone-b', workerCount: 3 });
  expect(other.id).not.toBe(first.id);
  expect(intents.begin('stone-a', 1)).toEqual(first);
  intents.complete('stone-b');
  expect(intents.get('stone-a')).toEqual(first);
  intents.complete('stone-a');
  const next = intents.begin('stone-a', 2);
  expect(next.workerCount).toBe(2);
  expect(next.id).not.toBe(first.id);
});
