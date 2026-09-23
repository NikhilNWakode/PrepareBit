import type { NextFunction, Request, Response } from 'express';

import { clearSessionCookie, SESSION_COOKIE_NAME } from '../config/cookies.js';
import { hashSessionId } from '../domain/auth/session-token.js';
import { AppError } from '../domain/errors.js';
import { sessionRepository } from '../repositories/session.repository.js';

function authRequired(): AppError {
  return new AppError('AUTH_REQUIRED', 'You must be signed in to do that.', 401);
}

/**
 * Resolves the signed session cookie to a user id, or fails with 401.
 *
 * Expiry is judged on `expiresAt` rather than on the row's absence, because
 * MongoDB's TTL monitor only sweeps about once a minute and an expired session
 * would otherwise keep working in that window.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // An unsigned or tampered cookie never appears here, so it costs no query.
  const sessionId: unknown = req.signedCookies?.[SESSION_COOKIE_NAME];

  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    next(authRequired());
    return;
  }

  try {
    const session = await sessionRepository.findActive(hashSessionId(sessionId), new Date());

    if (!session) {
      // Revoked or expired: stop the browser sending it again.
      clearSessionCookie(res);
      next(authRequired());
      return;
    }

    req.auth = { userId: session.userId };
    next();
  } catch (error) {
    next(error);
  }
}
