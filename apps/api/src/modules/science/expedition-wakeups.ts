import pg from 'pg';
export class ExpeditionWakeups {
  private client: pg.Client | undefined;
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<(worldId: string, villageId: string) => void>();
  private listening = false;
  private lastSuccessAt: string | null = null;
  private lastErrorAt: string | null = null;
  get observation() {
    return {
      connected: this.listening,
      closed: this.closed,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
    };
  }
  constructor(
    private url: string,
    private onError: (e: unknown) => void = () => {},
  ) {}
  subscribe(fn: (worldId: string, villageId: string) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  async start() {
    if (this.closed || this.client) return;
    const client = new pg.Client({ connectionString: this.url });
    this.client = client;
    client.on('notification', (message) => {
      try {
        const p = JSON.parse(message.payload ?? '{}') as { worldId: string; villageId: string };
        if (typeof p.worldId === 'string' && typeof p.villageId === 'string')
          for (const fn of this.listeners) fn(p.worldId, p.villageId);
      } catch {
        /* periodic durable read covers malformed wakeups */
      }
    });
    client.on('error', (error) => {
      this.lastErrorAt = new Date().toISOString();
      this.onError(error);
      void this.reconnect(client);
    });
    client.on('end', () => {
      if (!this.closed) void this.reconnect(client);
    });
    try {
      await client.connect();
      await client.query('LISTEN arbestra_expeditions');
      this.listening = true;
      this.lastSuccessAt = new Date().toISOString();
    } catch (error) {
      this.lastErrorAt = new Date().toISOString();
      this.onError(error);
      await this.reconnect(client);
    }
  }
  private async reconnect(client: pg.Client) {
    if (this.client !== client) return;
    this.listening = false;
    this.client = undefined;
    await client.end().catch(() => {});
    if (!this.closed) this.retry = setTimeout(() => void this.start(), 1000);
  }
  async close() {
    this.closed = true;
    this.listening = false;
    if (this.retry) clearTimeout(this.retry);
    this.listeners.clear();
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => {});
  }
}
