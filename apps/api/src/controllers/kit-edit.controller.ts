import type { QuestionCategory } from '@prep/shared';
import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../domain/errors.js';
import { kitEditService } from '../services/kit-edit.service.js';
import { regenerationService } from '../services/regeneration.service.js';
import type {
  AddFlashcardBody,
  AddQuestionBody,
  EditBriefBody,
  EditFlashcardBody,
  EditQuestionBody,
  EditRequirementBody,
  EditScheduleDayBody,
  ReorderBody,
  ReorderQuestionsBody,
  VersionedBody,
} from '../validators/kit.validators.js';

/**
 * Thin, like every other controller here: read the request, call one service
 * method, serialise the result.
 *
 * Every response is the whole updated kit. The client replaces its state in one
 * go and picks up the new version with it, which removes a class of bug where
 * a partial response leaves the page holding a version it can no longer write
 * against.
 */

function requireUserId(req: Request): string {
  if (!req.auth) throw new AppError('AUTH_REQUIRED', 'You must be signed in.', 401);
  return req.auth.userId;
}

function kitId(req: Request): string {
  const id = req.params['id'];
  if (typeof id !== 'string') throw new AppError('KIT_NOT_FOUND', 'That kit does not exist.', 404);
  return id;
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') throw AppError.validationFailed(`Missing ${name}.`);
  return value;
}

/** Validated as a parseable timestamp by the schema; this only converts it. */
function version(body: { version: string }): Date {
  return new Date(body.version);
}

/** The categories are a closed set, so an unknown one is a 404 rather than a 500. */
function category(req: Request): QuestionCategory {
  const value = param(req, 'category');
  const known: readonly string[] = ['technical', 'behavioural', 'system-design', 'company-fit'];

  if (!known.includes(value)) {
    throw new AppError('NOT_FOUND', `There is no "${value}" question category.`, 404);
  }

  return value as QuestionCategory;
}

/** Wraps a handler so each one below is a single expression. */
function handle(run: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await run(req));
    } catch (error) {
      next(error);
    }
  };
}

export const kitEditController = {
  editQuestion: handle(async (req) => {
    const body = req.body as EditQuestionBody;
    const { version: _version, ...patch } = body;

    return {
      kit: await kitEditService.editQuestion(
        requireUserId(req),
        kitId(req),
        version(body),
        param(req, 'questionId'),
        patch,
      ),
    };
  }),

  addQuestion: handle(async (req) => {
    const body = req.body as AddQuestionBody;

    return {
      kit: await kitEditService.addQuestion(requireUserId(req), kitId(req), version(body), {
        category: body.category,
        prompt: body.prompt,
        answer_outline: body.answer_outline,
        difficulty: body.difficulty,
        requirement_ids: body.requirement_ids,
      }),
    };
  }),

  /**
   * The version travels in the body rather than the query string even here,
   * where the request has no other payload, so there is one place to look for
   * it on every mutating route.
   */
  deleteQuestion: handle(async (req) => ({
    kit: await kitEditService.deleteQuestion(
      requireUserId(req),
      kitId(req),
      version(req.body as VersionedBody),
      param(req, 'questionId'),
    ),
  })),

  reorderQuestions: handle(async (req) => {
    const body = req.body as ReorderQuestionsBody;

    return {
      kit: await kitEditService.reorderQuestions(
        requireUserId(req),
        kitId(req),
        version(body),
        body.category,
        body.ids,
      ),
    };
  }),

  editFlashcard: handle(async (req) => {
    const body = req.body as EditFlashcardBody;
    const { version: _version, ...patch } = body;

    return {
      kit: await kitEditService.editFlashcard(
        requireUserId(req),
        kitId(req),
        version(body),
        param(req, 'flashcardId'),
        patch,
      ),
    };
  }),

  addFlashcard: handle(async (req) => {
    const body = req.body as AddFlashcardBody;

    return {
      kit: await kitEditService.addFlashcard(requireUserId(req), kitId(req), version(body), {
        front: body.front,
        back: body.back,
        requirement_ids: body.requirement_ids,
      }),
    };
  }),

  deleteFlashcard: handle(async (req) => ({
    kit: await kitEditService.deleteFlashcard(
      requireUserId(req),
      kitId(req),
      version(req.body as VersionedBody),
      param(req, 'flashcardId'),
    ),
  })),

  reorderFlashcards: handle(async (req) => {
    const body = req.body as ReorderBody;

    return {
      kit: await kitEditService.reorderFlashcards(
        requireUserId(req),
        kitId(req),
        version(body),
        body.ids,
      ),
    };
  }),

  editBrief: handle(async (req) => {
    const body = req.body as EditBriefBody;

    return {
      kit: await kitEditService.editBrief(requireUserId(req), kitId(req), version(body), {
        ...(body.summary === undefined ? {} : { summary: body.summary }),
        ...(body.what_they_do === undefined ? {} : { what_they_do: body.what_they_do }),
      }),
    };
  }),

  editRequirement: handle(async (req) => {
    const body = req.body as EditRequirementBody;
    const { version: _version, ...patch } = body;

    return {
      kit: await kitEditService.editRequirement(
        requireUserId(req),
        kitId(req),
        version(body),
        param(req, 'requirementId'),
        patch,
      ),
    };
  }),

  editScheduleDay: handle(async (req) => {
    const body = req.body as EditScheduleDayBody;

    return {
      kit: await kitEditService.editScheduleDay(
        requireUserId(req),
        kitId(req),
        version(body),
        body.day,
        body.focus,
      ),
    };
  }),

  // --- regeneration ----------------------------------------------------------

  /** Read-only: what a regeneration would keep, so the user can be asked first. */
  planRegeneration: handle(async (req) => ({
    plan: await regenerationService.planQuestions(requireUserId(req), kitId(req), category(req)),
  })),

  regenerateQuestions: handle(async (req) =>
    regenerationService.questions(
      requireUserId(req),
      kitId(req),
      version(req.body as VersionedBody),
      category(req),
    ),
  ),

  regenerateBrief: handle(async (req) =>
    regenerationService.brief(requireUserId(req), kitId(req), version(req.body as VersionedBody)),
  ),

  /** No model involved: the schedule is arithmetic over the questions as they are. */
  regenerateSchedule: handle(async (req) => ({
    kit: await kitEditService.rebuildSchedule(
      requireUserId(req),
      kitId(req),
      version(req.body as VersionedBody),
    ),
  })),
};
