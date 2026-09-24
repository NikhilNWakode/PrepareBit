import type { KitFlashcard } from '@prep/shared';
import { describe, expect, it } from 'vitest';

import { orderQueue } from './order-queue.js';
import {
  confidenceSpread,
  isConfidence,
  practiceProgress,
  recordRating,
  type PracticeMap,
} from './practice-state.js';

/**
 * The practice queue, tested without a database or a clock.
 *
 * Ordering is the part the brief asks to be defended, so it is the part with
 * the most assertions: every rank, both tie-breaks, and the guarantee that the
 * same inputs always produce the same order.
 */

const AT = new Date('2026-09-25T10:00:00.000Z');
const EARLIER = new Date('2026-09-20T10:00:00.000Z');

function card(id: string): KitFlashcard {
  return { id, front: `front ${id}`, back: `back ${id}`, requirement_ids: ['r1'] };
}

const CARDS = [card('f1'), card('f2'), card('f3'), card('f4')];

const ids = (flashcards: readonly KitFlashcard[]): string[] =>
  flashcards.map((flashcard) => flashcard.id);

describe('orderQueue', () => {
  it('puts a card that has never been reviewed before every rated one', () => {
    const practice: PracticeMap = {
      f1: { confidence: 1, reviewedAt: AT, timesReviewed: 1 },
      f2: { confidence: 2, reviewedAt: AT, timesReviewed: 1 },
      f3: { confidence: 3, reviewedAt: AT, timesReviewed: 1 },
      // f4 unseen
    };

    expect(ids(orderQueue(CARDS, practice))).toEqual(['f4', 'f1', 'f2', 'f3']);
  });

  it('orders low, then medium, then high', () => {
    const practice: PracticeMap = {
      f1: { confidence: 3, reviewedAt: AT, timesReviewed: 1 },
      f2: { confidence: 1, reviewedAt: AT, timesReviewed: 1 },
      f3: { confidence: 2, reviewedAt: AT, timesReviewed: 1 },
      f4: { confidence: 3, reviewedAt: AT, timesReviewed: 1 },
    };

    expect(ids(orderQueue(CARDS, practice))).toEqual(['f2', 'f3', 'f1', 'f4']);
  });

  /** A card you struggled with a week ago is staler than one from a minute ago. */
  it('breaks a tie on least recently reviewed', () => {
    const practice: PracticeMap = {
      f1: { confidence: 1, reviewedAt: AT, timesReviewed: 1 },
      f2: { confidence: 1, reviewedAt: EARLIER, timesReviewed: 1 },
    };

    expect(ids(orderQueue([card('f1'), card('f2')], practice))).toEqual(['f2', 'f1']);
  });

  it('breaks an exact tie on id, so the order is fully determined', () => {
    const practice: PracticeMap = {
      f1: { confidence: 2, reviewedAt: AT, timesReviewed: 1 },
      f2: { confidence: 2, reviewedAt: AT, timesReviewed: 1 },
    };

    const forwards = orderQueue([card('f1'), card('f2')], practice);
    const backwards = orderQueue([card('f2'), card('f1')], practice);

    expect(ids(forwards)).toEqual(['f1', 'f2']);
    // Same inputs, same answer, whatever order they arrived in.
    expect(ids(backwards)).toEqual(ids(forwards));
  });

  it('reads a stored date that has been through JSON', () => {
    const practice = {
      f1: { confidence: 1, reviewedAt: AT.toISOString(), timesReviewed: 1 },
      f2: { confidence: 1, reviewedAt: EARLIER.toISOString(), timesReviewed: 1 },
    } as unknown as PracticeMap;

    expect(ids(orderQueue([card('f1'), card('f2')], practice))).toEqual(['f2', 'f1']);
  });

  it('returns an empty queue for a kit with no flashcards', () => {
    expect(orderQueue([], {})).toEqual([]);
  });

  it('does not mutate the flashcards it was given', () => {
    const original = [card('f3'), card('f1')];
    const before = ids(original);

    orderQueue(original, {});

    expect(ids(original)).toEqual(before);
  });
});

