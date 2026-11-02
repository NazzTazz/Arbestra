import { useEffect, useRef, useState, type RefObject } from 'react';
import type { HarvestIntent, HarvestReceipt, VillageState } from '@arbestra/contracts';
import { ApiError, cancelHarvestIntent, sendHarvestIntent } from '../api/client';
import { randomUUID } from '../random-uuid';
import type { Cell } from '../scene/construction-selection';
import type { TerrainHandle } from '../scene/VillageScene';
import { cellKey } from '../scene/construction-selection';
import { cancelSummary } from './harvest-cancel';
import { designateTree, type DesignatedTree } from './wood-designation';
import {
  GestureForecasts,
  PlannedTargets,
  forecastGesture,
  woodFeedbackAmounts,
  type FeedbackSpec,
  type ForecastLookup,
  type ReceiptContext,
} from './harvest-forecast';
import { queuedMode, woodQueue } from '../scene/wood-queue';
export type HarvestFilter = 'gardens' | 'wood' | 'stone';
export type { DesignatedTree };
export { woodFeedbackAmounts };
type Draft = { intent: HarvestIntent; cells: Cell[]; trees?: DesignatedTree[]; submitted?: boolean };
export type HarvestFeedback = FeedbackSpec & { id: string; at: number };
/** The last gesture, which « Annuler » targets for 15 s (docs/SPEC-GRAMMAIRE-GESTUELLE.md §1). */
export interface LastGesture {
  commandId: string;
  at: number;
  /** Only the wood of a gesture can be cancelled. */
  wood: boolean;
}
export interface CancelResult {
  text: string;
  at: number;
  pending?: boolean;
  error?: boolean;
}
/** The queued gestures whose receipt is final: those a batch of receipts settles. */
export function settledGestures<T extends { intent: { commandId: string } }>(
  queue: readonly T[],
  receipts: readonly HarvestReceipt[],
): Array<{ item: T; receipt: HarvestReceipt }> {
  return receipts.flatMap((receipt) => {
    const item = receipt.pending ? undefined : queue.find((d) => d.intent.commandId === receipt.commandId);
    return item ? [{ item, receipt }] : [];
  });
}
/**
 * The gestures sent whose receipt the stream's snapshot does not list: a
 * gesture older than the snapshot's window (a page left asleep), which the
 * server answers again from its stored receipt, command by command.
 */
