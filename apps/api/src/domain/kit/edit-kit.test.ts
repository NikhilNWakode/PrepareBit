import { validateKit, type Kit, type KitQuestion, type QuestionCategory } from '@prep/shared';
import { describe, expect, it } from 'vitest';

import { validKit } from '../../test-support/kit-fixture.js';
import * as edit from './edit-kit.js';
import { reconcileCounters, EMPTY_ID_COUNTERS } from './ids.js';
import { generatedEntry, userEntry, type ProvenanceMap } from './provenance.js';

/**
 * The builder's rules, tested without a database.
 *
 * Every function here is pure, so these assert the behaviour the brief is
 * actually scoring — that an edit survives a regeneration, that ids are never
 * reused, that the kit stays a legal Appendix A object — rather than asserting
 * that Express wired something up.
 */

const AT = new Date('2026-09-24T10:00:00.000Z');

function stateOf(kit: Kit, provenance: ProvenanceMap = {}): edit.KitState {
  return { kit, provenance, counters: reconcileCounters(EMPTY_ID_COUNTERS, kit) };
}

/** The fixture, plus a technical category big enough to regenerate meaningfully. */
function kitWithFiveTechnical(): Kit {
  const kit = validKit();

  const technical = (id: string, prompt: string): KitQuestion => ({
    id,
    requirement_ids: ['r1'],
    category: 'technical',
    prompt,
    answer_outline: 'outline',
    difficulty: 2,
  });

  // q1 is the fixture's technical question; q2 is behavioural and must survive
  // every technical regeneration untouched.
  kit.questions = [
    technical('q1', 'generated one'),
    technical('q3', 'user wrote this'),
    technical('q4', 'generated, then edited'),
    technical('q5', 'pinned'),
    technical('q6', 'generated two'),
    kit.questions[1] as KitQuestion,
  ];

  kit.schedule = {
    days_available: 2,
    days: [
      { day: 1, focus: 'Node', question_ids: ['q1', 'q3', 'q4'], minutes: 60 },
      { day: 2, focus: 'More', question_ids: ['q5', 'q6', 'q2'], minutes: 45 },
    ],
  };

  return kit;
}

const MIXED_PROVENANCE: ProvenanceMap = {
  q3: userEntry(AT),
  q4: { ...generatedEntry(AT), edited: true },
  q5: { ...generatedEntry(AT), pinned: true },
};

/** Fresh questions as `generateQuestions` would hand them back. */
function freshTechnical(ids: readonly string[]): KitQuestion[] {
  return ids.map((id) => ({
    id,
    requirement_ids: ['r1'],
    category: 'technical',
    prompt: `fresh ${id}`,
    answer_outline: 'fresh outline',
    difficulty: 1,
  }));
}

function expectValid(kit: Kit): void {
  const result = validateKit(kit);
  if (!result.ok) throw new Error(`kit is not valid: ${result.issues.join('; ')}`);
}

describe('editing a question', () => {
  it('marks it edited without changing how it originally arrived', () => {
    const next = edit.editQuestion(stateOf(validKit()), 'q1', { prompt: 'Reworded' }, AT);

    expect(next.kit.questions[0]?.prompt).toBe('Reworded');
    expect(next.provenance['q1']).toMatchObject({ origin: 'generated', edited: true });
  });

  it('refuses a requirement the kit does not have', () => {
    expect(() =>
      edit.editQuestion(stateOf(validKit()), 'q1', { requirement_ids: ['r99'] }, AT),
    ).toThrow(/not part of this kit/);
  });

  it('refuses a question the kit does not have', () => {
    expect(() => edit.editQuestion(stateOf(validKit()), 'q99', { prompt: 'x' }, AT)).toThrow(
      /no question/,
    );
  });

  it('recomputes coverage when the requirements it claims change', () => {
    // q1 was the only question covering r1; pointing it at r2 leaves r1 bare.
    const next = edit.editQuestion(stateOf(validKit()), 'q1', { requirement_ids: ['r2'] }, AT);

    expect(next.kit.coverage.uncovered_requirement_ids).toEqual(['r1']);
  });

  /**
   * `passes` counts the coverage rounds the *generator* ran. An edit recomputes
   * coverage, but recomputing is not a pass, and inflating it would misreport
   * how hard the pipeline worked.
   */
  it('does not increment coverage.passes', () => {
    const before = validKit();
    const next = edit.editQuestion(stateOf(before), 'q1', { requirement_ids: ['r2'] }, AT);

    expect(next.kit.coverage.passes).toBe(before.coverage.passes);
  });
});

