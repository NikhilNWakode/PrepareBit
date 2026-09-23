/**
 * The authenticated principal, attached by `requireAuth` and by nothing else.
 *
 * It holds only the user id, so the hot path stays at one database lookup. The
 * rule every later phase depends on: a handler reads the acting user from here,
 * never from a request body, query string or path parameter.
 */
import type { StoredKit } from '../repositories/kit.repository.js';

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string };
      /** Set by `loadOwnedKit` once the caller's ownership has been proved. */
      kit?: StoredKit;
    }
  }
}

export {};