export function lostGestures<T extends { intent: { commandId: string }; submitted?: boolean }>(
  queue: readonly T[],
  receipts: readonly HarvestReceipt[],
): T[] {
  const known = new Set(receipts.map((receipt) => receipt.commandId));
  return queue.filter((d) => d.submitted && !known.has(d.intent.commandId));
}
/** Accepted trees stay pending this long, until the village's queue shows them. */
const ACCEPTED_HOLD_MS = 6000;
export function useHarvestTool({
  state,
  scene,
  enabled,
  slug,
  woodMode = 'cut',
  receipts,
  onAccepted,
}: {
  state: VillageState | null;
  scene: RefObject<TerrainHandle | null>;
  enabled: boolean;
  slug: string;
  /** What a wood gesture queues its trees for (cut, or clear: wood then stump). */
  woodMode?: 'cut' | 'clear';
  /**
   * The receipts of the gestures, from the V2 stream: it delivers each one when
   * the worker writes it (null while its first snapshot is not loaded).
   */
  receipts: ReadonlyArray<HarvestReceipt> | null;
  onAccepted: () => void;
}) {
  const [filter, setFilter] = useState<HarvestFilter>('gardens');
  const [pendingCells, setPendingCells] = useState<Cell[]>([]);
  const [pendingTrees, setPendingTrees] = useState<DesignatedTree[]>([]);
  const [feedback, setFeedback] = useState<HarvestFeedback[]>([]);
  const [networkError, setNetworkError] = useState(false);
  const [lastGesture, setLastGesture] = useState<LastGesture | null>(null);
  const [cancelResult, setCancelResult] = useState<CancelResult | null>(null);
  const draft = useRef<Draft | null>(null),
    queue = useRef<Draft[]>([]),
    flight = useRef(false),
    alive = useRef(true),
    retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    // The gesture being sent, and a cancellation waiting for that send to settle.
    flying = useRef<string | null>(null),
    cancelAfterSend = useRef<string | null>(null),
    last = useRef<LastGesture | null>(null),
    checked = useRef<string | null>(null),
    accepted = useRef<Array<{ until: number; trees: DesignatedTree[]; targets: HarvestReceipt['accepted'] }>>([]),
    forecasts = useRef(new GestureForecasts()),
    holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef({ state, scene, enabled, filter, woodMode, onAccepted });
  current.current = { state, scene, enabled, filter, woodMode, onAccepted };
  const storageKey = state ? `arbestra:harvest-intents:${state.world.id}:${state.village.id}` : null;
  const context = useRef(storageKey);
  context.current = storageKey;
  function publish() {
    const now = Date.now();
    accepted.current = accepted.current.filter((a) => a.until > now);
    setPendingCells([...queue.current.flatMap((d) => d.cells), ...(draft.current?.cells ?? [])]);
    setPendingTrees([
      ...queue.current.flatMap((d) => d.trees ?? []),
      ...(draft.current?.trees ?? []),
      ...accepted.current.flatMap((a) => a.trees),
    ]);
  }
  function persist() {
    if (context.current) sessionStorage.setItem(context.current, JSON.stringify(queue.current));
    publish();
  }
  /** Where a refusal shows: its plot, its feature, the tree designated, else the gesture's first cell. */
  function receiptContext(item: Draft): ReceiptContext {
    return {
      remainingOf: (featureId, treeIndex) =>
        current.current.scene.current?.groveTrees(featureId)?.find((r) => r.treeIndex === treeIndex)?.remaining ?? null,
      cellOfRefusal: (key) => {
        if (key.startsWith('garden:')) return { cellX: Number(key.split(':')[1]), cellY: Number(key.split(':')[2]) };
        const feature = current.current.state?.region.features.find((f) => f.id === key);
        return feature ?? item.trees?.find((t) => t.featureId === key) ?? item.cells[0];
      },
    };
  }
  function show(specs: FeedbackSpec[], at = Date.now()) {
    if (!specs.length) return;
    const entries = specs.map((spec): HarvestFeedback => ({ ...spec, id: randomUUID(), at }));
    setFeedback((previous) => [...previous.filter((f) => at - f.at < 3000), ...entries].slice(-32));
  }
  /**
   * The labels of a gesture as it leaves (Tristan, 2 November): what the client
   * already knows, so the « +500 » answers the click at once. The receipt then
   * only corrects (`flash`). Computed once, here, never per frame.
   */
  function announce(item: Draft) {
    const village = current.current.state;
    if (!village) return;
    const scene = current.current.scene.current,
      planned = new PlannedTargets();
    for (const queued of queue.current) planned.addIntent(queued.intent);
    for (const hold of accepted.current) for (const target of hold.targets) planned.addAccepted(target);
    const plots = new Map<string, { completed: boolean; stored: number; harvesting: boolean }>();
    for (const cell of village.cells)
      if (cell.building?.garden)
        for (const plot of cell.building.garden.plots)
          plots.set(cellKey(plot), {
            completed: cell.building.status === 'completed',
            stored: plot.storedCarrots,
            harvesting: Boolean(plot.harvest),
          });
    const worksites = village.village.worksites,
      wood = woodQueue(worksites),
      stone = new Set<string>(),
      groves = new Map<string, ReturnType<TerrainHandle['groveTrees']>>();
    for (const site of worksites ?? [])
      if (site.resourceCode === 'stone' && (site.poolResource || site.status === 'running' || site.status === 'paused'))
        for (const target of site.targets) if (target.status === 'pending') stone.add(target.featureId);
    const lookup: ForecastLookup = {
      garden: (cell) => plots.get(cellKey(cell)) ?? null,
      feature: (id) => {
        const feature = village.region.features.find((f) => f.id === id);
        return feature?.deposit
          ? { cellX: feature.cellX, cellY: feature.cellY, remaining: feature.deposit.remainingAmount }
          : null;
      },
      tree: (featureId, treeIndex) => {
        if (!groves.has(featureId)) groves.set(featureId, scene?.groveTrees(featureId) ?? null);
        const row = groves.get(featureId)?.find((r) => r.treeIndex === treeIndex);
        return row ? { remaining: row.remaining, queued: row.queued } : null;
      },
      caseQueued: (featureId, mode) => {
        const queued = queuedMode(wood, featureId, null);
        return mode === 'clear' ? queued === 'clear' : queued !== null;
      },
      stoneQueued: (id) => stone.has(id),
      planned,
    };
    const forecast = forecastGesture(item, lookup);
    forecasts.current.plan(forecast);
    show(forecast.labels);
  }
  /** The receipt: what the forecast got right shows nothing more, what differs shows a correction above it. */
  function flash(receipt: HarvestReceipt, item: Draft) {
    const at = Date.now();
    // The trees accepted stay marked until the village's queue holds them.
    const kept = receipt.accepted.flatMap((a): DesignatedTree[] =>
      a.resource !== 'wood'
        ? []
        : (a.treeIndices ?? [null]).map((treeIndex) => ({
            featureId: a.key,
            treeIndex,
            cellX: a.cellX,
            cellY: a.cellY,
          })),
    );
    if (receipt.accepted.length) {
      accepted.current.push({ until: at + ACCEPTED_HOLD_MS, trees: kept, targets: receipt.accepted });
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        if (alive.current) publish();
      }, ACCEPTED_HOLD_MS + 50);
    }
    show(forecasts.current.settle(receipt, receiptContext(item)), at);
  }
  /** Sends the cancellation of a gesture already sent, and shows what it did. */
  async function requestCancel(commandId: string) {
    const village = current.current.state;
    if (!village) return;
    setCancelResult({ text: 'Annulation…', at: Date.now(), pending: true });
    try {
      const receipt = await cancelHarvestIntent(slug, village.village.id, commandId);
      if (!alive.current) return;
      setCancelResult({ text: cancelSummary(receipt), at: Date.now() });
      current.current.onAccepted();
    } catch (error) {
      if (!alive.current) return;
      setCancelResult({
        text: error instanceof ApiError ? error.message : 'Annulation incertaine : connexion interrompue.',
        at: Date.now(),
        error: true,
      });
    }
  }
  /**
   * « Annuler » the last gesture (a new gesture replaces the previous one):
   * not sent yet, it is dropped here; being sent, it is cancelled once the
   * server has it; sent, the server withdraws its trees and says what it did.
   */
  function cancelLast() {
    const target = last.current;
    if (!target?.wood) return;
    last.current = null;
    setLastGesture(null);
    const item = queue.current.find((d) => d.intent.commandId === target.commandId);
    if (item && !item.submitted && flying.current !== target.commandId) {
      queue.current = queue.current.filter((d) => d !== item);
      forecasts.current.discard(item.intent.commandId);
      persist();
      setCancelResult({ text: 'Geste annulé avant son envoi.', at: Date.now() });
      return;
    }
    if (flying.current === target.commandId) {
      cancelAfterSend.current = target.commandId;
      setCancelResult({ text: 'Annulation…', at: Date.now(), pending: true });
      return;
    }
    void requestCancel(target.commandId);
  }
  async function drain() {
    const item = queue.current.find((d) => !d.submitted),
      village = current.current.state;
    if (flight.current || !item || !village) return;
    flight.current = true;
    flying.current = item.intent.commandId;
    const key = context.current;
    let sent = false;
    try {
      const receipt = await sendHarvestIntent(slug, village.village.id, item.intent);
      sent = true;
      if (!alive.current || key !== context.current) return;
      if (receipt.pending) item.submitted = true;
      else {
        // The stream may have settled it already (a gesture sent again).
        const queued = queue.current.includes(item);
        queue.current = queue.current.filter((d) => d.intent.commandId !== item.intent.commandId);
        if (queued) {
          flash(receipt, item);
          current.current.onAccepted();
        }
      }
      persist();
      setNetworkError(false);
    } catch (error) {
      if (!alive.current || key !== context.current) return;
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) {
        queue.current = queue.current.filter((d) => d.intent.commandId !== item.intent.commandId);
        persist();
        flash({ commandId: item.intent.commandId, accepted: [], refused: [{ key: '', reason: error.message }] }, item);
        if (cancelAfterSend.current === item.intent.commandId) {
          cancelAfterSend.current = null;
          setCancelResult({ text: 'Geste refusé : rien à annuler.', at: Date.now() });
        }
      } else {
        setNetworkError(true);
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          void drain();
        }, 3000);
      }
    } finally {
      flight.current = false;
      flying.current = null;
      if (sent && cancelAfterSend.current === item.intent.commandId) {
        cancelAfterSend.current = null;
        void requestCancel(item.intent.commandId);
      }
      if (alive.current && key === context.current && !retryTimer.current) void drain();
    }
  }
  useEffect(() => {
    alive.current = true;
    checked.current = null;
    queue.current = [];
    forecasts.current.reset();
    draft.current = null;
    last.current = null;
    setLastGesture(null);
    setCancelResult(null);
    if (storageKey) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
        if (Array.isArray(saved)) queue.current = saved.filter((d) => d?.intent?.commandId && Array.isArray(d.cells));
      } catch {
        /* No command can be recovered from corrupt storage. */
      }
    }
    publish();
    void drain();
    return () => {
      alive.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = null;
    };
  }, [storageKey]);
  // Each gesture settles when the worker writes its receipt to the V2 stream.
  useEffect(() => {
    if (!receipts || !storageKey) return;
    let changed = false;
    for (const { item, receipt } of settledGestures(queue.current, receipts)) {
      queue.current = queue.current.filter((d) => d !== item);
      flash(receipt, item);
      current.current.onAccepted();
      changed = true;
    }
    // Once per page: what the first snapshot does not list is asked again.
    let lost: Draft[] = [];
    if (checked.current !== storageKey) {
      checked.current = storageKey;
      lost = lostGestures(queue.current, receipts);
      for (const item of lost) item.submitted = false;
    }
    if (changed || lost.length) persist();
    if (lost.length) void drain();
  }, [receipts, storageKey]);
  function cancel() {
    draft.current = null;
    publish();
  }
  function collect(
    cell: Cell | null,
    newGesture = false,
    previewOnly = false,
    tree?: { featureId: string; treeIndex: number | null },
  ) {
    if (previewOnly || !current.current.enabled) return;
    const village = current.current.state;
    if (!village) return;
    if (!cell) {
      const item = draft.current;
      draft.current = null;
      if (item && (item.intent.gardens.length || item.intent.wood.length || item.intent.stone.length)) {
        announce(item);
        queue.current.push(item);
        // « Annuler » now targets this gesture: a new gesture replaces the previous one.
        last.current = { commandId: item.intent.commandId, at: Date.now(), wood: item.intent.wood.length > 0 };
        setLastGesture(last.current);
        setCancelResult(null);
        persist();
        void drain();
      } else publish();
      return;
    }
    if (newGesture)
      draft.current = {
        intent: {
          commandId: randomUUID(),
          gardens: [],
          wood: [],
          stone: [],
          ...(current.current.filter === 'wood' && current.current.woodMode === 'clear'
            ? { woodMode: 'clear' as const }
            : {}),
        },
        cells: [],
        trees: [],
      };
    const item = draft.current;
    if (!item) return;
    const selected = current.current.filter;
    let changed = false;
    // Wood is designated tree by tree: the scene names the tree under the gesture.
    if (tree) {
      if (selected === 'wood') changed = designateTree(item, { ...tree, ...cell });
      if (changed) publish();
      return;
    }
    const garden = village.cells.some(
      (c) => c.building?.status === 'completed' && c.building.garden?.plots.some((p) => cellKey(p) === cellKey(cell)),
    );
    if (
      garden &&
      selected === 'gardens' &&
      item.intent.gardens.length < 100 &&
      !item.intent.gardens.some((p) => cellKey(p) === cellKey(cell))
    ) {
      item.intent.gardens.push(cell);
      changed = true;
    }
    for (const feature of scene.current?.featuresAt(cell) ??
      village.region.features.filter((f) => cellKey(f) === cellKey(cell))) {
      const family = feature.deposit?.resourceCode;
      if (
        family === 'stone' &&
        selected === family &&
        item.intent[family].length < 64 &&
        !item.intent[family].includes(feature.id)
      ) {
        item.intent[family].push(feature.id);
        changed = true;
      }
    }
    if (changed && !item.cells.some((p) => cellKey(p) === cellKey(cell))) item.cells.push(cell);
    publish();
  }
  return {
    filter,
    setFilter,
    pendingCells,
    pendingTrees,
    feedback,
    networkError,
    collect,
    cancel,
    hasDraft: () => !!draft.current,
    lastGesture,
    cancelResult,
    cancelLast,
    dismissCancel: () => setCancelResult(null),
  };
}
