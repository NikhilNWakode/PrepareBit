import bcrypt from 'bcryptjs';

/**
 * bcryptjs rather than bcrypt or argon2: it is pure JavaScript, so there is no
 * node-gyp step to fail on Windows or on a free-tier Linux builder. The speed
 * difference does not matter at this scale.
 */
const COST_FACTOR = 12;

/**
 * bcrypt only considers the first 72 bytes of input. Rather than silently
 * truncating a long passphrase, registration rejects anything longer.
 */
export const MAX_PASSWORD_BYTES = 72;

/**
 * A valid bcrypt hash of a value nobody knows. Login compares against this when
 * the email does not exist, so a missing account costs the same time as a wrong
 * password and the response cannot be used to enumerate users.
 */
const ABSENT_USER_HASH = '$2b$12$MpEES./ucEpgl6jUp6vrUOXHKlYN0bMdEEs8ePQZdBFnG9lWIoRQy';

export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, COST_FACTOR);
}

export function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/** Burns the same work as a real verification, then always fails. */
export async function verifyAgainstAbsentUser(plaintext: string): Promise<false> {
  await bcrypt.compare(plaintext, ABSENT_USER_HASH);
  return false;
}
