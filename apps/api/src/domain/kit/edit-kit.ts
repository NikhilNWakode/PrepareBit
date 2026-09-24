import type {
  Kit,
  KitCompanyBrief,
  KitFlashcard,
  KitQuestion,
  QuestionCategory,
  RequirementKind,
  RequirementPriority,
} from '@prep/shared';

import { checkCoverage } from '../../coverage/check-coverage.js';
import { allocateSchedule } from '../../scheduling/allocate-schedule.js';
import { AppError } from '../errors.js';
import { allocateId, type IdCounters } from './ids.js';
import {
  generatedEntry,
  isProtected,
  userEntry,
  type ProvenanceEntry,
  type ProvenanceMap,
} from './provenance.js';

/**
 * Every edit a user can make to a kit, as pure functions.
 *
 * No Express, no Mongo, no clock — `now` is passed in. The service layer loads
 * a kit, applies one of these, validates the result against the contract and
 * persists it, so an edit that would corrupt the Appendix A object is rejected
 * rather than stored.
 *
 * Two rules run through all of it:
 *
 *  - **Coverage is computed, never edited.** Anything that changes questions or
 *    requirements recomputes `uncovered_requirement_ids` from the kit itself.
 *    `passes` counts coverage *rounds the generator ran*, so only regeneration
 *    touches it — an ordinary edit must not inflate it.
 *  - **Ids are never reissued.** Counters only move forward, so a deleted
 *    question's id cannot be inherited by a new one and a stale reference can
 *    never silently re-attach to the wrong thing.
 */

export interface KitState {
  kit: Kit;
  provenance: ProvenanceMap;
  counters: IdCounters;
}

/**
 * Provenance is keyed by item id (`q3`, `f1`). These two keys stand for the
 * sections that are single rather than a list; neither can collide with an
 * allocated id, which always begins with `r`, `q` or `f` followed by digits.
 */
export const BRIEF_KEY = 'company_brief';
export const SCHEDULE_KEY = 'schedule';

// --- small shared helpers ----------------------------------------------------

function notFound(what: string, id: string): AppError {
  return new AppError('NOT_FOUND', `This kit has no ${what} "${id}".`, 404);
}

/** Marks an item as touched by the user while keeping how it originally arrived. */
function markEdited(provenance: ProvenanceMap, key: string, now: Date): ProvenanceMap {
  const existing = provenance[key] ?? generatedEntry(now);
  return { ...provenance, [key]: { ...existing, edited: true, updatedAt: now } };
}

function setPinned(
  provenance: ProvenanceMap,
  key: string,
  pinned: boolean,
  now: Date,
): ProvenanceMap {
  const existing = provenance[key] ?? generatedEntry(now);
  return { ...provenance, [key]: { ...existing, pinned, updatedAt: now } };
}

function without(provenance: ProvenanceMap, key: string): ProvenanceMap {
  const { [key]: _removed, ...rest } = provenance;
  return rest;
}

/** Requirement ids a question or flashcard cites must exist, or coverage lies. */
function checkRequirementIds(kit: Kit, requirementIds: readonly string[]): void {
  const known = new Set(kit.role.requirements.map((requirement) => requirement.id));
  const unknown = requirementIds.filter((id) => !known.has(id));

  if (unknown.length > 0) {
    throw AppError.validationFailed(
      `These requirements are not part of this kit: ${unknown.join(', ')}.`,
    );
  }
}

/**
 * Recomputes the coverage list from the kit as it now stands.
 *
 * `passes` is deliberately carried through untouched: it records how many
 * coverage rounds the generator performed, and an edit is not a round.
 */
function recomputeCoverage(kit: Kit): Kit {
  const report = checkCoverage(kit.role.requirements, kit.questions);

  return {
    ...kit,
    coverage: { ...kit.coverage, uncovered_requirement_ids: report.uncoveredRequirementIds },
  };
}

/**
 * Drops ids from the study plan.
 *
 * The contract requires every `question_ids` entry to name a question that
 * exists, so a delete has to reach into the schedule. The day itself stays —
 * removing it would break the "days equals days_available" rule — and its
 * minutes are left alone, with the interface offering to rebuild the plan.
 */
