import { createHash, randomBytes } from 'node:crypto';

/**
 * The session id is a bearer credential: whoever holds it is the user. So it is
 * treated like one.
 *
 * - 32 bytes from `randomBytes` — not guessable, so no rate limit or lockout is
 *   needed on the lookup itself.
 * - Only SHA-256 of the id is ever stored. A dump of the sessions collection
 *   yields nothing that can be replayed, exactly as with password hashes.
 * - Because the id is high-entropy, a plain digest is enough; there is nothing
 *   to brute force, so no salt or KDF is warranted here.
 *
 * The raw id exists in precisely two places: the Set-Cookie header on the way
 * out, and the Cookie header on the way in. It is never logged, never stored,
 * and never put in a response body.
 */
const SESSION_ID_BYTES = 32;

export function createSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString('base64url');
}

export function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex');
}
