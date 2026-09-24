import { Router } from 'express';

import { kitEditController } from '../controllers/kit-edit.controller.js';
import { kitController } from '../controllers/kit.controller.js';
import { loadOwnedKit } from '../middleware/load-owned-kit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  addFlashcardSchema,
  addQuestionSchema,
  createKitSchema,
  editBriefSchema,
  editFlashcardSchema,
  editQuestionSchema,
  editRequirementSchema,
  editScheduleDaySchema,
  reorderQuestionsSchema,
  reorderSchema,
  versionedSchema,
} from '../validators/kit.validators.js';

export const kitRouter: Router = Router();

// Every kit route is authenticated first; ownership is resolved second.
kitRouter.get('/kits', requireAuth, kitController.list);

kitRouter.post('/kits', requireAuth, validateBody(createKitSchema), kitController.create);

// Rows are validated individually inside the controller, so one bad row does
// not reject the whole upload.
kitRouter.post('/kits/batch', requireAuth, kitController.createBatch);

kitRouter.get('/kits/:id', requireAuth, loadOwnedKit, kitController.get);

// Polled while a kit generates, so it stays deliberately cheap.
kitRouter.get('/kits/:id/status', requireAuth, loadOwnedKit, kitController.status);

/**
 * Editing.
 *
 * These deliberately skip `loadOwnedKit`: the service reloads the kit inside
 * the same operation that writes it, so adding a read here would only make the
 * request do the query twice. Ownership is still resolved from the session and
 * never from the request — `kitService.getOwned` is the only way in.
 */
const edit = kitEditController;

kitRouter.post(
  '/kits/:id/questions',
  requireAuth,
  validateBody(addQuestionSchema),
  edit.addQuestion,
);
kitRouter.post(
  '/kits/:id/questions/reorder',
  requireAuth,
  validateBody(reorderQuestionsSchema),
  edit.reorderQuestions,
);
kitRouter.patch(
  '/kits/:id/questions/:questionId',
  requireAuth,
  validateBody(editQuestionSchema),
  edit.editQuestion,
);
kitRouter.delete(
  '/kits/:id/questions/:questionId',
  requireAuth,
  validateBody(versionedSchema),
  edit.deleteQuestion,
);

kitRouter.post(
  '/kits/:id/flashcards',
  requireAuth,
  validateBody(addFlashcardSchema),
  edit.addFlashcard,
);
kitRouter.post(
  '/kits/:id/flashcards/reorder',
  requireAuth,
  validateBody(reorderSchema),
  edit.reorderFlashcards,
);
kitRouter.patch(
  '/kits/:id/flashcards/:flashcardId',
  requireAuth,
  validateBody(editFlashcardSchema),
  edit.editFlashcard,
);
kitRouter.delete(
  '/kits/:id/flashcards/:flashcardId',
  requireAuth,
  validateBody(versionedSchema),
  edit.deleteFlashcard,
);

kitRouter.patch('/kits/:id/brief', requireAuth, validateBody(editBriefSchema), edit.editBrief);
kitRouter.patch(
  '/kits/:id/requirements/:requirementId',
  requireAuth,
  validateBody(editRequirementSchema),
  edit.editRequirement,
);
kitRouter.patch(
  '/kits/:id/schedule/day',
  requireAuth,
  validateBody(editScheduleDaySchema),
  edit.editScheduleDay,
);

/**
 * Regeneration, scoped to one part of the kit each.
 *
 * The plan route is read-only and exists so the interface can say what will be
 * kept before anything is replaced.
 */
kitRouter.get('/kits/:id/regenerate/questions/:category/plan', requireAuth, edit.planRegeneration);
kitRouter.post(
  '/kits/:id/regenerate/questions/:category',
  requireAuth,
  validateBody(versionedSchema),
  edit.regenerateQuestions,
);
kitRouter.post(
  '/kits/:id/regenerate/company',
  requireAuth,
  validateBody(versionedSchema),
  edit.regenerateBrief,
);
kitRouter.post(
  '/kits/:id/regenerate/schedule',
  requireAuth,
  validateBody(versionedSchema),
  edit.regenerateSchedule,
);