describe('recordRating', () => {
  it('creates an entry the first time a card is rated', () => {
    const next = recordRating({}, 'f1', 2, AT);

    expect(next['f1']).toEqual({ confidence: 2, reviewedAt: AT, timesReviewed: 1 });
  });

  /**
   * The confidence is replaced rather than averaged: the question is how well
   * you know it now, and an old answer should not drag the new one to the
   * middle. The count is kept, because that is real.
   */
  it('replaces the confidence and increments the count', () => {
    const first = recordRating({}, 'f1', 1, EARLIER);
    const second = recordRating(first, 'f1', 3, AT);

    expect(second['f1']).toEqual({ confidence: 3, reviewedAt: AT, timesReviewed: 2 });
  });

  it('never resets the count', () => {
    let practice = recordRating({}, 'f1', 1, EARLIER);
    practice = recordRating(practice, 'f1', 1, AT);
    practice = recordRating(practice, 'f1', 2, AT);

    expect(practice['f1']?.timesReviewed).toBe(3);
  });

  it('leaves other cards alone', () => {
    const practice = recordRating(
      { f2: { confidence: 3, reviewedAt: AT, timesReviewed: 5 } },
      'f1',
      1,
      AT,
    );

    expect(practice['f2']).toEqual({ confidence: 3, reviewedAt: AT, timesReviewed: 5 });
  });

  it('accepts only 1, 2 or 3 as a confidence', () => {
    expect([1, 2, 3].every(isConfidence)).toBe(true);
    expect([0, 4, -1, 2.5, '2', null, undefined].some(isConfidence)).toBe(false);
  });
});

describe('progress and spread', () => {
  it('counts what has been covered against the whole deck', () => {
    const practice: PracticeMap = {
      f1: { confidence: 1, reviewedAt: AT, timesReviewed: 1 },
      f2: { confidence: 3, reviewedAt: AT, timesReviewed: 1 },
    };

    expect(practiceProgress(CARDS, practice)).toEqual({ reviewed: 2, total: 4 });
  });

  it('reports the spread of ratings', () => {
    const practice: PracticeMap = {
      f1: { confidence: 1, reviewedAt: AT, timesReviewed: 1 },
      f2: { confidence: 1, reviewedAt: AT, timesReviewed: 1 },
      f3: { confidence: 3, reviewedAt: AT, timesReviewed: 1 },
    };

    expect(confidenceSpread(CARDS, practice)).toEqual({ 1: 2, 2: 0, 3: 1 });
  });

  /** A rating left behind by a deleted card must not inflate anything. */
  it('ignores an entry for a card the kit no longer has', () => {
    const practice: PracticeMap = {
      f1: { confidence: 1, reviewedAt: AT, timesReviewed: 1 },
      'f99-deleted': { confidence: 1, reviewedAt: AT, timesReviewed: 1 },
    };

    expect(practiceProgress(CARDS, practice)).toEqual({ reviewed: 1, total: 4 });
    expect(confidenceSpread(CARDS, practice)).toEqual({ 1: 1, 2: 0, 3: 0 });
  });
});

/**
 * The rule that keeps a run usable: the queue is decided once. Rating a card
 * low must not shuffle it back under the user mid-session — but the *next*
 * session must reflect what they just learned about themselves.
 */
describe('a practice run', () => {
  it('is ordered once, and only re-orders when a new run starts', () => {
    const start: PracticeMap = {};
    const queue = ids(orderQueue(CARDS, start));
    expect(queue).toEqual(['f1', 'f2', 'f3', 'f4']);

    // Part-way through, the first card is rated low.
    const after = recordRating(start, 'f1', 1, AT);

    // The run in progress is the client's snapshot and is unaffected.
    expect(queue).toEqual(['f1', 'f2', 'f3', 'f4']);

    // A fresh run puts the three still-unseen cards ahead of the rated one.
    expect(ids(orderQueue(CARDS, after))).toEqual(['f2', 'f3', 'f4', 'f1']);
  });

  it('brings low-confidence cards to the front once everything has been seen', () => {
    let practice: PracticeMap = {};
    practice = recordRating(practice, 'f1', 3, AT);
    practice = recordRating(practice, 'f2', 1, AT);
    practice = recordRating(practice, 'f3', 2, AT);
    practice = recordRating(practice, 'f4', 3, AT);

    expect(ids(orderQueue(CARDS, practice))).toEqual(['f2', 'f3', 'f1', 'f4']);
  });
});
