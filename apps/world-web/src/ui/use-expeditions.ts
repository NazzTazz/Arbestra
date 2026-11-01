import { useCallback, useEffect, useRef, useState } from 'react';
import {
  mergeExpeditionReceipt,
  type ExpeditionIntent,
  type ExpeditionReceipt,
  type ScienceCommand,
} from '@arbestra/contracts';
import { sendExpedition, ApiError } from '../api/client';
import { randomUUID } from '../random-uuid';
type Entry = { intent?: ExpeditionIntent; receipt?: ExpeditionReceipt; uncertain?: boolean; message?: string };

/**
 * The intents a previous page left uncertain that the server never received.
 * The stream's snapshot lists every pending and recent command of the village:
 * an uncertain intent it lacks did not arrive (or is older than its window, and
 * sending it again returns the stored receipt: commands are idempotent).
 */
export function unsentIntents(
  entries: Iterable<[string, Pick<Entry, 'intent' | 'uncertain'>]>,
  known: ReadonlyArray<{ commandId: string }>,
): ExpeditionIntent[] {
  const ids = new Set(known.map((receipt) => receipt.commandId));
  return [...entries].flatMap(([id, item]) => (item.uncertain && item.intent && !ids.has(id) ? [item.intent] : []));
}

/**
 * `receipts` comes from the V2 stream, which delivers each receipt when the
 * worker writes it: null while its first snapshot is not loaded. Nothing is
 * polled.
 */
export function useExpeditions(
  slug: string,
  worldId: string | undefined,
  villageId: string | undefined,
  enabled: boolean,
  receipts: ReadonlyArray<ExpeditionReceipt> | null,
) {
  const scope = worldId && villageId ? worldId + ':' + villageId : '';
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const active = useRef(enabled);
  active.current = enabled;
  const generation = useRef(0),
    context = useRef({ scope, enabled });
  if (context.current.scope !== scope || context.current.enabled !== enabled) {
    generation.current++;
    context.current = { scope, enabled };
  }
  const records = useRef(new Map<string, Entry>()),
    flying = useRef(new Set<string>()),
    checked = useRef(''),
    [entries, setEntries] = useState<Entry[]>([]);
  const key = 'arbestra:expeditions:' + scope;
  const publish = useCallback(() => {
    const list = [...records.current.values()];
    setEntries(list);
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify(
          list.filter(
            (e) => e.intent && (e.uncertain || e.receipt?.status === 'pending' || (!e.receipt && !e.message)),
          ),
        ),
      );
    } catch {
      /* durable server receipts still recover admitted requests */
    }
  }, [key]);
  const receive = useCallback(
    (receipt: ExpeditionReceipt) => {
      if (
        !active.current ||
        currentScope.current !== scope ||
        receipt.worldId !== worldId ||
        receipt.villageId !== villageId
      )
        return;
      const old = records.current.get(receipt.commandId);
      const merged = mergeExpeditionReceipt(old?.receipt, receipt);
      if (old?.receipt === merged && !old.uncertain && !old.message) return;
      records.current.set(receipt.commandId, { ...(old?.intent ? { intent: old.intent } : {}), receipt: merged });
      while (records.current.size > 68) {
        const item = [...records.current].find(([, e]) => e.receipt?.status !== 'pending' && !e.uncertain);
        if (!item) break;
        records.current.delete(item[0]);
      }
      publish();
    },
    [scope, worldId, villageId, publish],
  );
  const send = useCallback(
    async (intent: ExpeditionIntent) => {
      if (!active.current || !villageId || currentScope.current !== scope) return;
      if (flying.current.has(intent.commandId)) return;
      const epoch = generation.current;
      const previous = records.current.get(intent.commandId);
      if (previous?.receipt && previous.receipt.status !== 'pending') return;
      records.current.set(intent.commandId, { ...previous, intent });
      publish();
      flying.current.add(intent.commandId);
      try {
        const receipt = await sendExpedition(slug, villageId, intent);
        if (active.current && generation.current === epoch) receive(receipt);
      } catch (error) {
        if (!active.current || currentScope.current !== scope || generation.current !== epoch) return;
        const old = records.current.get(intent.commandId);
        if (old?.receipt && old.receipt.status !== 'pending') return;
        const retryable = !(error instanceof ApiError) || error.status >= 500 || error.status === 429;
        records.current.set(intent.commandId, {
          ...old,
          intent,
          uncertain: retryable,
          message: retryable
            ? 'Demande à confirmer · nouvelle vérification en cours.'
            : error instanceof Error
              ? error.message
              : 'Départ impossible.',
        });
        publish();
      } finally {
        flying.current.delete(intent.commandId);
      }
    },
    [slug, villageId, scope, publish, receive],
  );
  useEffect(() => {
    records.current.clear();
    checked.current = '';
    setEntries([]);
    if (!enabled) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* no local recovery */
      }
      return;
    }
    if (!scope) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? '[]') as Entry[];
      for (const item of saved)
        if (item.intent?.commandId && ['survey', 'explore'].includes(item.intent.action))
          records.current.set(item.intent.commandId, { ...item, uncertain: true });
    } catch {
      /* corrupt local recovery does not change authoritative data */
    }
    publish();
  }, [scope, enabled, key, publish]);
  // From the V2 stream: each receipt as the worker writes it.
  useEffect(() => {
    if (!enabled || !scope || !receipts) return;
    for (const receipt of receipts) receive(receipt);
    if (checked.current === scope) return;
    checked.current = scope;
    for (const intent of unsentIntents(records.current, receipts)) void send(intent);
  }, [receipts, enabled, scope, receive, send]);
  // A send that failed is sent again (idempotent): the stream cannot tell the
  // server never received it. Nothing is read.
  useEffect(() => {
    if (!enabled || !receipts) return;
    const retry = entries.flatMap((entry) => (entry.uncertain && entry.intent ? [entry.intent] : []));
    if (!retry.length) return;
    const timer = setTimeout(() => {
      for (const intent of retry) void send(intent);
    }, 3000);
    return () => clearTimeout(timer);
  }, [entries, enabled, receipts, send]);
  return {
    entries,
    submit: (command: Extract<ScienceCommand, { action: 'survey' | 'explore' }>) => {
      if (
        !active.current ||
        [...records.current.values()].filter(
          (e) => e.uncertain || e.receipt?.status === 'pending' || (!e.receipt && e.intent && !e.message),
        ).length >= 4
      )
        return;
      void send({ ...command, commandId: randomUUID() });
    },
  };
}
