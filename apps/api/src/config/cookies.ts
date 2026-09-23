import type { CookieOptions, Response } from 'express';

import { env } from './env.js';

export const SESSION_COOKIE_NAME = 'sid';

/** Absolute, not sliding: a rolling window would cost a database write on every request. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The cookie is signed with COOKIE_SECRET. That is integrity, not secrecy — the
 * id is already 32 random bytes and only its hash is stored. Signing lets a
 * tampered or truncated cookie be rejected before it costs a database lookup.
 *
 * No `domain` is set, so the cookie binds to the host it came back through.
 * In deployment that is the Next.js origin, which is why SameSite=Lax is
 * sufficient and no third-party cookie is involved.
 */
function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
  };
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE_NAME, sessionId, { ...baseOptions(), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response): void {
  // Must mirror the original attributes or the browser keeps the old cookie.
  res.clearCookie(SESSION_COOKIE_NAME, baseOptions());
}
