import { describe, expect, it } from 'vitest';

import { hashPassword, verifyAgainstAbsentUser, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies a password against its own hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('Correct horse battery staple', hash)).resolves.toBe(false);
  });

  it('salts, so the same password never produces the same hash twice', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);

    expect(first).not.toBe(second);
    await expect(verifyPassword('same', first)).resolves.toBe(true);
    await expect(verifyPassword('same', second)).resolves.toBe(true);
  });

  it('never succeeds against the absent-user hash', async () => {
    await expect(verifyAgainstAbsentUser('anything at all')).resolves.toBe(false);
  });
});
