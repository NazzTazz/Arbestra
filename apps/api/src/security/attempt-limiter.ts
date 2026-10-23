import { createHash } from 'node:crypto';

import { HttpError } from '../errors.js';

/** Fixed windows, bounded memory, and no raw credential identifiers retained. */
export class AttemptLimiter {
  private readonly entries = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly windowMs = 15 * 60_000,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  consume(buckets: readonly { key: string; maximum: number }[]): void {
    const now = this.now();
    // Entries are inserted in expiry order; an increment never extends a window.
    for (const [key, entry] of this.entries) {
      if (entry.until > now) break;
      this.entries.delete(key);
    }
    const keys = buckets.map((bucket) => ({
      key: createHash('sha256').update(bucket.key).digest('hex'),
      maximum: bucket.maximum,
    }));
    const missing = new Set(keys.filter((bucket) => !this.entries.has(bucket.key)).map((bucket) => bucket.key));
    if (
      this.entries.size + missing.size > this.maxEntries ||
      keys.some((bucket) => (this.entries.get(bucket.key)?.count ?? 0) >= bucket.maximum)
    ) {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Trop de tentatives. Réessayez dans quelques minutes.');
    }
    for (const { key } of keys) {
      const entry = this.entries.get(key) ?? { count: 0, until: now + this.windowMs };
      entry.count++;
      this.entries.set(key, entry);
    }
  }

  login(ip: string, email: string, limits = { ip: 60, identity: 15 }): void {
    this.consume([
      { key: `login:ip:${ip}`, maximum: limits.ip },
      { key: `login:identity:${email.trim().toLowerCase()}`, maximum: limits.identity },
    ]);
  }
}
