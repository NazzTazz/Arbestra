import type { HarvestIntent, HarvestReceipt } from '@arbestra/contracts';

/**
 * Immediate feedback of a harvest gesture (Tristan, 2 November): the « +500 »
 * above the trees confirms that the command left, from what the client already
 * knows; the receipt then only corrects what differs. Everything here is
 * visual: nothing is credited and the server still decides. Pure, computed once
 * per gesture, never per frame.
 */

export interface FeedbackSpec {
  /** `garden:x:y` for a plot, the feature id for a wood case or a deposit. */
  key: string;
  cellX: number;
  cellY: number;
  text: string;
  resource: 'carrot' | 'wood' | 'stone' | 'error';
  /** A wood feedback rises from its own tree, not from the grove's cell. */
  tree?: { featureId: string; treeIndex: number };
  /** Amount of a « + » label (absent on a refusal). */
  amount?: number;
  /** A correction, drawn above the first label. */
  second?: boolean;
}

export const reasons: Record<string, string> = {
  'already-assigned': 'Déjà prévu',
  'out-of-range': 'Hors de portée',
  protected: 'Protégé',
  interior: 'Inaccessible',
  unreachable: 'Sans chemin',
  depleted: 'Épuisé',
  empty: 'Vide',
  'not-found': 'Indisponible',
  'tree-not-found': 'Arbre introuvable',
  cancelled: 'Annulé',
  'building-incomplete': 'En construction',
};
export const refusalText = (reason: string) => reasons[reason] ?? reason;
const NOT_TAKEN = 'Non pris en compte';

/**
 * The wood a receipt accepted, tree by tree (Tristan, 29 October: one « +500 »
 * per tree, not one per grove): each designated tree takes what it still holds,
 * in the order designated, until the accepted amount is spent; the amounts add
 * up to the receipt's. A tree the scene does not know shares what is left.
 */
export function woodFeedbackAmounts(
  amount: number,
  treeIndices: readonly number[],
  remainingOf: (treeIndex: number) => number | null,
): Array<{ treeIndex: number; amount: number }> {
  let left = amount;
  return treeIndices.map((treeIndex, i) => {
    const rest = treeIndices.length - i,
      share = Math.min(left, remainingOf(treeIndex) ?? Math.ceil(left / rest)),
      given = i === treeIndices.length - 1 ? left : share;
    left -= given;
    return { treeIndex, amount: given };
  });
}

type WoodMode = 'cut' | 'clear';
type Accepted = HarvestReceipt['accepted'][number];

/** What the village is already going to do, by target: other gestures not yet
 * settled, and targets the server accepted a moment ago. */
export class PlannedTargets {
  readonly #keys = new Set<string>();
  addIntent(intent: HarvestIntent) {
    for (const cell of intent.gardens) this.#keys.add(`garden:${cell.cellX}:${cell.cellY}`);
    for (const id of intent.stone) this.#keys.add(id);
    const mode: WoodMode = intent.woodMode === 'clear' ? 'clear' : 'cut';
    for (const id of intent.wood) {
      const designated = intent.woodTrees?.find((entry) => entry.featureId === id);
      for (const index of designated?.treeIndices ?? ['*']) this.#keys.add(`${id}:${index}:${mode}`);
    }
  }
  addAccepted(a: Accepted) {
    if (a.resource !== 'wood') this.#keys.add(a.key);
    else for (const index of a.treeIndices ?? ['*']) this.#keys.add(`${a.key}:${index}:${a.woodMode ?? 'cut'}`);
  }
  garden(cell: { cellX: number; cellY: number }) {
    return this.#keys.has(`garden:${cell.cellX}:${cell.cellY}`);
  }
  stone(id: string) {
    return this.#keys.has(id);
  }
  /** A cut is planned by a cut or a clearing; a clearing only by a clearing. */
  wood(id: string, treeIndex: number | null, mode: WoodMode) {
    const modes: WoodMode[] = mode === 'clear' ? ['clear'] : ['clear', 'cut'];
    return modes.some(
      (m) => this.#keys.has(`${id}:*:${m}`) || (treeIndex !== null && this.#keys.has(`${id}:${treeIndex}:${m}`)),
    );
  }
}

/** What the client knows of the world, read once for a gesture. `null`: unknown, left to the server. */
export interface ForecastLookup {
  garden(cell: { cellX: number; cellY: number }): { completed: boolean; stored: number; harvesting: boolean } | null;
  feature(id: string): { cellX: number; cellY: number; remaining: number } | null;
  tree(featureId: string, treeIndex: number): { remaining: number; queued: WoodMode | null } | null;
  /** The whole case is in the village's wood queue, for this mode. */
  caseQueued(featureId: string, mode: WoodMode): boolean;
  stoneQueued(id: string): boolean;
  planned: PlannedTargets;
}

