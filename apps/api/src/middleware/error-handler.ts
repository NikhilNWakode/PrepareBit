import type { ApiErrorBody } from '@prep/shared';
import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';
import { AppError } from '../domain/errors.js';
import { logger } from '../logger.js';

/**
 * The single place an error becomes an HTTP response. Clients get a code and a
 * safe message; stack traces stay in the server log.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const isKnown = error instanceof AppError;
  const statusCode = isKnown ? error.statusCode : 500;

  const body: ApiErrorBody = {
    error: {
      code: isKnown ? error.code : 'INTERNAL_ERROR',
      message: isKnown ? error.message : 'An unexpected error occurred.',
    },
  };

  if (!isKnown || statusCode >= 500) {
    logger.error('unhandled request failure', {
      method: req.method,
      path: req.originalUrl,
      status: statusCode,
      message: error instanceof Error ? error.message : String(error),
    });
    if (!env.isProduction && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
  }

  res.status(statusCode).json(body);
}
