import { describe, expect, it } from 'vitest';

import { validKit } from '../../test-support/kit-fixture.js';
import { allocateId, allocateIds, EMPTY_ID_COUNTERS, reconcileCounters } from './ids.js';

describe('id allocation', () => {
  it('starts each kind at 1 with its own prefix', () => {
    expect(allocateId(EMPTY_ID_COUNTERS, 'requirement').id).toBe('r1');
    expect(allocateId(EMPTY_ID_COUNTERS, 'question').id).toBe('q1');
    expect(allocateId(EMPTY_ID_COUNTERS, 'flashcard').id).toBe('f1');
  });

  it('advances the counter it used and leaves the others alone', () => {
    const { counters } = allocateId(EMPTY_ID_COUNTERS, 'question');

    expect(counters).toEqual({ requirement: 0, question: 1, flashcard: 0 });
  });

  it('does not mutate the counters it was given', () => {
    const counters = { ...EMPTY_ID_COUNTERS };
    allocateId(counters, 'question');

    expect(counters.question).toBe(0);
  });

  it('allocates a batch in order', () => {
    const { ids, counters } = allocateIds(EMPTY_ID_COUNTERS, 'requirement', 3);

    expect(ids).toEqual(['r1', 'r2', 'r3']);
    expect(counters.requirement).toBe(3);
  });

  it('continues from where a previous batch stopped', () => {
    const first = allocateIds(EMPTY_ID_COUNTERS, 'question', 2);
    const second = allocateIds(first.counters, 'question', 2);

    expect(second.ids).toEqual(['q3', 'q4']);
  });

  /**
   * The property that matters: an id freed by a deletion is never handed out
   * again, so a stale reference can never silently re-attach to a new item.
   */
  it('never reissues an id after the item is deleted', () => {
    const created = allocateIds(EMPTY_ID_COUNTERS, 'question', 3);
    const survivors = created.ids.filter((id) => id !== 'q3');

    // q3 is gone, but the counter does not rewind.
    const next = allocateId(created.counters, 'question');

    expect(next.id).toBe('q4');
    expect(survivors).not.toContain(next.id);
  });
});

describe('reconcileCounters', () => {
  it('lifts a counter that lags behind the ids actually present', () => {
    const reconciled = reconcileCounters(EMPTY_ID_COUNTERS, validKit());

    // Fixture holds r1/r2, q1/q2, f1.
    expect(reconciled).toEqual({ requirement: 2, question: 2, flashcard: 1 });
  });

  it('never moves a counter backwards', () => {
    const ahead = { requirement: 40, question: 40, flashcard: 40 };

    expect(reconcileCounters(ahead, validKit())).toEqual(ahead);
  });

  it('passes the counters through when there is no kit yet', () => {
    const counters = { requirement: 3, question: 5, flashcard: 1 };

    expect(reconcileCounters(counters, null)).toEqual(counters);
  });
});
