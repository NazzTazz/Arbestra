import { describe, expect, it } from 'vitest';
import type { HarvestIntent, HarvestReceipt } from '@arbestra/contracts';
import {
  GestureForecasts,
  PlannedTargets,
  forecastGesture,
  reconcileReceipt,
  type ForecastLookup,
  type ReceiptContext,
} from './harvest-forecast';

const WOOD = '11111111-1111-4111-8111-111111111111';
const STONE = '22222222-2222-4222-8222-222222222222';
const intent = (over: Partial<HarvestIntent> = {}): HarvestIntent => ({
  commandId: 'c1',
  gardens: [],
  wood: [],
  stone: [],
  ...over,
});
const lookup = (over: Partial<ForecastLookup> = {}): ForecastLookup => ({
  garden: () => null,
  feature: (id) => ({ cellX: id === WOOD ? 3 : 8, cellY: 4, remaining: id === WOOD ? 1500 : 2000 }),
  tree: () => ({ remaining: 500, queued: null }),
  caseQueued: () => false,
  stoneQueued: () => false,
  planned: new PlannedTargets(),
  ...over,
});
const ctx: ReceiptContext = {
  remainingOf: () => 500,
  cellOfRefusal: (key) => (key.startsWith('garden:') ? { cellX: 1, cellY: 2 } : { cellX: 3, cellY: 4 }),
};
const receipt = (over: Partial<HarvestReceipt> = {}): HarvestReceipt => ({
  commandId: 'c1',
  accepted: [],
  refused: [],
  ...over,
});
const texts = (labels: Array<{ text: string }>) => labels.map((l) => l.text);

describe('forecastGesture', () => {
  it('announces stored carrots per plot, the wood each tree still holds, and the stone of a deposit', () => {
    const forecast = forecastGesture(
      {
        intent: intent({
          gardens: [{ cellX: 1, cellY: 2 }],
          wood: [WOOD],
          woodTrees: [{ featureId: WOOD, treeIndices: [4, 5] }],
          stone: [STONE],
        }),
        trees: [{ featureId: WOOD, cellX: 3, cellY: 4 }],
      },
      lookup({
        garden: () => ({ completed: true, stored: 12.7, harvesting: false }),
        tree: (_id, index) => ({ remaining: index === 4 ? 500 : 300, queued: null }),
      }),
    );
    expect(forecast.labels.map((l) => [l.key, l.text, l.tree?.treeIndex])).toEqual([
      ['garden:1:2', '+12', undefined],
      [WOOD, '+500', 4],
      [WOOD, '+300', 5],
      [STONE, '+2000', undefined],
    ]);
  });

  it('announces « Déjà prévu » for a plot harvested, a tree or deposit queued, or planned by another gesture', () => {
    const planned = new PlannedTargets();
    planned.addIntent(intent({ gardens: [{ cellX: 5, cellY: 5 }] }));
    const forecast = forecastGesture(
      {
        intent: intent({
          gardens: [
            { cellX: 1, cellY: 2 },
            { cellX: 5, cellY: 5 },
          ],
          wood: [WOOD],
          woodTrees: [{ featureId: WOOD, treeIndices: [4, 5] }],
          stone: [STONE],
        }),
      },
      lookup({
        garden: (cell) => ({ completed: true, stored: 9, harvesting: cell.cellX === 1 }),
        tree: (_id, index) => ({ remaining: 500, queued: index === 4 ? 'cut' : null }),
        stoneQueued: () => true,
        planned,
      }),
    );
    expect(texts(forecast.labels)).toEqual(['Déjà prévu', 'Déjà prévu', 'Déjà prévu', '+500', 'Déjà prévu']);
  });

  it('lets a queued cut be upgraded to a clearing, but not the reverse', () => {
    const designation = { wood: [WOOD], woodTrees: [{ featureId: WOOD, treeIndices: [4] }] };
    const queuedCut = lookup({ tree: () => ({ remaining: 500, queued: 'cut' }) });
    expect(texts(forecastGesture({ intent: intent({ ...designation, woodMode: 'clear' }) }, queuedCut).labels)).toEqual(
      ['+500'],
    );
    const queuedClear = lookup({ tree: () => ({ remaining: 0, queued: 'clear' }) });
    expect(texts(forecastGesture({ intent: intent(designation) }, queuedClear).labels)).toEqual(['Déjà prévu']);
    const planned = new PlannedTargets();
    planned.addIntent(intent({ ...designation, woodMode: 'clear' }));
    expect(texts(forecastGesture({ intent: intent(designation) }, lookup({ planned })).labels)).toEqual(['Déjà prévu']);
  });

  it('announces what is empty, depleted or unfinished, and leaves unknown targets to the server', () => {
    const forecast = forecastGesture(
      {
        intent: intent({
          gardens: [
            { cellX: 1, cellY: 1 },
            { cellX: 2, cellY: 2 },
            { cellX: 3, cellY: 3 },
          ],
          stone: [STONE],
        }),
      },
      lookup({
        garden: (cell) =>
          cell.cellX === 1
            ? { completed: true, stored: 0.4, harvesting: false }
            : cell.cellX === 2
              ? { completed: false, stored: 50, harvesting: false }
              : null,
        feature: () => ({ cellX: 8, cellY: 4, remaining: 0 }),
      }),
    );
    expect(texts(forecast.labels)).toEqual(['Vide', 'En construction', 'Épuisé']);
  });
});

