import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './passwords.js';

describe('passwords', () => {
  it('verifies a password hashed with scrypt', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', encoded)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', encoded)).resolves.toBe(false);
  });

  it('rejects malformed stored values', async () => {
    await expect(verifyPassword('anything', 'not-a-password-hash')).resolves.toBe(false);
  });
});