function pruneSchedule(kit: Kit, removedIds: ReadonlySet<string>): Kit {
  if (removedIds.size === 0) return kit;

  return {
    ...kit,
    schedule: {
      ...kit.schedule,
      days: kit.schedule.days.map((day) => ({
        ...day,
        question_ids: day.question_ids.filter((id) => !removedIds.has(id)),
      })),
    },
  };
}

/** Questions in the plan versus questions in the kit: what the UI warns about. */
export function unscheduledQuestionIds(kit: Kit): string[] {
  const scheduled = new Set(kit.schedule.days.flatMap((day) => day.question_ids));
  return kit.questions.filter((question) => !scheduled.has(question.id)).map((q) => q.id);
}

// --- questions ---------------------------------------------------------------

export interface QuestionPatch {
  prompt?: string | undefined;
  answer_outline?: string | undefined;
  difficulty?: number | undefined;
  requirement_ids?: string[] | undefined;
}

export function editQuestion(
  state: KitState,
  questionId: string,
  patch: QuestionPatch,
  now: Date,
): KitState {
  const existing = state.kit.questions.find((question) => question.id === questionId);
  if (!existing) throw notFound('question', questionId);

  if (patch.requirement_ids) checkRequirementIds(state.kit, patch.requirement_ids);

  const updated: KitQuestion = {
    ...existing,
    ...(patch.prompt === undefined ? {} : { prompt: patch.prompt.trim() }),
    ...(patch.answer_outline === undefined ? {} : { answer_outline: patch.answer_outline.trim() }),
    ...(patch.difficulty === undefined ? {} : { difficulty: patch.difficulty }),
    ...(patch.requirement_ids === undefined
      ? {}
      : { requirement_ids: [...new Set(patch.requirement_ids)] }),
  };

  const kit = recomputeCoverage({
    ...state.kit,
    questions: state.kit.questions.map((question) =>
      question.id === questionId ? updated : question,
    ),
  });

  return { ...state, kit, provenance: markEdited(state.provenance, questionId, now) };
}

export interface NewQuestion {
  category: QuestionCategory;
  prompt: string;
  answer_outline: string;
  difficulty: number;
  requirement_ids: string[];
}

export function addQuestion(state: KitState, input: NewQuestion, now: Date): KitState {
  checkRequirementIds(state.kit, input.requirement_ids);

  const { id, counters } = allocateId(state.counters, 'question');

  const question: KitQuestion = {
    id,
    requirement_ids: [...new Set(input.requirement_ids)],
    category: input.category,
    prompt: input.prompt.trim(),
    answer_outline: input.answer_outline.trim(),
    difficulty: input.difficulty,
  };

  // Placed with its own category rather than at the end of the array, so the
  // stored order matches how the kit reads.
  const lastOfCategory = state.kit.questions.reduce(
    (position, candidate, index) => (candidate.category === input.category ? index : position),
    -1,
  );
  const insertAt = lastOfCategory === -1 ? state.kit.questions.length : lastOfCategory + 1;

  const questions = [
    ...state.kit.questions.slice(0, insertAt),
    question,
    ...state.kit.questions.slice(insertAt),
  ];

  return {
    kit: recomputeCoverage({ ...state.kit, questions }),
    // A question the user wrote is theirs, and regeneration may never replace it.
    provenance: { ...state.provenance, [id]: userEntry(now) },
    counters,
  };
}

export function deleteQuestion(state: KitState, questionId: string): KitState {
  if (!state.kit.questions.some((question) => question.id === questionId)) {
    throw notFound('question', questionId);
  }

  const kit = recomputeCoverage(
    pruneSchedule(
      {
        ...state.kit,
        questions: state.kit.questions.filter((question) => question.id !== questionId),
      },
      new Set([questionId]),
    ),
  );

  // The provenance entry goes with it: the map tracks live items only, and the
  // counter is not rewound, so the id cannot come back.
  return { ...state, kit, provenance: without(state.provenance, questionId) };
}

