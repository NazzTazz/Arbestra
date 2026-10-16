import { describe, expect, it } from 'vitest';
import { AttemptLimiter } from './attempt-limiter.js';

describe('authentication attempt limits', () => {
  it('limits a normalized identity even when the caller changes IP', () => {
    const limiter = new AttemptLimiter();
    limiter.login('192.0.2.1', 'Admin@Example.test', { ip: 10, identity: 2 });
    limiter.login('192.0.2.2', ' admin@example.test ', { ip: 10, identity: 2 });
    expect(() => limiter.login('192.0.2.3', 'admin@example.test', { ip: 10, identity: 2 }))
      .toThrow(expect.objectContaining({ code: 'TOO_MANY_ATTEMPTS' }));
  });

  it('limits password spraying by IP and does not extend an exhausted window', () => {
    let now = 0;
    const limiter = new AttemptLimiter(1000, 100, () => now);
    limiter.login('192.0.2.1', 'one@example.test', { ip: 2, identity: 5 });
    now = 500;
    limiter.login('192.0.2.1', 'two@example.test', { ip: 2, identity: 5 });
    now = 900;
    expect(() => limiter.login('192.0.2.1', 'three@example.test', { ip: 2, identity: 5 })).toThrow();
    now = 1001;
    expect(() => limiter.login('192.0.2.1', 'three@example.test', { ip: 2, identity: 5 })).not.toThrow();
  });

  it('fails closed at the memory bound and admits requests after expiry', () => {
    let now = 0;
    const limiter = new AttemptLimiter(1000, 2, () => now);
    limiter.login('192.0.2.1', 'one@example.test');
    expect(limiter.size).toBe(2);
    expect(() => limiter.login('192.0.2.2', 'two@example.test')).toThrow();
    expect(limiter.size).toBe(2);
    now = 1000;
    expect(() => limiter.login('192.0.2.2', 'two@example.test')).not.toThrow();
    expect(limiter.size).toBe(2);
  });
});
