import { describe, expect, it } from 'vitest';

import { hashPassword, verifyAgainstAbsentUser, verifyPassword } from './password.js';

/**
 * bcrypt at cost 12 is slow on purpose — that is the entire point of a password
 * hash. Each call takes a few hundred milliseconds normally, and considerably
 * longer when the rest of the suite is competing for the same CPU.
 *
 * These get an explicit timeout rather than the 5s default, because a test that
 * passes alone and fails in a full run is worse than no test: it teaches people
 * to re-run until green.
 */
const BCRYPT_TIMEOUT_MS = 30_000;

describe('password hashing', () => {
  it(
    'verifies a password against its own hash',
    async () => {
      const hash = await hashPassword('correct horse battery staple');
      await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
    },
    BCRYPT_TIMEOUT_MS,
  );

  it(
    'rejects the wrong password',
    async () => {
      const hash = await hashPassword('correct horse battery staple');
      await expect(verifyPassword('Correct horse battery staple', hash)).resolves.toBe(false);
    },
    BCRYPT_TIMEOUT_MS,
  );

  it(
    'salts, so the same password never produces the same hash twice',
    async () => {
      const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);

      expect(first).not.toBe(second);
      await expect(verifyPassword('same', first)).resolves.toBe(true);
      await expect(verifyPassword('same', second)).resolves.toBe(true);
    },
    BCRYPT_TIMEOUT_MS,
  );

  it(
    'never succeeds against the absent-user hash',
    async () => {
      await expect(verifyAgainstAbsentUser('anything at all')).resolves.toBe(false);
    },
    BCRYPT_TIMEOUT_MS,
  );
});
