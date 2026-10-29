import { useEffect, useRef, useState, type RefObject } from 'react';
import type { HarvestIntent, HarvestReceipt, VillageState } from '@arbestra/contracts';
import { ApiError, cancelHarvestIntent, sendHarvestIntent, readHarvestReceipts } from '../api/client';
import { randomUUID } from '../random-uuid';
import type { Cell } from '../scene/construction-selection';
import type { TerrainHandle } from '../scene/VillageScene';
import { cellKey } from '../scene/construction-selection';
import { cancelSummary } from './harvest-cancel';
import { designateTree, type DesignatedTree } from './wood-designation';
export type HarvestFilter = 'gardens' | 'wood' | 'stone';
export type { DesignatedTree };
type Draft = { intent: HarvestIntent; cells: Cell[]; trees?: DesignatedTree[]; submitted?: boolean };
export type HarvestFeedback = Cell & {
  id: string;
  text: string;
  resource: 'carrot' | 'wood' | 'stone' | 'error';
  at: number;
  /** A wood feedback rises from its own tree, not from the grove's cell. */
  tree?: { featureId: string; treeIndex: number };
};

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
const reasons: Record<string, string> = {
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
/** Accepted trees stay pending this long, until the village's queue shows them. */
const ACCEPTED_HOLD_MS = 6000;
export function useHarvestTool({
  state,
  scene,
  enabled,
  slug,
  woodMode = 'cut',
  onAccepted,
}: {
  state: VillageState | null;
  scene: RefObject<TerrainHandle | null>;
  enabled: boolean;
  slug: string;
  /** What a wood gesture queues its trees for (cut, or clear: wood then stump). */
  woodMode?: 'cut' | 'clear';
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
    accepted = useRef<Array<{ until: number; trees: DesignatedTree[] }>>([]),
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
  function flash(receipt: HarvestReceipt, item: Draft) {
    const at = Date.now();
    const entries: HarvestFeedback[] = receipt.accepted.flatMap((a): HarvestFeedback[] => {
      if (a.resource !== 'wood' || !a.treeIndices?.length)
        return [{ ...a, id: randomUUID(), text: `+${a.amount}`, at }];
      const rows = current.current.scene.current?.groveTrees(a.key) ?? [];
      return woodFeedbackAmounts(
        a.amount,
        a.treeIndices,
        (treeIndex) => rows.find((r) => r.treeIndex === treeIndex)?.remaining ?? null,
      ).map(({ treeIndex, amount }) => ({
        ...a,
        id: randomUUID(),
        text: `+${amount}`,
        at,
        tree: { featureId: a.key, treeIndex },
      }));
    });
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
    if (kept.length) {
      accepted.current.push({ until: at + ACCEPTED_HOLD_MS, trees: kept });
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        if (alive.current) publish();
      }, ACCEPTED_HOLD_MS + 50);
    }
    for (const rejection of receipt.refused) {
      const feature = current.current.state?.region.features.find((f) => f.id === rejection.key);
      const designated = item.trees?.find((t) => t.featureId === rejection.key);
      const cell = rejection.key.startsWith('garden:')
        ? { cellX: Number(rejection.key.split(':')[1]), cellY: Number(rejection.key.split(':')[2]) }
        : (feature ?? designated ?? item.cells[0]);
      if (cell)
        entries.push({
          ...cell,
          id: randomUUID(),
          text: reasons[rejection.reason] ?? rejection.reason,
          resource: 'error',
          at,
        });
    }
    setFeedback((previous) => [...previous.filter((f) => at - f.at < 3000), ...entries].slice(-32));
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
        queue.current = queue.current.filter((d) => d.intent.commandId !== item.intent.commandId);
        flash(receipt, item);
        current.current.onAccepted();
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
    queue.current = [];
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
  useEffect(() => {
    let cancelled = false,
      busy = false;
    const poll = async () => {
      const village = current.current.state,
        ids = queue.current
          .filter((d) => d.submitted)
          .slice(0, 64)
          .map((d) => d.intent.commandId);
      if (busy || !village || !ids.length) return;
      busy = true;
      try {
        const receipts = await readHarvestReceipts(slug, village.village.id, ids);
        if (cancelled) return;
        for (const receipt of receipts) {
          if (receipt.pending) continue;
          const item = queue.current.find((d) => d.intent.commandId === receipt.commandId);
          if (!item) continue;
          queue.current = queue.current.filter((d) => d !== item);
          flash(receipt, item);
          current.current.onAccepted();
        }
        persist();
        setNetworkError(false);
      } catch {
        if (!cancelled) setNetworkError(true);
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [storageKey]);
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