describe('reconcileReceipt', () => {
  const sent = forecastGesture(
    { intent: intent({ gardens: [{ cellX: 1, cellY: 2 }], stone: [STONE] }) },
    lookup({ garden: () => ({ completed: true, stored: 40, harvesting: false }) }),
  );
  const accepted = [
    { key: 'garden:1:2', cellX: 1, cellY: 2, resource: 'carrot' as const, amount: 40 },
    { key: STONE, cellX: 8, cellY: 4, resource: 'stone' as const, amount: 2000 },
  ];

  it('shows nothing more when the receipt accepts what was announced', () => {
    expect(reconcileReceipt(sent, receipt({ accepted }), ctx)).toEqual([]);
  });

  it('corrects a refusal, above the first label, as « Raison +0 »', () => {
    const labels = reconcileReceipt(
      sent,
      receipt({ accepted: [accepted[0]!], refused: [{ key: STONE, reason: 'out-of-range' }] }),
      ctx,
    );
    expect(labels).toMatchObject([{ key: STONE, text: 'Hors de portée\n+0', resource: 'error', second: true }]);
  });

  it('corrects a different amount with the real one', () => {
    const labels = reconcileReceipt(sent, receipt({ accepted: [{ ...accepted[0]!, amount: 31 }, accepted[1]!] }), ctx);
    expect(labels).toMatchObject([{ key: 'garden:1:2', text: 'Ajusté\n+31', resource: 'carrot', second: true }]);
  });

  it('shows nothing for a refusal the forecast announced with the same reason', () => {
    const duplicate = forecastGesture({ intent: intent({ stone: [STONE] }) }, lookup({ stoneQueued: () => true }));
    expect(
      reconcileReceipt(duplicate, receipt({ refused: [{ key: STONE, reason: 'already-assigned' }] }), ctx),
    ).toEqual([]);
  });

  it('shows the amount when the server accepts what the client had announced as refused', () => {
    const early = forecastGesture({ intent: intent({ stone: [STONE] }) }, lookup({ stoneQueued: () => true }));
    expect(reconcileReceipt(early, receipt({ accepted: [accepted[1]!] }), ctx)).toMatchObject([
      { key: STONE, text: '+2000', second: true },
    ]);
  });

  it('corrects every announced target when the whole gesture is refused', () => {
    const labels = reconcileReceipt(sent, receipt({ refused: [{ key: '', reason: 'Village indisponible' }] }), {
      ...ctx,
      cellOfRefusal: () => ({ cellX: 1, cellY: 2 }),
    });
    expect(texts(labels)).toEqual(['Village indisponible', 'Village indisponible\n+0', 'Village indisponible\n+0']);
  });

  it('compares a wood case per tree, and a tree refused alone as a correction', () => {
    const wood = forecastGesture(
      { intent: intent({ wood: [WOOD], woodTrees: [{ featureId: WOOD, treeIndices: [4, 5] }] }) },
      lookup(),
    );
    const same = receipt({
      accepted: [{ key: WOOD, cellX: 3, cellY: 4, resource: 'wood', amount: 1000, treeIndices: [4, 5] }],
    });
    expect(reconcileReceipt(wood, same, ctx)).toEqual([]);
    const partial = receipt({
      accepted: [{ key: WOOD, cellX: 3, cellY: 4, resource: 'wood', amount: 500, treeIndices: [4] }],
      refused: [{ key: WOOD, reason: 'tree-not-found' }],
    });
    expect(texts(reconcileReceipt(wood, partial, ctx))).toEqual(['Ajusté\n+500', 'Arbre introuvable\n+0']);
  });

  it('shows every label when no forecast exists (a gesture replayed after a reload)', () => {
    const labels = reconcileReceipt(
      undefined,
      receipt({ accepted: [accepted[0]!], refused: [{ key: STONE, reason: 'depleted' }] }),
      ctx,
    );
    expect(labels).toMatchObject([
      { text: '+40', resource: 'carrot' },
      { text: 'Épuisé', resource: 'error' },
    ]);
    expect(labels.some((l) => l.second)).toBe(false);
  });
});

describe('GestureForecasts', () => {
  it('shows a receipt once, even when it is read twice', () => {
    const forecasts = new GestureForecasts();
    const accepted = [{ key: STONE, cellX: 8, cellY: 4, resource: 'stone' as const, amount: 2000 }];
    forecasts.plan(forecastGesture({ intent: intent({ stone: [STONE] }) }, lookup()));
    const first = forecasts.settle(receipt({ accepted: [{ ...accepted[0]!, amount: 1900 }] }), ctx);
    expect(texts(first)).toEqual(['Ajusté\n+1900']);
    expect(forecasts.settle(receipt({ accepted }), ctx)).toEqual([]);
  });

  it('forgets a gesture dropped before it was sent, and replays one it never announced in full', () => {
    const forecasts = new GestureForecasts();
    forecasts.plan(forecastGesture({ intent: intent({ stone: [STONE] }) }, lookup()));
    forecasts.discard('c1');
    const accepted = [{ key: STONE, cellX: 8, cellY: 4, resource: 'stone' as const, amount: 2000 }];
    expect(texts(forecasts.settle(receipt({ accepted }), ctx))).toEqual(['+2000']);
    forecasts.reset();
    expect(texts(forecasts.settle(receipt({ accepted }), ctx))).toEqual(['+2000']);
  });

  it('turns a cancellation that arrives with the receipt into a correction', () => {
    const forecasts = new GestureForecasts();
    forecasts.plan(
      forecastGesture(
        { intent: intent({ wood: [WOOD], woodTrees: [{ featureId: WOOD, treeIndices: [4] }] }) },
        lookup(),
      ),
    );
    expect(texts(forecasts.settle(receipt({ refused: [{ key: WOOD, reason: 'cancelled' }] }), ctx))).toEqual([
      'Annulé\n+0',
    ]);
  });
});
