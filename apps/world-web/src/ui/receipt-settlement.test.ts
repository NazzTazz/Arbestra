import { expect, it } from 'vitest';
import type { ExpeditionIntent, HarvestReceipt } from '@arbestra/contracts';
import { lostGestures, settledGestures } from './use-harvest-tool';
import { unsentIntents } from './use-expeditions';

const gesture = (n: number, submitted = false) => ({
  intent: { commandId: `0000000${n}-0000-4000-8000-000000000000` },
  submitted,
});
const receipt = (n: number, pending = false): HarvestReceipt => ({
  commandId: `0000000${n}-0000-4000-8000-000000000000`,
  ...(pending ? { pending: true } : {}),
  accepted: pending ? [] : [{ key: 'garden:1:2', cellX: 1, cellY: 2, resource: 'carrot', amount: 5 }],
  refused: [],
});

it('settles the queued gestures whose final receipt the stream delivered, and only those', () => {
  const queue = [gesture(1, true), gesture(2, true), gesture(3)];
  const settled = settledGestures(queue, [receipt(2), receipt(1, true), receipt(9)]);
  // 2 is final; 1 is still pending at the worker; 9 is not ours (an older gesture); 3 was not sent.
  expect(settled).toEqual([{ item: queue[1], receipt: receipt(2) }]);
  expect(settledGestures(queue, [])).toEqual([]);
  // A gesture still in flight is settled too: the stream may beat the HTTP answer.
  expect(settledGestures(queue, [receipt(3)]).map(({ item }) => item)).toEqual([queue[2]]);
});

it('asks again only for the gestures sent that the stream does not list', () => {
  const queue = [gesture(1, true), gesture(2, true), gesture(3), gesture(4, true)];
  // 1 is listed (pending), 2 is not (a page left asleep past the window), 3 was never sent, 4 is listed.
  expect(lostGestures(queue, [receipt(1, true), receipt(4)])).toEqual([queue[1]]);
  expect(lostGestures(queue, [receipt(1), receipt(2), receipt(4)])).toEqual([]);
  expect(lostGestures([], [])).toEqual([]);
});

it('sends again the uncertain expeditions the stream does not list, never the others', () => {
  const intent = (n: number): ExpeditionIntent => ({
    commandId: `1000000${n}-0000-4000-8000-000000000000`,
    action: 'survey',
    target: { cellX: n, cellY: n },
    budgetSeconds: 600,
  });
  const entries: Array<[string, { intent?: ExpeditionIntent; uncertain?: boolean }]> = [
    [intent(1).commandId, { intent: intent(1), uncertain: true }],
    [intent(2).commandId, { intent: intent(2), uncertain: true }],
    [intent(3).commandId, { intent: intent(3) }],
    [intent(4).commandId, { uncertain: true }],
  ];
  // 2 reached the server; 3 is not uncertain; 4 has no intent to send.
  expect(unsentIntents(entries, [{ commandId: intent(2).commandId }])).toEqual([intent(1)]);
  expect(unsentIntents(entries, [])).toEqual([intent(1), intent(2)]);
});
