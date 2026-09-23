import { z } from 'zod';

import { MAX_PASSWORD_BYTES } from '../domain/auth/password.js';

/**
 * Deliberately permissive. The application never sends mail, so the only job
 * here is to reject something that is obviously not an address; anything
 * stricter rejects valid addresses for no benefit.
 */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Enter an email address.')
  .max(254, 'That email address is too long.')
  .refine((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), 'Enter a valid email address.');

/**
 * The upper bound is not arbitrary: bcrypt ignores everything past 72 bytes, so
 * without it two different long passphrases could silently unlock one account.
 */
const password = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(MAX_PASSWORD_BYTES, `Use at most ${MAX_PASSWORD_BYTES} characters.`);

export const registerSchema = z.object({ email, password });

/** Login does not re-apply the strength rules; an old password must still work. */
export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
});