export function pinQuestion(
  state: KitState,
  questionId: string,
  pinned: boolean,
  now: Date,
): KitState {
  if (!state.kit.questions.some((question) => question.id === questionId)) {
    throw notFound('question', questionId);
  }

  return { ...state, provenance: setPinned(state.provenance, questionId, pinned, now) };
}

/**
 * Reorders one category in place.
 *
 * Only the positions that category occupies are rewritten, so reordering
 * technical questions cannot disturb the behavioural ones. Order is presentation,
 * not content, so nothing is marked edited by it.
 */
export function reorderQuestions(
  state: KitState,
  category: QuestionCategory,
  orderedIds: readonly string[],
): KitState {
  const current = state.kit.questions.filter((question) => question.category === category);
  assertPermutation(
    current.map((question) => question.id),
    orderedIds,
    `${category} questions`,
  );

  const byId = new Map(current.map((question) => [question.id, question]));
  let cursor = 0;

  const questions = state.kit.questions.map((question) => {
    if (question.category !== category) return question;
    const next = byId.get(orderedIds[cursor] as string);
    cursor += 1;
    return next as KitQuestion;
  });

  return { ...state, kit: { ...state.kit, questions } };
}

// --- flashcards --------------------------------------------------------------

export interface FlashcardPatch {
  front?: string | undefined;
  back?: string | undefined;
  requirement_ids?: string[] | undefined;
}

export function editFlashcard(
  state: KitState,
  flashcardId: string,
  patch: FlashcardPatch,
  now: Date,
): KitState {
  const existing = state.kit.flashcards.find((flashcard) => flashcard.id === flashcardId);
  if (!existing) throw notFound('flashcard', flashcardId);

  if (patch.requirement_ids) checkRequirementIds(state.kit, patch.requirement_ids);

  const updated: KitFlashcard = {
    ...existing,
    ...(patch.front === undefined ? {} : { front: patch.front.trim() }),
    ...(patch.back === undefined ? {} : { back: patch.back.trim() }),
    ...(patch.requirement_ids === undefined
      ? {}
      : { requirement_ids: [...new Set(patch.requirement_ids)] }),
  };

  // Flashcards carry no coverage weight — only questions assess a requirement —
  // so there is nothing to recompute here.
  return {
    ...state,
    kit: {
      ...state.kit,
      flashcards: state.kit.flashcards.map((flashcard) =>
        flashcard.id === flashcardId ? updated : flashcard,
      ),
    },
    provenance: markEdited(state.provenance, flashcardId, now),
  };
}

export interface NewFlashcard {
  front: string;
  back: string;
  requirement_ids: string[];
}

export function addFlashcard(state: KitState, input: NewFlashcard, now: Date): KitState {
  checkRequirementIds(state.kit, input.requirement_ids);

  const { id, counters } = allocateId(state.counters, 'flashcard');

  const flashcard: KitFlashcard = {
    id,
    front: input.front.trim(),
    back: input.back.trim(),
    requirement_ids: [...new Set(input.requirement_ids)],
  };

  return {
    kit: { ...state.kit, flashcards: [...state.kit.flashcards, flashcard] },
    provenance: { ...state.provenance, [id]: userEntry(now) },
    counters,
  };
}

export function deleteFlashcard(state: KitState, flashcardId: string): KitState {
  if (!state.kit.flashcards.some((flashcard) => flashcard.id === flashcardId)) {
    throw notFound('flashcard', flashcardId);
  }

  return {
    ...state,
    kit: {
      ...state.kit,
      flashcards: state.kit.flashcards.filter((flashcard) => flashcard.id !== flashcardId),
    },
    provenance: without(state.provenance, flashcardId),
  };
}

export function pinFlashcard(
  state: KitState,
  flashcardId: string,
  pinned: boolean,
  now: Date,
): KitState {
  if (!state.kit.flashcards.some((flashcard) => flashcard.id === flashcardId)) {
    throw notFound('flashcard', flashcardId);
  }

  return { ...state, provenance: setPinned(state.provenance, flashcardId, pinned, now) };
}

