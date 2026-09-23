import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../domain/errors.js';
import { kitService } from '../services/kit.service.js';

/** Thin: translate HTTP, call a service. No queries reach this layer. */
export const kitController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth) throw new AppError('AUTH_REQUIRED', 'You must be signed in.', 401);
      res.json({ kits: await kitService.list(req.auth.userId) });
    } catch (error) {
      next(error);
    }
  },

  /** `loadOwnedKit` has already proved ownership, so this only serialises. */
  get(req: Request, res: Response, next: NextFunction): void {
    try {
      if (!req.kit) throw new AppError('KIT_NOT_FOUND', 'That kit does not exist.', 404);
      res.json({ kit: req.kit });
    } catch (error) {
      next(error);
    }
  },
};