export interface Forecast {
  commandId: string;
  labels: FeedbackSpec[];
}

const refusal = (
  key: string,
  cell: { cellX: number; cellY: number },
  reason: string,
  tree?: FeedbackSpec['tree'],
): FeedbackSpec => ({
  key,
  cellX: cell.cellX,
  cellY: cell.cellY,
  text: refusalText(reason),
  resource: 'error',
  ...(tree ? { tree } : {}),
});

/** The labels a gesture shows as it leaves: gardens, then wood tree by tree, then stone. */
export function forecastGesture(
  item: { intent: HarvestIntent; trees?: ReadonlyArray<{ featureId: string; cellX: number; cellY: number }> },
  lookup: ForecastLookup,
): Forecast {
  const { intent } = item,
    labels: FeedbackSpec[] = [],
    mode: WoodMode = intent.woodMode === 'clear' ? 'clear' : 'cut';
  for (const cell of intent.gardens) {
    const plot = lookup.garden(cell),
      key = `garden:${cell.cellX}:${cell.cellY}`;
    if (!plot) continue;
    const reason = !plot.completed
      ? 'building-incomplete'
      : plot.harvesting || lookup.planned.garden(cell)
        ? 'already-assigned'
        : plot.stored < 1
          ? 'empty'
          : null;
    if (reason) labels.push(refusal(key, cell, reason));
    else {
      const amount = Math.floor(plot.stored);
      labels.push({ key, cellX: cell.cellX, cellY: cell.cellY, text: `+${amount}`, resource: 'carrot', amount });
    }
  }
  for (const id of intent.wood) {
    const feature = lookup.feature(id);
    if (!feature) continue;
    const cell = item.trees?.find((t) => t.featureId === id) ?? feature,
      designated = intent.woodTrees?.find((entry) => entry.featureId === id)?.treeIndices;
    if (!designated) {
      if (lookup.caseQueued(id, mode) || lookup.planned.wood(id, null, mode))
        labels.push(refusal(id, feature, 'already-assigned'));
      else if (feature.remaining <= 0 && mode === 'cut') labels.push(refusal(id, feature, 'depleted'));
      else
        labels.push({
          key: id,
          cellX: feature.cellX,
          cellY: feature.cellY,
          text: `+${feature.remaining}`,
          resource: 'wood',
          amount: feature.remaining,
        });
      continue;
    }
    for (const treeIndex of designated) {
      const tree = lookup.tree(id, treeIndex),
        at = { featureId: id, treeIndex };
      if (!tree) continue;
      if (tree.queued === 'clear' || (mode === 'cut' && tree.queued) || lookup.planned.wood(id, treeIndex, mode))
        labels.push(refusal(id, cell, 'already-assigned', at));
      else if (tree.remaining <= 0 && mode === 'cut') labels.push(refusal(id, cell, 'depleted', at));
      else
        labels.push({
          key: id,
          cellX: cell.cellX,
          cellY: cell.cellY,
          text: `+${tree.remaining}`,
          resource: 'wood',
          tree: at,
          amount: tree.remaining,
        });
    }
  }
  for (const id of intent.stone) {
    const feature = lookup.feature(id);
    if (!feature) continue;
    if (lookup.stoneQueued(id) || lookup.planned.stone(id)) labels.push(refusal(id, feature, 'already-assigned'));
    else if (feature.remaining <= 0) labels.push(refusal(id, feature, 'depleted'));
    else
      labels.push({
        key: id,
        cellX: feature.cellX,
        cellY: feature.cellY,
        text: `+${feature.remaining}`,
        resource: 'stone',
        amount: feature.remaining,
      });
  }
  return { commandId: intent.commandId, labels };
}

export interface ReceiptContext {
  /** Wood left on a tree of the scene (null: unknown). */
  remainingOf(featureId: string, treeIndex: number): number | null;
  /** Where a refusal of this key shows (a plot, a feature, a designated tree, the gesture's first cell). */
  cellOfRefusal(key: string): { cellX: number; cellY: number } | undefined;
}

