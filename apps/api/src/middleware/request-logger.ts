import type { NextFunction, Request, Response } from 'express';

import { logger } from '../logger.js';

/** One line per completed request. Enough to follow a flow in development. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info(`${req.method} ${req.originalUrl}`, {
      status: res.statusCode,
      duration: `${durationMs.toFixed(0)}ms`,
    });
  });

  next();
}