/**
 * Moving a question between categories — a builder requirement from the brief
 * that Phase 10 missed. The hard part is not the move, it is that a moved
 * question is content the user deliberately placed, so a regeneration of
 * *either* category has to leave it alone.
 */
describe('moving a question to another category', () => {
  const move = (state: edit.KitState, id: string, category: QuestionCategory) =>
    edit.editQuestion(state, id, { category }, AT);

  it('leaves the old category and joins the new one, keeping its id', () => {
    const next = move(stateOf(validKit()), 'q1', 'behavioural');

    const moved = next.kit.questions.find((question) => question.id === 'q1');
    expect(moved?.category).toBe('behavioural');
    expect(moved?.prompt).toBe(validKit().questions[0]?.prompt);
    expect(next.kit.questions.filter((q) => q.category === 'technical')).toEqual([]);
  });

  it('appends to the destination rather than disturbing its order', () => {
    const state = stateOf(kitWithFiveTechnical());
    const before = state.kit.questions
      .filter((question) => question.category === 'behavioural')
      .map((question) => question.id);

    const next = move(state, 'q4', 'behavioural');
    const after = next.kit.questions
      .filter((question) => question.category === 'behavioural')
      .map((question) => question.id);

    expect(after).toEqual([...before, 'q4']);
  });

  it('is an edit, so regenerating either category preserves it', () => {
    const next = move(stateOf(kitWithFiveTechnical(), MIXED_PROVENANCE), 'q1', 'behavioural');

    expect(next.provenance['q1']?.edited).toBe(true);
    // Gone from the category it left...
    expect(edit.planCategoryRegeneration(next, 'technical').replaceableIds).not.toContain('q1');
    // ...and protected in the one it joined.
    expect(edit.planCategoryRegeneration(next, 'behavioural').protectedIds).toContain('q1');
  });

  it('survives an actual regeneration of the destination category', () => {
    const moved = move(stateOf(kitWithFiveTechnical(), MIXED_PROVENANCE), 'q1', 'behavioural');

    const fresh: KitQuestion[] = [
      {
        id: 'q9',
        requirement_ids: ['r2'],
        category: 'behavioural',
        prompt: 'freshly generated',
        answer_outline: '',
        difficulty: 1,
      },
    ];

    const after = edit.applyRegeneratedQuestions(
      moved,
      'behavioural',
      fresh,
      { requirement: 2, question: 9, flashcard: 1 },
      AT,
    );

    expect(after.kit.questions.map((question) => question.id)).toContain('q1');
    expectValid(after.kit);
  });

  it('recomputes coverage and leaves the kit valid', () => {
    const before = validKit();
    const next = move(stateOf(before), 'q1', 'behavioural');

    // The question still covers r1, so nothing became uncovered by moving it.
    expect(next.kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(next.kit.coverage.passes).toBe(before.coverage.passes);
    expectValid(next.kit);
  });

  it('keeps the schedule pointing at it', () => {
    const next = move(stateOf(validKit()), 'q1', 'company-fit');

    expect(next.kit.schedule.days.flatMap((day) => day.question_ids)).toContain('q1');
    expectValid(next.kit);
  });

  it('does not reissue an id or create a second copy', () => {
    const next = move(stateOf(validKit()), 'q1', 'system-design');
    const ids = next.kit.questions.map((question) => question.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(next.counters.question).toBe(2);
  });
});

describe('adding a question', () => {
  const input: edit.NewQuestion = {
    category: 'technical',
    prompt: 'Something I want to be asked',
    answer_outline: '',
    difficulty: 2,
    requirement_ids: ['r1'],
  };

  it('belongs to the user, so regeneration can never replace it', () => {
    const next = edit.addQuestion(stateOf(validKit()), input, AT);

    expect(next.provenance['q3']).toMatchObject({ origin: 'user' });
  });

  it('takes the next id and sits with its own category', () => {
    const next = edit.addQuestion(stateOf(validKit()), input, AT);

    expect(next.counters.question).toBe(3);
    // Inserted after q1 (technical) rather than after q2 (behavioural).
    expect(next.kit.questions.map((question) => question.id)).toEqual(['q1', 'q3', 'q2']);
  });

  it('is not in the study plan until the plan is rebuilt', () => {
    const next = edit.addQuestion(stateOf(validKit()), input, AT);

    expect(edit.unscheduledQuestionIds(next.kit)).toEqual(['q3']);
    expectValid(next.kit);
  });

  it('refuses to cite a requirement that does not exist', () => {
    expect(() =>
      edit.addQuestion(stateOf(validKit()), { ...input, requirement_ids: ['r42'] }, AT),
    ).toThrow(/not part of this kit/);
  });
});

describe('deleting a question', () => {
  it('takes its schedule references with it and stays a valid kit', () => {
    const next = edit.deleteQuestion(stateOf(validKit()), 'q1');

    expect(next.kit.questions.map((question) => question.id)).toEqual(['q2']);
    expect(next.kit.schedule.days[0]?.question_ids).toEqual([]);
    expectValid(next.kit);
  });

  it('recomputes coverage, because the requirement is bare again', () => {
    const next = edit.deleteQuestion(stateOf(validKit()), 'q1');

    expect(next.kit.coverage.uncovered_requirement_ids).toEqual(['r1']);
    expect(next.kit.coverage.passes).toBe(validKit().coverage.passes);
  });

  it('forgets its provenance, so the map only ever describes live items', () => {
    const next = edit.deleteQuestion(stateOf(validKit(), { q1: userEntry(AT) }), 'q1');

    expect(next.provenance['q1']).toBeUndefined();
  });

  /**
   * The counter is not rewound on delete. If it were, the next question would
   * inherit a dead id and any stale reference to it would silently re-attach to
   * the wrong thing.
   */
  it('never lets the id come back, even for the most recently added item', () => {
    const added = edit.addQuestion(
      stateOf(validKit()),
      {
        category: 'technical',
        prompt: 'temporary',
        answer_outline: '',
        difficulty: 1,
        requirement_ids: ['r1'],
      },
      AT,
    );
    expect(added.counters.question).toBe(3);

    const deleted = edit.deleteQuestion(added, 'q3');
    const readded = edit.addQuestion(
      deleted,
      {
        category: 'technical',
        prompt: 'a different question',
        answer_outline: '',
        difficulty: 1,
        requirement_ids: ['r1'],
      },
      AT,
    );

    expect(readded.kit.questions.some((question) => question.id === 'q3')).toBe(false);
    expect(readded.kit.questions.map((q) => q.id)).toContain('q4');
  });
});

describe('pinning', () => {
  it('protects a generated question from regeneration', () => {
    const next = edit.pinQuestion(stateOf(validKit()), 'q1', true, AT);
    const plan = edit.planCategoryRegeneration(next, 'technical');

    expect(plan.protectedIds).toEqual(['q1']);
    expect(plan.replaceableIds).toEqual([]);
  });

  /** Unpinning has to actually give the question back, or the pin is a trap. */
  it('unpinning makes an otherwise untouched question replaceable again', () => {
    const pinned = edit.pinQuestion(stateOf(validKit()), 'q1', true, AT);
    const unpinned = edit.pinQuestion(pinned, 'q1', false, AT);

    const plan = edit.planCategoryRegeneration(unpinned, 'technical');
    expect(plan.protectedIds).toEqual([]);
    expect(plan.replaceableIds).toEqual(['q1']);
  });

  it('unpinning does not release a question the user edited', () => {
    const edited = edit.editQuestion(stateOf(validKit()), 'q1', { prompt: 'mine now' }, AT);
    const unpinned = edit.pinQuestion(edited, 'q1', false, AT);

    expect(edit.planCategoryRegeneration(unpinned, 'technical').protectedIds).toEqual(['q1']);
  });
});

describe('reordering', () => {
  it('rearranges one category and leaves the others where they were', () => {
    const state = stateOf(kitWithFiveTechnical());

    const next = edit.reorderQuestions(state, 'technical', ['q6', 'q5', 'q4', 'q3', 'q1']);

    expect(next.kit.questions.map((question) => question.id)).toEqual([
      'q6',
      'q5',
      'q4',
      'q3',
      'q1',
      // The behavioural question has not moved.
      'q2',
    ]);
    expectValid(next.kit);
  });

  it('is not an edit, so nothing becomes protected by being moved', () => {
    const next = edit.reorderQuestions(stateOf(validKit()), 'technical', ['q1']);

    expect(next.provenance).toEqual({});
  });

  it.each([
    ['one missing', ['q1', 'q3', 'q4', 'q5']],
    ['one duplicated', ['q1', 'q1', 'q3', 'q4', 'q5']],
    ['one from another category', ['q1', 'q2', 'q3', 'q4', 'q5']],
  ])('refuses an order with %s', (_label, ids) => {
    expect(() => edit.reorderQuestions(stateOf(kitWithFiveTechnical()), 'technical', ids)).toThrow(
      /exactly once/,
    );
  });
});

describe('flashcards', () => {
  it('edits, adds, deletes and reorders without touching coverage', () => {
    const start = stateOf(validKit());

    const edited = edit.editFlashcard(start, 'f1', { back: 'A queue, not a thread' }, AT);
    expect(edited.kit.flashcards[0]?.back).toBe('A queue, not a thread');
    expect(edited.provenance['f1']?.edited).toBe(true);
    expect(edited.kit.coverage).toEqual(start.kit.coverage);

    const added = edit.addFlashcard(
      edited,
      { front: 'Backpressure', back: '', requirement_ids: [] },
      AT,
    );
    expect(added.counters.flashcard).toBe(2);
    expect(added.provenance['f2']).toMatchObject({ origin: 'user' });

    const reordered = edit.reorderFlashcards(added, ['f2', 'f1']);
    expect(reordered.kit.flashcards.map((card) => card.id)).toEqual(['f2', 'f1']);

    const deleted = edit.deleteFlashcard(reordered, 'f1');
    expect(deleted.kit.flashcards.map((card) => card.id)).toEqual(['f2']);
    expect(deleted.provenance['f1']).toBeUndefined();
    expectValid(deleted.kit);
  });
});

describe('editing a requirement', () => {
  /**
   * Requirement edits are coverage-impacting even though no id changes: which
   * gaps block depends on `priority`, and the stored coverage must never
   * describe a kit that no longer exists.
   */
  it('recomputes coverage without counting as a coverage pass', () => {
    const kit = validKit();
    kit.questions = [kit.questions[0] as KitQuestion]; // drop q2, leaving r2 bare
    kit.schedule.days[1]!.question_ids = [];
    kit.coverage = { uncovered_requirement_ids: [], passes: 2 };

    const next = edit.editRequirement(stateOf(kit), 'r2', { priority: 'must' }, AT);

    expect(next.kit.coverage.uncovered_requirement_ids).toEqual(['r2']);
    expect(next.kit.coverage.passes).toBe(2);
    expect(next.provenance['r2']?.edited).toBe(true);
    expectValid(next.kit);
  });
});

describe('rebuilding the schedule', () => {
  it('picks up questions added since the plan was made', () => {
    const added = edit.addQuestion(
      stateOf(validKit()),
      {
        category: 'technical',
        prompt: 'newly added',
        answer_outline: '',
        difficulty: 1,
        requirement_ids: ['r1'],
      },
      AT,
    );
    expect(edit.unscheduledQuestionIds(added.kit)).toEqual(['q3']);

    const rebuilt = edit.rebuildSchedule(added);

    expect(edit.unscheduledQuestionIds(rebuilt.kit)).toEqual([]);
    expect(rebuilt.kit.schedule.days_available).toBe(2);
    expectValid(rebuilt.kit);
  });

  it('clears the edited flag, because the rebuilt plan is not the one they wrote', () => {
    const edited = edit.editScheduleDay(stateOf(validKit()), 1, 'My own plan', AT);
    expect(edited.provenance[edit.SCHEDULE_KEY]?.edited).toBe(true);

    const rebuilt = edit.rebuildSchedule(edited);
    expect(rebuilt.provenance[edit.SCHEDULE_KEY]).toBeUndefined();
  });
});

describe('regenerating a question category', () => {
  const start = () => stateOf(kitWithFiveTechnical(), MIXED_PROVENANCE);

  it('says what it would keep before anything is replaced', () => {
    const plan = edit.planCategoryRegeneration(start(), 'technical');

    expect(plan.protectedIds).toEqual(['q3', 'q4', 'q5']);
    expect(plan.replaceableIds).toEqual(['q1', 'q6']);
  });

  it('keeps user-written, edited and pinned questions in their existing order', () => {
    const next = edit.applyRegeneratedQuestions(
      start(),
      'technical',
      freshTechnical(['q7', 'q8']),
      { requirement: 2, question: 8, flashcard: 1 },
      AT,
    );

    const technical = next.kit.questions
      .filter((question) => question.category === 'technical')
      .map((question) => question.id);

    // The three survivors first, in the order they were in, then the new ones.
    expect(technical).toEqual(['q3', 'q4', 'q5', 'q7', 'q8']);
  });

  it('replaces only the plain generated ones', () => {
    const before = start();
    const next = edit.applyRegeneratedQuestions(
      before,
      'technical',
      freshTechnical(['q7']),
      { requirement: 2, question: 7, flashcard: 1 },
      AT,
    );

    const ids = next.kit.questions.map((question) => question.id);
    expect(ids).not.toContain('q1');
    expect(ids).not.toContain('q6');

    // The survivors are the same objects, not merely similarly shaped ones.
    for (const id of ['q3', 'q4', 'q5']) {
      expect(next.kit.questions.find((question) => question.id === id)).toEqual(
        before.kit.questions.find((question) => question.id === id),
      );
    }
  });

  it('leaves every other part of the kit exactly as it was', () => {
    const before = start();
    const next = edit.applyRegeneratedQuestions(
      before,
      'technical',
      freshTechnical(['q7']),
      { requirement: 2, question: 7, flashcard: 1 },
      AT,
    );

    expect(next.kit.questions.filter((question) => question.category === 'behavioural')).toEqual(
      before.kit.questions.filter((question) => question.category === 'behavioural'),
    );
    expect(next.kit.flashcards).toEqual(before.kit.flashcards);
    expect(next.kit.company_brief).toEqual(before.kit.company_brief);
    expect(next.kit.role).toEqual(before.kit.role);
  });

  it('prunes the replaced questions from the study plan and stays valid', () => {
    const next = edit.applyRegeneratedQuestions(
      start(),
      'technical',
      freshTechnical(['q7']),
      { requirement: 2, question: 7, flashcard: 1 },
      AT,
    );

    const scheduled = next.kit.schedule.days.flatMap((day) => day.question_ids);
    expect(scheduled).not.toContain('q1');
    expect(scheduled).not.toContain('q6');
    expect(scheduled).toContain('q3');
    expectValid(next.kit);
  });

  it('forgets the provenance of what it replaced and marks the new ones generated', () => {
    const next = edit.applyRegeneratedQuestions(
      start(),
      'technical',
      freshTechnical(['q7']),
      { requirement: 2, question: 7, flashcard: 1 },
      AT,
    );

    expect(next.provenance['q1']).toBeUndefined();
    expect(next.provenance['q6']).toBeUndefined();
    expect(next.provenance['q7']).toMatchObject({ origin: 'generated', edited: false });
    expect(next.provenance['q3']).toEqual(MIXED_PROVENANCE['q3']);
  });

  /** A regeneration really does run another coverage check, so this one counts. */
  it('counts as one more coverage pass', () => {
    const before = start();
    const next = edit.applyRegeneratedQuestions(
      before,
      'technical',
      freshTechnical(['q7']),
      { requirement: 2, question: 7, flashcard: 1 },
      AT,
    );

    expect(next.kit.coverage.passes).toBe(before.kit.coverage.passes + 1);
  });

  it('regenerating a second time cannot reissue an id it just retired', () => {
    const first = edit.applyRegeneratedQuestions(
      start(),
      'technical',
      freshTechnical(['q7', 'q8']),
      { requirement: 2, question: 8, flashcard: 1 },
      AT,
    );

    const second = edit.applyRegeneratedQuestions(
      first,
      'technical',
      freshTechnical(['q9']),
      { requirement: 2, question: 9, flashcard: 1 },
      AT,
    );

    const ids = second.kit.questions.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['q3', 'q4', 'q5', 'q9', 'q2']);
  });
});