/** Every label a receipt calls for, as it was shown before the forecast existed. */
export function receiptLabels(receipt: HarvestReceipt, ctx: ReceiptContext): FeedbackSpec[] {
  const entries = receipt.accepted.flatMap((a): FeedbackSpec[] => {
    const base = { key: a.key, cellX: a.cellX, cellY: a.cellY, resource: a.resource };
    if (a.resource !== 'wood' || !a.treeIndices?.length) return [{ ...base, text: `+${a.amount}`, amount: a.amount }];
    return woodFeedbackAmounts(a.amount, a.treeIndices, (index) => ctx.remainingOf(a.key, index)).map(
      ({ treeIndex, amount }) => ({
        ...base,
        text: `+${amount}`,
        amount,
        tree: { featureId: a.key, treeIndex },
      }),
    );
  });
  for (const rejection of receipt.refused) {
    const cell = ctx.cellOfRefusal(rejection.key);
    if (cell) entries.push(refusal(rejection.key, cell, rejection.reason));
  }
  return entries;
}

const identity = (label: FeedbackSpec) => `${label.key}|${label.tree?.treeIndex ?? ''}`;
const total = (labels: FeedbackSpec[]) => labels.reduce((sum, l) => sum + (l.amount ?? 0), 0);

/** A label correcting `shown`, drawn above it: « Raison\n+0 » for a refusal, « Ajusté\n+N » for another amount. */
function correction(actual: FeedbackSpec, shown: FeedbackSpec | undefined): FeedbackSpec {
  const text =
    actual.resource === 'error'
      ? `${actual.text}\n+0`
      : shown && shown.resource !== 'error'
        ? `Ajusté\n+${actual.amount ?? 0}`
        : actual.text;
  return { ...actual, text, second: true };
}

/**
 * What the receipt adds to the labels already shown: nothing for a target the
 * forecast got right (same amount, same refusal), a correction above it
 * otherwise. Without a forecast (a gesture replayed after a reload), every label.
 */
export function reconcileReceipt(
  forecast: Forecast | undefined,
  receipt: HarvestReceipt,
  ctx: ReceiptContext,
): FeedbackSpec[] {
  const actual = receiptLabels(receipt, ctx);
  if (!forecast) return actual;
  const shownByKey = new Map<string, FeedbackSpec[]>(),
    actualByKey = new Map<string, FeedbackSpec[]>();
  for (const label of forecast.labels) shownByKey.set(label.key, [...(shownByKey.get(label.key) ?? []), label]);
  for (const label of actual) actualByKey.set(label.key, [...(actualByKey.get(label.key) ?? []), label]);
  const out: FeedbackSpec[] = [];
  for (const [key, labels] of actualByKey) {
    const shown = shownByKey.get(key);
    if (!shown) {
      out.push(...labels);
      continue;
    }
    const shownIds = new Map(shown.map((l) => [identity(l), l]));
    if (labels.length === shown.length && labels.every((l) => shownIds.has(identity(l)))) {
      for (const label of labels) {
        const before = shownIds.get(identity(label))!;
        if (before.text !== label.text) out.push(correction(label, before));
      }
      continue;
    }
    // Another granularity (a tree refused alone, a case answered whole): compare the case.
    const sameReasons = labels
      .filter((l) => l.resource === 'error')
      .every((l) => shown.some((o) => o.resource === 'error' && o.text === l.text));
    if (total(labels) === total(shown) && sameReasons) continue;
    const positive = shown.find((s) => s.resource !== 'error');
    out.push(...labels.map((l) => correction(l, positive)));
  }
  // A target the forecast announced and the receipt does not mention at all.
  const generic = receipt.refused.find((r) => r.key === '');
  for (const [key, shown] of shownByKey) {
    if (actualByKey.has(key)) continue;
    for (const label of shown) {
      if (label.resource === 'error') continue;
      const { amount: _amount, ...rest } = label;
      void _amount;
      out.push({
        ...rest,
        text: `${generic ? refusalText(generic.reason) : NOT_TAKEN}\n+0`,
        resource: 'error',
        second: true,
      });
    }
  }
  return out;
}

/** The forecasts of the gestures in flight, and the receipts already settled (a receipt read twice shows once). */
export class GestureForecasts {
  readonly #forecasts = new Map<string, Forecast>();
  readonly #settled = new Set<string>();
  plan(forecast: Forecast) {
    this.#forecasts.set(forecast.commandId, forecast);
  }
  discard(commandId: string) {
    this.#forecasts.delete(commandId);
  }
  reset() {
    this.#forecasts.clear();
    this.#settled.clear();
  }
  settle(receipt: HarvestReceipt, ctx: ReceiptContext): FeedbackSpec[] {
    if (this.#settled.has(receipt.commandId)) return [];
    this.#settled.add(receipt.commandId);
    if (this.#settled.size > 64) this.#settled.delete(this.#settled.values().next().value!);
    const forecast = this.#forecasts.get(receipt.commandId);
    this.#forecasts.delete(receipt.commandId);
    return reconcileReceipt(forecast, receipt, ctx);
  }
}
