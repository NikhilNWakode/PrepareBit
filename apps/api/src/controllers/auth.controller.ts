import type { NextFunction, Request, Response } from 'express';

import { clearSessionCookie, SESSION_COOKIE_NAME, setSessionCookie } from '../config/cookies.js';
import { AppError } from '../domain/errors.js';
import { authService } from '../services/auth.service.js';

/**
 * Thin by design: translate HTTP to a service call and back. Note that
 * `sessionId` only ever reaches `setSessionCookie` — it is never serialised
 * into a response body.
 */
export const authController = {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const { user, sessionId } = await authService.register(email, password);

      setSessionCookie(res, sessionId);
      res.status(201).json({ user });
    } catch (error) {
      next(error);
    }
  },

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const { user, sessionId } = await authService.login(email, password);

      setSessionCookie(res, sessionId);
      res.json({ user });
    } catch (error) {
      next(error);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sessionId: unknown = req.signedCookies?.[SESSION_COOKIE_NAME];
      if (typeof sessionId === 'string' && sessionId.length > 0) {
        await authService.logout(sessionId);
      }

      // Cleared unconditionally so a stale cookie cannot survive a failed logout.
      clearSessionCookie(res);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },

  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new AppError('AUTH_REQUIRED', 'You must be signed in.', 401);
      res.json({ user: await authService.getUser(req.auth.userId) });
    } catch (error) {
      next(error);
    }
  },
};
