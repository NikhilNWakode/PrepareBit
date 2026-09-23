import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

import { AppError } from '../domain/errors.js';

/**
 * Parses and *replaces* the request body with the validated result, so handlers
 * downstream receive typed, trimmed, normalised input and never the raw JSON.
 */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const fields = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      next(AppError.validationFailed('The submitted values are not valid.', fields));
      return;
    }

    req.body = result.data;
    next();
  };
}
