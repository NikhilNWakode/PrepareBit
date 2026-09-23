import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../domain/errors.js';

interface Window {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

/**
 * A fixed window counter held in memory, which is the right size of solution
 * for a single API instance. It is not shared across processes: if this ever
 * runs on more than one instance the limit becomes per-instance, and the real
 * fix is a shared store rather than a cleverer local one. Noted in the README.
 */
export function rateLimit({ windowMs, max }: RateLimitOptions) {
  const windows = new Map<string, Window>();

  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();

    // Opportunistic pruning keeps the map from growing without bound.
    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key);
    }

    const key = req.ip ?? 'unknown';
    const existing = windows.get(key);

    if (!existing) {
      windows.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    existing.count += 1;

    if (existing.count > max) {
      next(new AppError('VALIDATION_FAILED', 'Too many attempts. Try again shortly.', 429));
      return;
    }

    next();
  };
}
