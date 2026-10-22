export interface ServerEvent { event: string; data: string; id?: string }

/** Fetch SSE transport. Delivery is synchronous: the caller validates and
 * applies a batch before remembering its cursor. An SSE id is never a cursor. */
export async function readServerEvents(body: ReadableStream<Uint8Array>, options: {
  signal: AbortSignal;
  current: () => boolean;
  onEvent: (event: ServerEvent) => void;
  maxEventBytes?: number;
  maxBufferBytes?: number;
}): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  const maxEvent = options.maxEventBytes ?? 256 * 1024;
  const maxBuffer = options.maxBufferBytes ?? 1024 * 1024;
  let line = '', data: string[] = [], event = '', id: string | undefined;
  let bytes = 0, carriageReturn = false, first = true;
  const active = () => !options.signal.aborted && options.current();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  function endLine() {
    if (!line) {
      if (data.length && active()) options.onEvent({ event: event || 'message', data: data.join('\n'), ...(id === undefined ? {} : { id }) });
      data = []; event = ''; id = undefined; bytes = 0;
    } else if (!line.startsWith(':')) {
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'event') event = value;
      else if (field === 'id' && !value.includes('\0')) id = value;
    }
    line = '';
  }
  function consume(text: string) {
    for (const character of text) {
      if (!active()) return;
      if (first) { first = false; if (character === '\uFEFF') continue; }
      if (carriageReturn && character === '\n') { carriageReturn = false; continue; }
      carriageReturn = character === '\r';
      bytes += encoder.encode(character).length;
      if (bytes > maxEvent) throw new Error('SSE_EVENT_TOO_LARGE');
      if (character === '\r' || character === '\n') endLine();
      else line += character;
    }
  }
  options.signal.addEventListener('abort', abort, { once: true });
  try {
    while (active()) {
      const chunk = await reader.read();
      if (!active()) break;
      if (chunk.done) { consume(decoder.decode()); break; }
      if (chunk.value.byteLength > maxBuffer) throw new Error('SSE_BUFFER_TOO_LARGE');
      consume(decoder.decode(chunk.value, { stream: true }));
    }
    // An unterminated event is deliberately discarded. A reconnect resumes
    // from applied state, including when EOF cuts through a data line.
  } finally {
    options.signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
