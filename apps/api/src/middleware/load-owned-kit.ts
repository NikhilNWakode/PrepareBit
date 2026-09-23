import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../domain/errors.js';
import { kitService } from '../services/kit.service.js';

/**
 * Runs after `requireAuth` and resolves `:id` to a kit the caller owns.
 *
 * The owner comes from the validated session and never from the request, which
 * is the invariant the whole application rests on:
 *
 *   authenticated session userId -> Kit.userId -> repository query
 */
export async function loadOwnedKit(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.auth) throw new AppError('AUTH_REQUIRED', 'You must be signed in.', 401);

    const kitId = req.params['id'];
    if (typeof kitId !== 'string')
      throw new AppError('KIT_NOT_FOUND', 'That kit does not exist.', 404);

    req.kit = await kitService.getOwned(req.auth.userId, kitId);
    next();
  } catch (error) {
    next(error);
  }
}
