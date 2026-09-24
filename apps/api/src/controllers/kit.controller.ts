import type { NextFunction, Request, Response } from 'express';

import { batchCaseSchema } from '../batch/batch-contract.js';
import { AppError } from '../domain/errors.js';
import { kitService } from '../services/kit.service.js';
import type { CreateKitBody } from '../validators/kit.validators.js';

/** Thin: translate HTTP, call a service. No queries reach this layer. */

function requireUserId(req: Request): string {
  if (!req.auth) throw new AppError('AUTH_REQUIRED', 'You must be signed in.', 401);
  return req.auth.userId;
}

export const kitController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json({ kits: await kitService.list(requireUserId(req)) });
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

  /**
   * Returns 202 immediately. A generation takes about a minute, which is not
   * something an HTTP request should hold open — the client polls `/status`.
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as CreateKitBody;

      const { kit, reused } = await kitService.create(requireUserId(req), {
        jd: body.jd,
        company_url: body.company_url,
        days: body.days,
      });

      // `reused` lets the interface say it is showing an existing kit rather
      // than silently appearing to do nothing.
      res.status(202).json({ id: kit.id, status: kit.status, reused });
    } catch (error) {
      next(error);
    }
  },

  /** Deliberately small: this is polled, so it carries only what the screen needs. */
  status(req: Request, res: Response, next: NextFunction): void {
    try {
      const kit = req.kit;
      if (!kit) throw new AppError('KIT_NOT_FOUND', 'That kit does not exist.', 404);

      res.json({
        id: kit.id,
        status: kit.status,
        step: kit.progress?.step ?? '',
        completedSteps: kit.progress?.completedSteps ?? 0,
        totalSteps: kit.progress?.totalSteps ?? 0,
        error: kit.error,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Several roles at once, from a file in the same shape the evaluate command
   * reads — one contract, one validator, and a file a user can prepare offline.
   *
   * Rows are validated individually so one bad row does not reject the file.
   */
  async createBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = requireUserId(req);
      const body: unknown = req.body;

      const rows: unknown[] = Array.isArray(body)
        ? body
        : typeof body === 'object' &&
            body !== null &&
            Array.isArray((body as { cases?: unknown }).cases)
          ? (body as { cases: unknown[] }).cases
          : [];

      if (rows.length === 0) {
        throw AppError.validationFailed(
          'Upload a JSON array of cases, each with jd, company_url and days.',
        );
      }

      const accepted: { index: number; id: string; kitId: string; reused: boolean }[] = [];
      const rejected: { index: number; id: string | null; reason: string }[] = [];

      for (const [index, row] of rows.entries()) {
        const parsed = batchCaseSchema.safeParse(row);

        if (!parsed.success) {
          rejected.push({
            index,
            id:
              typeof (row as { id?: unknown })?.id === 'string' ? (row as { id: string }).id : null,
            reason: parsed.error.issues
              .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
              .join('; '),
          });
          continue;
        }

        const kitCase = parsed.data;
        const { kit, reused } = await kitService.create(userId, {
          jd: kitCase.jd,
          company_url: kitCase.company_url,
          days: kitCase.days,
        });

        accepted.push({ index, id: kitCase.id, kitId: kit.id, reused });
      }

      res.status(202).json({ accepted, rejected });
    } catch (error) {
      next(error);
    }
  },
};
