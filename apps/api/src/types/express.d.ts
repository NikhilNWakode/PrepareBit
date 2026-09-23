/**
 * The authenticated principal, attached by `requireAuth` and by nothing else.
 *
 * It holds only the user id, so the hot path stays at one database lookup. The
 * rule every later phase depends on: a handler reads the acting user from here,
 * never from a request body, query string or path parameter.
 */
declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string };
    }
  }
}

export {};
