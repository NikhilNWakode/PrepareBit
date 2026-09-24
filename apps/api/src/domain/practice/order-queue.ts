import type { KitFlashcard } from '@prep/shared';

import { reviewedTime, type PracticeMap } from './practice-state.js';

/**
 * What to practise next: a confidence-weighted queue.
 *
 * Deliberately not spaced repetition. Intervals optimise retention over weeks
 * or months, and this product is built around a countdown that is usually
 * measured in days — telling someone with five days left to come back on
 * Thursday answers a question they are not asking. The brief allows either and
 * asks for the choice to be defended; this is the defence.
 *
 *   rank 0  never reviewed   an unrated card is an unmeasured risk, and you
 *                            cannot call something your weakest subject before
 *                            you have looked at it
 *   rank 1  low confidence   known weak
 *   rank 2  medium
 *   rank 3  high
 *
 * Ties break on least recently reviewed, so a card rated low a week ago comes
 * before one rated low a minute ago, and finally on id, so the order is fully
 * determined and can be asserted in a test.
 *
 * Pure: no clock, no randomness. The caller decides when "now" is.
 */
export function orderQueue(
  flashcards: readonly KitFlashcard[],
  practice: PracticeMap,
): KitFlashcard[] {
  return [...flashcards].sort((left, right) => {
    const leftEntry = practice[left.id];
    const rightEntry = practice[right.id];

    // An unreviewed card has no confidence, which is what puts it first.
    const leftRank = leftEntry?.confidence ?? 0;
    const rightRank = rightEntry?.confidence ?? 0;
    if (leftRank !== rightRank) return leftRank - rightRank;

    const leftSeen = reviewedTime(leftEntry);
    const rightSeen = reviewedTime(rightEntry);
    if (leftSeen !== rightSeen) return leftSeen - rightSeen;

    return left.id.localeCompare(right.id, 'en');
  });
}
