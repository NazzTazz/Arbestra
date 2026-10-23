import { expect, it } from 'vitest';
import { readServerEvents, type ServerEvent } from './sse-reader';

const encode = (text: string) => new TextEncoder().encode(text);
function stream(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}
it('decodes every UTF-8/CRLF split and delivers only complete multiline events', async () => {
  const wire = encode(
    '\uFEFF: heartbeat\r\nevent: delta\r\nid: received-only\r\ndata: été 🐈\r\ndata: seconde\r\n\r\ndata: unfinished',
  );
  for (let cut = 0; cut <= wire.length; cut++) {
    const events: ServerEvent[] = [];
    await readServerEvents(stream([wire.slice(0, cut), wire.slice(cut)]), {
      signal: new AbortController().signal,
      current: () => true,
      onEvent: (event) => events.push(event),
    });
    expect(events).toEqual([{ event: 'delta', id: 'received-only', data: 'été 🐈\nseconde' }]);
  }
});
it('handles one-byte chunks, bare CR, comments, empty data, ignored fields and NUL ids', async () => {
  const events: ServerEvent[] = [];
  const wire = encode(':ignore\rdata\rid: bad\0id\rretry: 1\runknown: x\r\revent: receipt\ndata: {}\n\n');
  await readServerEvents(stream([...wire].map((byte) => Uint8Array.of(byte))), {
    signal: new AbortController().signal,
    current: () => true,
    onEvent: (event) => events.push(event),
  });
  expect(events).toEqual([
    { event: 'message', data: '' },
    { event: 'receipt', data: '{}' },
  ]);
});
it('invalidates callbacks immediately when applying an event changes generation', async () => {
  const events: ServerEvent[] = [];
  let current = true;
  await readServerEvents(stream([encode('data: first\n\ndata: old\n\n')]), {
    signal: new AbortController().signal,
    current: () => current,
    onEvent: (event) => {
      events.push(event);
      current = false;
    },
  });
  expect(events.map((event) => event.data)).toEqual(['first']);
});
it('aborts a pending read and releases the stream lock', async () => {
  const abort = new AbortController();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const run = readServerEvents(body, {
    signal: abort.signal,
    current: () => true,
    onEvent: () => {
      throw Error('Unexpected event');
    },
  });
  abort.abort();
  await run;
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
});
it('rejects excessive events, excessive buffers and malformed UTF-8 without delivering a partial event', async () => {
  for (const [chunks, options, error] of [
    [[encode('data: 123456789')], { maxEventBytes: 8 }, 'SSE_EVENT_TOO_LARGE'],
    [[encode('data: a\n\n')], { maxBufferBytes: 4 }, 'SSE_BUFFER_TOO_LARGE'],
    [[Uint8Array.of(0xff)], {}, 'encoded data'],
  ] as const) {
    const body = stream([...chunks]);
    const events: ServerEvent[] = [];
    await expect(
      readServerEvents(body, {
        ...options,
        signal: new AbortController().signal,
        current: () => true,
        onEvent: (event) => events.push(event),
      }),
    ).rejects.toThrow(error);
    expect(events).toEqual([]);
    expect(body.locked).toBe(false);
  }
});
