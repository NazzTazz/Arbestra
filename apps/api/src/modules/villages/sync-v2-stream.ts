import type { FastifyReply } from 'fastify';
import type { SyncV2Batch, SyncV2ReadRequest } from '@arbestra/contracts';
import type { SyncCursor } from './sync-v2-journal.js';
import type { SyncWakeSource, SyncWakeSubscription } from './sync-v2-wakeups.js';
import { HttpError } from '../../errors.js';

/** Period of a stream's reads when nothing wakes it. */
export const SYNC_V2_POLL_MS = 2000;
/** With wakeups, the periodic read is a backstop: a lost notification, and
 * what never notifies (expired or revoked session, ownership change, raised
 * retention floor) are seen at most this late. */
export const SYNC_V2_BACKSTOP_MS = 30_000;
/** Spec §8.4, nominal grouping at most 50 ms: a wake reads at once, unless the
 * previous batch went out less than this long ago. */
export const SYNC_V2_COALESCE_MS = 50;

type StreamOptions = {
  /** Periodic read: SYNC_V2_POLL_MS without wakeups, SYNC_V2_BACKSTOP_MS with. */
  pollMs?: number;
  wakeups?: SyncWakeSource | undefined;
  coalesceMs?: number;
  onError?: (error: unknown) => void;
};

export async function serveSyncV2Stream(
  reply: FastifyReply,
  initial: SyncV2ReadRequest,
  read: (request: SyncV2ReadRequest) => Promise<SyncV2Batch>,
  options: StreamOptions = {},
): Promise<void> {
  // Subscribed before the first capture: a publication committed after its
  // snapshot is seen by the next read instead of waiting for the backstop.
  const wake = options.wakeups?.subscribe();
  try {
    const first = await read(initial);
    return await serveBatches(
      reply,
      first,
      (batch) =>
        read({
          ...initial,
          scopes: batch.groups.map((group) => ({ kind: group.stream.kind, key: group.stream.key })),
          cursors: batch.groups.map((group) => ({ ...group.stream, revision: group.toRevision })),
        }),
      options,
      wake,
    );
  } finally {
    wake?.close();
  }
}

/** Single-flight private stream transport. The reader must recheck current
 * authorization on every capture. This helper does not register/activate a
 * route and cannot replace the multi-stream dependency closure. */
export async function servePrivateSyncStream(
  reply: FastifyReply,
  initial: SyncCursor,
  read: (cursor: SyncCursor) => Promise<SyncV2Batch>,
  options: StreamOptions = {},
): Promise<void> {
  const wake = options.wakeups?.subscribe();
  try {
    const first = await read(initial);
    return await serveBatches(
      reply,
      first,
      (batch) => read({ epoch: batch.groups[0]!.stream.epoch, revision: batch.groups[0]!.toRevision }),
      options,
      wake,
    );
  } finally {
    wake?.close();
  }
}

async function serveBatches(
  reply: FastifyReply,
  first: SyncV2Batch,
  readNext: (last: SyncV2Batch) => Promise<SyncV2Batch>,
  options: StreamOptions,
  wake: SyncWakeSubscription | undefined,
): Promise<void> {
  // Authorization and the first coherent capture complete before HTTP 200.
  let batch = first,
    closed = false;
  // Every read covers the streams of the first capture (the request's scopes
  // and the implicit private stream), so the wake index is set once.
  wake?.watch(
    first.worldId,
    first.groups.map((group) => group.stream),
  );
  const pollMs = options.pollMs ?? (wake ? SYNC_V2_BACKSTOP_MS : SYNC_V2_POLL_MS),
    coalesceMs = options.coalesceMs ?? SYNC_V2_COALESCE_MS;
  if (reply.raw.destroyed) return;
  const close = () => {
    closed = true;
  };
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  });
  reply.raw.once('close', close);
  const write = async (wire: string) => {
    if (closed || reply.raw.destroyed) return;
    if (reply.raw.writableLength + Buffer.byteLength(wire) > 1_048_576) throw Error('SYNC_V2_SLOW_CONSUMER');
    if (reply.raw.write(wire)) return;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        reply.raw.off('drain', drain);
        reply.raw.off('close', ended);
        reply.raw.off('error', failed);
        if (error) reject(error);
        else resolve();
      };
      const drain = () => finish(),
        ended = () => finish(),
        failed = (error: Error) => finish(error);
      const timer = setTimeout(() => finish(Error('SYNC_V2_SLOW_CONSUMER')), 5000);
      timer.unref();
      reply.raw.once('drain', drain);
      reply.raw.once('close', ended);
      reply.raw.once('error', failed);
    });
  };
  // Ends at the periodic read, on close, or on a wake (at once if one came
  // during the previous read or write), never sooner than coalesceMs after
  // the previous batch went out.
  const pause = () =>
    new Promise<void>((resolve) => {
      const since = Date.now();
      let grouped: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        clearTimeout(timer);
        clearTimeout(grouped);
        wake?.listen(undefined);
        reply.raw.off('close', done);
        resolve();
      };
      const woken = () => {
        if (grouped) return;
        grouped = setTimeout(done, Math.max(0, since + coalesceMs - Date.now()));
        grouped.unref();
      };
      const timer = setTimeout(done, pollMs);
      timer.unref();
      reply.raw.once('close', done);
      wake?.listen(woken);
    });
  try {
    while (!closed) {
      if (batch.coverage !== 'delta') {
        await write('event: reset\ndata: {"reason":"scope-snapshot-required"}\n\n');
        break;
      }
      if (batch.groups.some((group) => group.changes.length || group.fromRevision !== group.toRevision)) {
        const wire = `event: batch\ndata: ${JSON.stringify(batch)}\n\n`;
        if (Buffer.byteLength(wire) > 256 * 1024) {
          await write('event: reset\ndata: {"reason":"batch-too-large"}\n\n');
          break;
        }
        await write(wire);
      } else await write(`event: heartbeat\ndata: ${JSON.stringify({ observedAt: batch.observedAt })}\n\n`);
      // This is only this connection's send position. A reconnect always
      // takes the client's applied cursor, never this value or Last-Event-ID.
      if (closed) break;
      await pause();
      if (closed) break;
      // Cleared before the read's snapshot: a publication it misses wakes again.
      wake?.clear();
      batch = await readNext(batch);
    }
  } catch (error) {
    if (!closed && error instanceof HttpError && error.statusCode === 401)
      await write('event: expired\ndata: {}\n\n').catch(() => undefined);
    if (!closed) options.onError?.(error);
  } finally {
    reply.raw.off('close', close);
    if (!reply.raw.destroyed) reply.raw.end();
  }
}
