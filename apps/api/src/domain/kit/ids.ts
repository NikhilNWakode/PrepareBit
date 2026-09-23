import type { Kit } from '@prep/shared';

/**
 * Stable ids — `r1..rn`, `q1..qn`, `f1..fn` — assigned by code and never by the
 * model. They are what make coverage checkable rather than a matter of opinion:
 * a question claims the requirement ids it covers, and code can verify that.
 *
 * Counters are monotonic and live *outside* the contractual Appendix A object,
 * alongside provenance on the kit document. Deleting an item does not decrement
 * its counter, so a newly created item can never inherit the identity of a
 * deleted one — which would otherwise let a stale reference silently re-attach
 * to the wrong thing.
 */

export interface IdCounters {
  requirement: number;
  question: number;
  flashcard: number;
}

export type IdKind = keyof IdCounters;

const PREFIXES: Record<IdKind, string> = {
  requirement: 'r',
  question: 'q',
  flashcard: 'f',
};

export const EMPTY_ID_COUNTERS: IdCounters = Object.freeze({
  requirement: 0,
  question: 0,
  flashcard: 0,
});

/** Pure: hands back the new id and the advanced counters, mutating nothing. */
export function allocateId(
  counters: IdCounters,
  kind: IdKind,
): { id: string; counters: IdCounters } {
  const next = counters[kind] + 1;
  return {
    id: `${PREFIXES[kind]}${next}`,
    counters: { ...counters, [kind]: next },
  };
}

/** Requirement extraction and question generation both arrive as batches. */
export function allocateIds(
  counters: IdCounters,
  kind: IdKind,
  count: number,
): { ids: string[]; counters: IdCounters } {
  const ids: string[] = [];
  let current = counters;

  for (let index = 0; index < count; index += 1) {
    const allocated = allocateId(current, kind);
    ids.push(allocated.id);
    current = allocated.counters;
  }

  return { ids, counters: current };
}

function highestSuffix(ids: readonly string[], prefix: string): number {
  let highest = 0;

  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const suffix = Number(id.slice(prefix.length));
    if (Number.isInteger(suffix) && suffix > highest) highest = suffix;
  }

  return highest;
}

/**
 * Defensive reconciliation: takes the larger of the stored counter and the
 * highest id actually present. Counters can therefore only ever move forward,
 * so a kit assembled outside the normal path — or a document written before
 * counters existed — still cannot reissue a live id.
 */
export function reconcileCounters(stored: IdCounters, kit: Kit | null): IdCounters {
  if (!kit) return { ...stored };

  return {
    requirement: Math.max(
      stored.requirement,
      highestSuffix(
        kit.role.requirements.map((requirement) => requirement.id),
        PREFIXES.requirement,
      ),
    ),
    question: Math.max(
      stored.question,
      highestSuffix(
        kit.questions.map((question) => question.id),
        PREFIXES.question,
      ),
    ),
    flashcard: Math.max(
      stored.flashcard,
      highestSuffix(
        kit.flashcards.map((flashcard) => flashcard.id),
        PREFIXES.flashcard,
      ),
    ),
  };
}
