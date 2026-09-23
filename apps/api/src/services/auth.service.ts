import { AppError } from '../domain/errors.js';
import { hashPassword, verifyAgainstAbsentUser, verifyPassword } from '../domain/auth/password.js';
import { createSessionId, hashSessionId } from '../domain/auth/session-token.js';
import { SESSION_TTL_MS } from '../config/cookies.js';
import { sessionRepository } from '../repositories/session.repository.js';
import { isDuplicateKeyError, userRepository } from '../repositories/user.repository.js';

import type { AuthUser } from '@prep/shared';

/**
 * The session id is returned so the HTTP layer can put it in a Set-Cookie
 * header. It must not reach a response body or a log line.
 */
export interface AuthResult {
  user: AuthUser;
  sessionId: string;
}

/** Identical for an unknown email and a wrong password, so neither can be distinguished. */
function invalidCredentials(): AppError {
  return new AppError('AUTH_REQUIRED', 'Email or password is incorrect.', 401);
}

function emailTaken(): AppError {
  return new AppError('VALIDATION_FAILED', 'That email is already registered.', 409);
}

async function openSession(userId: string): Promise<string> {
  const sessionId = createSessionId();
  await sessionRepository.create(
    hashSessionId(sessionId),
    userId,
    new Date(Date.now() + SESSION_TTL_MS),
  );
  return sessionId;
}

export const authService = {
  async register(email: string, password: string): Promise<AuthResult> {
    if (await userRepository.existsByEmail(email)) throw emailTaken();

    let user;
    try {
      user = await userRepository.create(email, await hashPassword(password));
    } catch (error) {
      // Two registrations for the same address can both clear the check above;
      // the unique index settles it and the loser gets the same 409.
      if (isDuplicateKeyError(error)) throw emailTaken();
      throw error;
    }

    return { user, sessionId: await openSession(user.id) };
  },

  async login(email: string, password: string): Promise<AuthResult> {
    const found = await userRepository.findByEmailWithHash(email);

    // Still hashes when the account is absent, so both paths take the same time.
    const passwordMatches = found
      ? await verifyPassword(password, found.passwordHash)
      : await verifyAgainstAbsentUser(password);

    if (!found || !passwordMatches) throw invalidCredentials();

    const user: AuthUser = { id: found.id, email: found.email };
    return { user, sessionId: await openSession(user.id) };
  },

  async logout(sessionId: string): Promise<void> {
    await sessionRepository.deleteByHash(hashSessionId(sessionId));
  },

  async getUser(userId: string): Promise<AuthUser> {
    const user = await userRepository.findById(userId);
    if (!user) throw new AppError('AUTH_REQUIRED', 'Session is no longer valid.', 401);
    return user;
  },
};
