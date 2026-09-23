import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../domain/errors.js';

/** Terminal route: anything unmatched becomes a structured 404. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`No route matches ${req.method} ${req.originalUrl}`));
}
