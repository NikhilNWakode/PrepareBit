import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../domain/errors.js';
import { rateLimit } from './rate-limit.js';

function callerFrom(ip: string) {
  return { ip } as Request;
}

function run(limiter: ReturnType<typeof rateLimit>, req: Request): unknown {
  let captured: unknown;
  const next = ((error?: unknown) => {
    captured = error;
  }) as NextFunction;

  limiter(req, {} as Response, next);
  return captured;
}

describe('rateLimit', () => {
  it('allows requests up to the limit and rejects the next one', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3 });
    const caller = callerFrom('10.0.0.1');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(run(limiter, caller)).toBeUndefined();
    }

    const rejected = run(limiter, caller);
    expect(rejected).toBeInstanceOf(AppError);
    expect((rejected as AppError).statusCode).toBe(429);
  });

  it('counts each caller separately', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1 });

    expect(run(limiter, callerFrom('10.0.0.1'))).toBeUndefined();
    expect(run(limiter, callerFrom('10.0.0.2'))).toBeUndefined();
    expect(run(limiter, callerFrom('10.0.0.1'))).toBeInstanceOf(AppError);
  });

  it('lets a caller back in once the window has passed', () => {
    vi.useFakeTimers();
    try {
      const limiter = rateLimit({ windowMs: 60_000, max: 1 });
      const caller = callerFrom('10.0.0.1');

      expect(run(limiter, caller)).toBeUndefined();
      expect(run(limiter, caller)).toBeInstanceOf(AppError);

      vi.advanceTimersByTime(60_001);
      expect(run(limiter, caller)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