export function reorderFlashcards(state: KitState, orderedIds: readonly string[]): KitState {
  assertPermutation(
    state.kit.flashcards.map((flashcard) => flashcard.id),
    orderedIds,
    'flashcards',
  );

  const byId = new Map(state.kit.flashcards.map((flashcard) => [flashcard.id, flashcard]));

  return {
    ...state,
    kit: {
      ...state.kit,
      flashcards: orderedIds.map((id) => byId.get(id) as KitFlashcard),
    },
  };
}

// --- brief, requirements, schedule ------------------------------------------

export interface BriefPatch {
  summary?: string | undefined;
  what_they_do?: string | undefined;
}

export function editCompanyBrief(state: KitState, patch: BriefPatch, now: Date): KitState {
  const company_brief: KitCompanyBrief = {
    ...state.kit.company_brief,
    ...(patch.summary === undefined ? {} : { summary: patch.summary.trim() }),
    ...(patch.what_they_do === undefined ? {} : { what_they_do: patch.what_they_do.trim() }),
  };

  return {
    ...state,
    kit: { ...state.kit, company_brief },
    provenance: markEdited(state.provenance, BRIEF_KEY, now),
  };
}

export interface RequirementPatch {
  text?: string | undefined;
  kind?: RequirementKind | undefined;
  priority?: RequirementPriority | undefined;
}

/**
 * Editing a requirement is coverage-impacting even though the id set does not
 * change: flipping `nice` to `must` changes which gaps actually block, and the
 * coverage list must not be allowed to describe a kit that no longer exists.
 */
export function editRequirement(
  state: KitState,
  requirementId: string,
  patch: RequirementPatch,
  now: Date,
): KitState {
  const existing = state.kit.role.requirements.find(
    (requirement) => requirement.id === requirementId,
  );
  if (!existing) throw notFound('requirement', requirementId);

  const requirements = state.kit.role.requirements.map((requirement) =>
    requirement.id === requirementId
      ? {
          ...requirement,
          ...(patch.text === undefined ? {} : { text: patch.text.trim() }),
          ...(patch.kind === undefined ? {} : { kind: patch.kind }),
          ...(patch.priority === undefined ? {} : { priority: patch.priority }),
        }
      : requirement,
  );

  return {
    ...state,
    kit: recomputeCoverage({ ...state.kit, role: { ...state.kit.role, requirements } }),
    provenance: markEdited(state.provenance, requirementId, now),
  };
}

export function editScheduleDay(state: KitState, day: number, focus: string, now: Date): KitState {
  if (!state.kit.schedule.days.some((entry) => entry.day === day)) {
    throw notFound('schedule day', String(day));
  }

  return {
    ...state,
    kit: {
      ...state.kit,
      schedule: {
        ...state.kit.schedule,
        days: state.kit.schedule.days.map((entry) =>
          entry.day === day ? { ...entry, focus: focus.trim() } : entry,
        ),
      },
    },
    provenance: markEdited(state.provenance, SCHEDULE_KEY, now),
  };
}

/**
 * Rebuilds the study plan from the questions as they now stand.
 *
 * Pure arithmetic — the same function generation uses — so this costs nothing
 * and involves no model. It replaces the plan wholesale, which is what the user
 * asked for, and clears the edited flag because the plan is no longer theirs.
 */
export function rebuildSchedule(state: KitState): KitState {
  return {
    ...state,
    kit: {
      ...state.kit,
      schedule: allocateSchedule(
        state.kit.role.requirements,
        state.kit.questions,
        state.kit.schedule.days_available,
      ),
    },
    provenance: without(state.provenance, SCHEDULE_KEY),
  };
}

/** Regeneration targets the brief directly, so it replaces whatever is there. */
export function replaceCompanyBrief(state: KitState, brief: KitCompanyBrief, now: Date): KitState {
  return {
    ...state,
    kit: { ...state.kit, company_brief: brief },
    provenance: { ...state.provenance, [BRIEF_KEY]: generatedEntry(now) },
  };
}

// --- regeneration ------------------------------------------------------------

