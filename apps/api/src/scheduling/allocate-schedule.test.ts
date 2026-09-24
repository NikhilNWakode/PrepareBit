import type { KitQuestion, KitRequirement } from '@prep/shared';
import { describe, expect, it } from 'vitest';

import { allocateCounts, allocateSchedule, planSchedule } from './allocate-schedule.js';

const REQUIREMENTS: KitRequirement[] = [
  { id: 'r1', text: 'Node.js in production', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'must' },
  { id: 'r3', text: 'Kafka', kind: 'technical', priority: 'nice' },
];

function questions(count: number): KitQuestion[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `q${index + 1}`,
    // Alternates must/nice and cycles difficulty, so ordering is observable.
    requirement_ids: [index % 3 === 2 ? 'r3' : index % 2 === 0 ? 'r1' : 'r2'],
    category: 'technical' as const,
    prompt: `Question ${index + 1}?`,
    answer_outline: '',
    difficulty: ((index % 3) + 1) as 1 | 2 | 3,
  }));
}

const DAY_COUNTS = [1, 2, 5, 7, 30, 60];

describe('allocateCounts', () => {
  it('sums to exactly the total, so no question is dropped or duplicated', () => {
    for (const days of DAY_COUNTS) {
      for (const total of [0, 1, 7, 20, 100]) {
        const counts = allocateCounts(total, days);

        expect(counts).toHaveLength(days);
        expect(counts.reduce((sum, count) => sum + count, 0)).toBe(total);
      }
    }
  });

  it('front-loads, giving the first day at least as much as the last', () => {
    const counts = allocateCounts(20, 5);

    expect(counts[0]).toBeGreaterThan(counts[4] as number);
    expect(counts).toEqual([7, 5, 4, 3, 1]);
  });

  it('puts everything on one day when there is only one', () => {
    expect(allocateCounts(20, 1)).toEqual([20]);
  });

  it('returns all zeros when there is nothing to allocate', () => {
    expect(allocateCounts(0, 3)).toEqual([0, 0, 0]);
  });
});

