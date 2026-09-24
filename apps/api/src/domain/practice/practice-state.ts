import type { KitFlashcard } from '@prep/shared';

/**
 * How well the user felt they knew each card.
 *
 * Kept as a sidecar keyed by flashcard id, exactly like `provenance`, and for
 * the same reason: it is not part of the Appendix A contract and must never
 * appear inside the `kit` object, which is the thing being graded.
 */

export const CONFIDENCE_LEVELS = [1, 2, 3] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  1: 'Low',
  2: 'Medium',
  3: 'High',
};

export interface PracticeEntry {
  confidence: Confidence;
  reviewedAt: Date;
  /** Never reset: a card rated three times has been seen three times. */
  timesReviewed: number;
}

/** Keyed by flashcard id (`f1`, `f2`, ...). */
export type PracticeMap = Record<string, PracticeEntry>;

export function isConfidence(value: unknown): value is Confidence {
  return value === 1 || value === 2 || value === 3;
}

/**
 * A stored date comes back as a `Date` from Mongo but as a string once it has
 * been through JSON. Ordering must not depend on which path it took.
 */
export function reviewedTime(entry: PracticeEntry | undefined): number {
  if (!entry) return 0;

  const value = entry.reviewedAt;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));

  return Number.isNaN(time) ? 0 : time;
}

/**
 * Records one rating.
 *
 * The confidence is replaced rather than averaged — the question is "how well
 * do you know this *now*", and an old answer should not drag the new one
 * towards the middle. The count is kept because it is the honest measure of
 * how much work has gone in, and it is the only number the summary reports
 * that the system has genuinely observed.
 */
export function recordRating(
  practice: PracticeMap,
  cardId: string,
  confidence: Confidence,
  now: Date,
): PracticeMap {
  const existing = practice[cardId];

  return {
    ...practice,
    [cardId]: {
      confidence,
      reviewedAt: now,
      timesReviewed: (existing?.timesReviewed ?? 0) + 1,
    },
  };
}

/*
 * A deleted flashcard leaves its entry behind, and that is deliberate rather
 * than overlooked: ids are never reused, so a stale entry can never be
 * misattributed to a different card, and every reader below walks the kit's
 * flashcards rather than the map's keys, so it is invisible to all of them.
 * Pruning it would mean threading practice through the edit funnel to delete
 * one key nothing reads.
 */

export interface PracticeProgress {
  reviewed: number;
  total: number;
}

/** What has been covered and what has not, counted from the cards themselves. */
export function practiceProgress(
  flashcards: readonly KitFlashcard[],
  practice: PracticeMap,
): PracticeProgress {
  return {
    reviewed: flashcards.filter((flashcard) => practice[flashcard.id] !== undefined).length,
    total: flashcards.length,
  };
}

/** How the ratings fall, for the summary at the end of a run. */
export function confidenceSpread(
  flashcards: readonly KitFlashcard[],
  practice: PracticeMap,
): Record<Confidence, number> {
  const spread: Record<Confidence, number> = { 1: 0, 2: 0, 3: 0 };

  for (const flashcard of flashcards) {
    const entry = practice[flashcard.id];
    if (entry) spread[entry.confidence] += 1;
  }

  return spread;
}
