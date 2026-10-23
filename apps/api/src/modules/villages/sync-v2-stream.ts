import type { FastifyReply } from 'fastify';
import type { SyncV2Batch, SyncV2ReadRequest } from '@arbestra/contracts';
import type { SyncCursor } from './sync-v2-journal.js';
import { HttpError } from '../../errors.js';

type StreamOptions = { pollMs?: number; onError?: (error: unknown) => void };

export async function serveSyncV2Stream(
  reply: FastifyReply,
  initial: SyncV2ReadRequest,
  read: (request: SyncV2ReadRequest) => Promise<SyncV2Batch>,
  options: StreamOptions = {},
): Promise<void> {
  const first = await read(initial);
  return serveBatches(
    reply,
    first,
    (batch) =>
      read({
        ...initial,
        scopes: batch.groups.map((group) => ({ kind: group.stream.kind, key: group.stream.key })),
        cursors: batch.groups.map((group) => ({ ...group.stream, revision: group.toRevision })),
      }),
    options,
  );
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
  const first = await read(initial);
  return serveBatches(
    reply,
    first,
    (batch) => read({ epoch: batch.groups[0]!.stream.epoch, revision: batch.groups[0]!.toRevision }),
    options,
  );
}

async function serveBatches(
  reply: FastifyReply,
  first: SyncV2Batch,
  readNext: (last: SyncV2Batch) => Promise<SyncV2Batch>,
  options: StreamOptions,
): Promise<void> {
  // Authorization and the first coherent capture complete before HTTP 200.
  let batch = first,
    closed = false;
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
  const pause = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        reply.raw.off('close', done);
        resolve();
      };
      const timer = setTimeout(done, options.pollMs ?? 2000);
      timer.unref();
      reply.raw.once('close', done);
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
      if (!closed) batch = await readNext(batch);
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