describe('allocateSchedule', () => {
  it.each(DAY_COUNTS)('produces exactly %i day(s), numbered 1..N in order', (days) => {
    const schedule = allocateSchedule(REQUIREMENTS, questions(12), days);

    expect(schedule.days_available).toBe(days);
    expect(schedule.days).toHaveLength(days);
    expect(schedule.days.map((day) => day.day)).toEqual(
      Array.from({ length: days }, (_unused, index) => index + 1),
    );
  });

  it.each(DAY_COUNTS)('gives every day a focus and positive integer minutes (%i days)', (days) => {
    const schedule = allocateSchedule(REQUIREMENTS, questions(12), days);

    for (const day of schedule.days) {
      expect(day.focus.length).toBeGreaterThan(0);
      expect(Number.isInteger(day.minutes)).toBe(true);
      expect(day.minutes).toBeGreaterThan(0);
    }
  });

  it.each(DAY_COUNTS)('only ever references questions that exist (%i days)', (days) => {
    const all = questions(12);
    const known = new Set(all.map((question) => question.id));
    const schedule = allocateSchedule(REQUIREMENTS, all, days);

    for (const day of schedule.days) {
      for (const id of day.question_ids) expect(known.has(id)).toBe(true);
    }
  });

  /**
   * The invariant that makes "every question is scheduled" mean something:
   * review repetitions must not be able to stand in for an introduction.
   */
  it.each(DAY_COUNTS)('introduces every question exactly once (%i days)', (days) => {
    const all = questions(12);
    const plans = planSchedule(REQUIREMENTS, all, days);

    const introduced = plans.flatMap((plan) => plan.introduced);

    expect(introduced).toHaveLength(all.length);
    expect(new Set(introduced).size).toBe(all.length);
    expect([...introduced].sort()).toEqual(all.map((question) => question.id).sort());
  });

  it('only ever reviews questions introduced on an earlier day', () => {
    const plans = planSchedule(REQUIREMENTS, questions(6), 20);

    const seen = new Set<string>();
    for (const plan of plans) {
      for (const id of plan.review) {
        expect(seen.has(id)).toBe(true);
      }
      for (const id of plan.introduced) seen.add(id);
    }
  });

  it('never counts a review repetition as an introduction', () => {
    const plans = planSchedule(REQUIREMENTS, questions(4), 12);

    const reviewDays = plans.filter((plan) => plan.review.length > 0);
    expect(reviewDays.length).toBeGreaterThan(0);

    for (const plan of reviewDays) {
      expect(plan.introduced).toEqual([]);
    }
  });

  /**
   * "Harder and higher-priority material lands earlier, not the night before."
   *
   * Priority is the dominant term and difficulty breaks ties within it, so the
   * invariant is about study order as a whole. Asserting on difficulty alone
   * would wrongly demand that a hard nice-to-have outrank an easy must-have.
   */
  describe('study order', () => {
    const all = questions(12);
    const byId = new Map(all.map((question) => [question.id, question]));

    const isMust = (id: string): boolean =>
      byId.get(id)?.requirement_ids.some((requirementId) => requirementId !== 'r3') ?? false;

    const score = (id: string): number => {
      const question = byId.get(id);
      if (!question) return 0;
      return (isMust(id) ? 2 : 1) * 10 + question.difficulty;
    };

    const average = (ids: string[]): number =>
      ids.reduce((sum, id) => sum + score(id), 0) / Math.max(1, ids.length);

    it('front-loads the highest-scoring material', () => {
      const plans = planSchedule(REQUIREMENTS, all, 4);
      const first = plans[0]?.introduced ?? [];
      const last = plans.at(-1)?.introduced ?? [];

      expect(average(first)).toBeGreaterThan(average(last));
    });

    it('introduces every must-have before any nice-to-have', () => {
      const introduced = planSchedule(REQUIREMENTS, all, 4).flatMap((plan) => plan.introduced);
      const firstNice = introduced.findIndex((id) => !isMust(id));
      const lastMust = introduced.map(isMust).lastIndexOf(true);

      expect(firstNice).toBeGreaterThan(lastMust);
    });

    it('puts harder material first among questions of equal priority', () => {
      // All must-priority, so difficulty is the only thing separating them.
      const uniform: KitQuestion[] = [1, 2, 3].map((difficulty) => ({
        id: `q${difficulty}`,
        requirement_ids: ['r1'],
        category: 'technical' as const,
        prompt: 'Q?',
        answer_outline: '',
        difficulty: difficulty as 1 | 2 | 3,
      }));

      const introduced = planSchedule(REQUIREMENTS, uniform, 3).flatMap((plan) => plan.introduced);

      expect(introduced).toEqual(['q3', 'q2', 'q1']);
    });
  });

  it('covers every must-have requirement somewhere in the schedule', () => {
    const all = questions(12);
    const schedule = allocateSchedule(REQUIREMENTS, all, 7);
    const byId = new Map(all.map((question) => [question.id, question]));

    const scheduledRequirements = new Set(
      schedule.days
        .flatMap((day) => day.question_ids)
        .flatMap((id) => byId.get(id)?.requirement_ids ?? []),
    );

    for (const requirement of REQUIREMENTS.filter((entry) => entry.priority === 'must')) {
      expect(scheduledRequirements.has(requirement.id)).toBe(true);
    }
  });

  it('puts everything on day one when only one day is available', () => {
    const all = questions(9);
    const schedule = allocateSchedule(REQUIREMENTS, all, 1);

    expect(schedule.days).toHaveLength(1);
    expect(schedule.days[0]?.question_ids).toHaveLength(9);
  });

  describe('60 days with few questions', () => {
    it('still returns exactly 60 valid days, filling the rest with review', () => {
      const schedule = allocateSchedule(REQUIREMENTS, questions(6), 60);

      expect(schedule.days).toHaveLength(60);
      for (const day of schedule.days) {
        expect(day.question_ids.length).toBeGreaterThan(0);
        expect(day.minutes).toBeGreaterThan(0);
      }
    });

    it('marks the filled days as review rather than pretending they are new', () => {
      const schedule = allocateSchedule(REQUIREMENTS, questions(6), 60);
      const later = schedule.days.slice(10);

      expect(later.every((day) => day.focus.startsWith('Review'))).toBe(true);
    });
  });

  /** A posting nothing could be extracted from still needs a valid schedule. */
  describe('no questions at all', () => {
    it.each(DAY_COUNTS)('returns exactly %i empty but valid days', (days) => {
      const schedule = allocateSchedule([], [], days);

      expect(schedule.days_available).toBe(days);
      expect(schedule.days).toHaveLength(days);

      for (const day of schedule.days) {
        // No invented ids, and minutes still schema-valid.
        expect(day.question_ids).toEqual([]);
        expect(Number.isInteger(day.minutes)).toBe(true);
        expect(day.minutes).toBeGreaterThan(0);
        expect(day.focus).toMatch(/no study material/i);
      }
    });
  });

  it('treats a zero or negative day count as a single day rather than failing', () => {
    expect(allocateSchedule(REQUIREMENTS, questions(3), 0).days).toHaveLength(1);
  });

  it('is deterministic — identical input produces an identical schedule', () => {
    const all = questions(12);

    expect(allocateSchedule(REQUIREMENTS, all, 7)).toEqual(allocateSchedule(REQUIREMENTS, all, 7));
  });

  it('does not depend on the order questions arrive in', () => {
    const all = questions(12);
    const shuffled = [...all].reverse();

    expect(allocateSchedule(REQUIREMENTS, shuffled, 5)).toEqual(
      allocateSchedule(REQUIREMENTS, all, 5),
    );
  });
});
