import { describe, expect, it } from 'vitest';

import { createSessionToken, hashSessionToken } from './sessions.js';

describe('sessions', () => {
  it('creates high-entropy opaque tokens and stores only a stable hash', () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first).not.toBe(second);
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(hashSessionToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(first)).toBe(hashSessionToken(first));
    expect(hashSessionToken(first)).not.toBe(hashSessionToken(second));
  });
});