export interface CategoryRegenerationPlan {
  /** Kept whatever the model returns: user-written, edited or pinned. */
  protectedIds: string[];
  /** Plain generated questions, which regeneration is allowed to replace. */
  replaceableIds: string[];
}

/**
 * What a regeneration would do, without doing it.
 *
 * The interface shows this before asking for confirmation: a promise that
 * edits survive is only worth anything if the user can see it being kept.
 */
export function planCategoryRegeneration(
  state: KitState,
  category: QuestionCategory,
): CategoryRegenerationPlan {
  const protectedIds: string[] = [];
  const replaceableIds: string[] = [];

  for (const question of state.kit.questions) {
    if (question.category !== category) continue;
    if (isProtected(state.provenance[question.id])) protectedIds.push(question.id);
    else replaceableIds.push(question.id);
  }

  return { protectedIds, replaceableIds };
}

/**
 * The rule the whole builder exists for:
 *
 *   "user-created question survives regeneration
 *    user-edited question survives regeneration
 *    pinned content survives regeneration
 *    regenerated content can replace only eligible generated content"
 *
 * Protected questions keep their relative order and their ids. The fresh ones
 * were allocated ids from the counters passed to the generator, so they cannot
 * collide with a protected question or with anything deleted earlier.
 *
 * Nothing outside `category` is read or written: other categories, the
 * flashcards and the brief come through byte-identical.
 */
export function applyRegeneratedQuestions(
  state: KitState,
  category: QuestionCategory,
  fresh: readonly KitQuestion[],
  counters: IdCounters,
  now: Date,
): KitState {
  const { replaceableIds } = planCategoryRegeneration(state, category);
  const removed = new Set(replaceableIds);

  const survivors = state.kit.questions.filter(
    (question) => question.category === category && !removed.has(question.id),
  );
  const others = state.kit.questions.filter((question) => question.category !== category);

  // Put the category back where it was rather than at the end of the array.
  const firstIndex = state.kit.questions.findIndex((question) => question.category === category);
  const insertAt =
    firstIndex === -1
      ? others.length
      : state.kit.questions
          .slice(0, firstIndex)
          .filter((question) => question.category !== category).length;

  const questions = [
    ...others.slice(0, insertAt),
    ...survivors,
    ...fresh,
    ...others.slice(insertAt),
  ];

  let provenance = state.provenance;
  for (const id of removed) provenance = without(provenance, id);
  for (const question of fresh) provenance = { ...provenance, [question.id]: generatedEntry(now) };

  const withoutRemoved = pruneSchedule({ ...state.kit, questions }, removed);
  const recovered = checkCoverage(withoutRemoved.role.requirements, withoutRemoved.questions);

  return {
    kit: {
      ...withoutRemoved,
      coverage: {
        uncovered_requirement_ids: recovered.uncoveredRequirementIds,
        // A real coverage check just ran, so this one genuinely is another pass.
        passes: withoutRemoved.coverage.passes + 1,
      },
    },
    provenance,
    counters,
  };
}

// --- shared validation -------------------------------------------------------

/**
 * A reorder must be exactly the items it claims to reorder. Anything else — a
 * missing id, a duplicate, an id from another category — is a bug in the caller,
 * and silently tolerating it would delete or duplicate someone's work.
 */
function assertPermutation(
  current: readonly string[],
  proposed: readonly string[],
  what: string,
): void {
  const sameLength = current.length === proposed.length;
  const sameMembers =
    new Set(proposed).size === proposed.length && proposed.every((id) => current.includes(id));

  if (!sameLength || !sameMembers) {
    throw AppError.validationFailed(
      `The new order must list every one of the ${what} exactly once.`,
    );
  }
}

/** Exposed so the interface can show why an item is protected. */
export function protectionOf(entry: ProvenanceEntry | undefined): {
  protected: boolean;
  reason: 'yours' | 'edited' | 'pinned' | null;
} {
  if (!entry) return { protected: false, reason: null };
  if (entry.pinned) return { protected: true, reason: 'pinned' };
  if (entry.origin === 'user') return { protected: true, reason: 'yours' };
  if (entry.edited) return { protected: true, reason: 'edited' };
  return { protected: false, reason: null };
}
