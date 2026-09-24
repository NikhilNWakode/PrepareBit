import { validateKit, type QuestionCategory } from '@prep/shared';

import { AppError } from '../domain/errors.js';
import * as edit from '../domain/kit/edit-kit.js';
import type { KitState } from '../domain/kit/edit-kit.js';
import { reconcileCounters } from '../domain/kit/ids.js';
import { logger } from '../logger.js';
import { kitRepository, type StoredKit } from '../repositories/kit.repository.js';
import { kitService } from './kit.service.js';

/**
 * Every edit to a kit goes through `mutate`.
 *
 *   load → transform → validate → persist once, or persist nothing
 *
 * Funnelling them means no endpoint can forget the checks. In particular the
 * contract is revalidated on every single change, so the document in Mongo is
 * always a legal Appendix A object — a schedule can never point at a question
 * somebody deleted, because that edit is refused rather than stored.
 */

/** Editing a kit that is still being generated would be overwritten moments later. */
function assertEditable(
  stored: StoredKit,
): asserts stored is StoredKit & { kit: NonNullable<StoredKit['kit']> } {
  if (stored.status !== 'completed' || !stored.kit) {
    throw new AppError(
      'CONFLICT',
      'This kit is still being built. Wait for it to finish before editing it.',
      409,
    );
  }
}

export type Transform = (state: KitState) => KitState | Promise<KitState>;

/**
 * `expectedVersion` is the `updatedAt` the client last saw. A write from a tab
 * that has fallen behind is refused rather than allowed to overwrite whatever
 * happened in between — the "edit in flight" case, answered by the database
 * rather than by hoping it does not happen.
 *
 * The transform may be async, which is what lets a regeneration build its whole
 * new state in memory — model call included — and still reach exactly one
 * write. If the call fails, nothing has been persisted and the kit is untouched.
 */
export async function mutate(
  userId: string,
  kitId: string,
  expectedVersion: Date,
  transform: Transform,
): Promise<StoredKit> {
  const stored = await kitService.getOwned(userId, kitId);
  assertEditable(stored);

  const before: KitState = {
    kit: stored.kit,
    provenance: stored.provenance,
    // Defensive: counters can only move forward, so a document written by an
    // older path can still never reissue a live id.
    counters: reconcileCounters(stored.idCounters, stored.kit),
  };

  const after = await transform(before);

  const validation = validateKit(after.kit);
  if (!validation.ok) {
    logger.warn('kit edit: rejected, the result would not be a valid kit', {
      kitId,
      issues: validation.issues.slice(0, 3).join('; '),
    });

    throw AppError.validationFailed(
      `That change would leave the kit inconsistent: ${validation.issues.join('; ')}`,
    );
  }

  const result = await kitRepository.replaceKitContent(userId, kitId, expectedVersion, {
    kit: validation.kit,
    provenance: after.provenance,
    idCounters: after.counters,
  });

  if (result.ok) return result.kit;

  if (result.reason === 'not-found') {
    throw new AppError('KIT_NOT_FOUND', 'That kit does not exist.', 404);
  }

  throw new AppError(
    'CONFLICT',
    'This kit changed somewhere else since you opened it. Reload to see the latest version.',
    409,
  );
}

/**
 * The editing surface. Each one is a thin binding of a pure function to the
 * funnel above, which is the point: the logic is testable without a database
 * and the service layer stays free of rules.
 */
export const kitEditService = {
  /**
   * Content and the pin can arrive together. They compose into one transform
   * and therefore one write, because two writes would mean the second was made
   * against a version the caller never saw.
   */
  editQuestion: (
    userId: string,
    kitId: string,
    version: Date,
    questionId: string,
    patch: edit.QuestionPatch & { pinned?: boolean | undefined },
  ): Promise<StoredKit> =>
    mutate(userId, kitId, version, (state) => {
      const now = new Date();
      const { pinned, ...content } = patch;

      let next = state;
      if (Object.keys(content).length > 0) {
        next = edit.editQuestion(next, questionId, content, now);
      }
      if (pinned !== undefined) next = edit.pinQuestion(next, questionId, pinned, now);

      return next;
    }),

  addQuestion: (
    userId: string,
    kitId: string,
    version: Date,
    input: edit.NewQuestion,
  ): Promise<StoredKit> =>
    mutate(userId, kitId, version, (state) => edit.addQuestion(state, input, new Date())),

  deleteQuestion: (
    userId: string,
    kitId: string,
    version: Date,
    questionId: string,
  ): Promise<StoredKit> =>
    mutate(userId, kitId, version, (state) => edit.deleteQuestion(state, questionId)),

  reorderQuestions: (
    userId: string,
    kitId: string,
    version: Date,
    category: QuestionCategory,
    ids: string[],
  ): Promise<StoredKit> =>
    mutate(userId, kitId, version, (state) => edit.reorderQuestions(state, category, ids)),

  editFlashcard: (
    userId: string,
    kitId: string,
    version: Date,
    flashcardId: string,
    patch: edit.FlashcardPatch & { pinned?: boolean | undefined },
  ): Promise<StoredKit> =>
    mutate(userId, kitId, version, (state) => {
      const now = new Date();
      const { pinned, ...content } = patch;

      let next = state;
      if (Object.keys(content).length > 0) {
        next = edit.editFlashcard(next, flashcardId, content, now);
      }
      if (pinned !== undefined) next = edit.pinFlashcard(next, flashcardId, pinned, now);

      return next;
    }),

  addFlashcard: (
    userId: string,
    kitId: string,
    version: Date,
    input: edit.NewFlashcard,
  ): Promise<StoredKit> =>
    mutate(userId, kitId, version, (state) => edit.addFlashcard(state, input, new Date())),

  deleteFlashcard: (
    userId: string,
    kitId: string,
    version: Date,
    flashcardId: string,
  ): Promise<StoredKit> =>
    mutate(userId, kitId, version, (state) => edit.deleteFlashcard(state, flashcardId)),

  reorderFlashcards: (
    userId: string,
    kitId: string,
    version: Date,
    ids: string[],
  ): Promise<StoredKit> =>
    mutate(userId, kitId, version, (state) => edit.reorderFlashcards(state, ids)),

  editBrief: (
    userId: string,
    kitId: string,
    version: Date,
    patch: edit.BriefPatch,
  ): Promise<StoredKit> =>
    mutate(userId, kitId, version, (state) => edit.editCompanyBrief(state, patch, new Date())),

  editRequirement: (
    userId: string,
    kitId: string,
    version: Date,
    requirementId: string,
    patch: edit.RequirementPatch,
  ): Promise<StoredKit> =>
    mutate(userId, kitId, version, (state) =>
      edit.editRequirement(state, requirementId, patch, new Date()),
    ),

  editScheduleDay: (
    userId: string,
    kitId: string,
    version: Date,
    day: number,
    focus: string,
  ): Promise<StoredKit> =>
    mutate(userId, kitId, version, (state) => edit.editScheduleDay(state, day, focus, new Date())),

  /** Pure arithmetic: no model, no network, no cost. */
  rebuildSchedule: (userId: string, kitId: string, version: Date): Promise<StoredKit> =>
    mutate(userId, kitId, version, (state) => edit.rebuildSchedule(state)),
};
