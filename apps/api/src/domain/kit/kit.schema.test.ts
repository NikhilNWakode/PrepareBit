import { describe, expect, it } from 'vitest';

import { validateKit } from '@prep/shared';

import { validKit } from '../../test-support/kit-fixture.js';

/**
 * Structure validation is one of the three behaviours the brief names as most
 * worth protecting, and the kit shape is graded automatically against job
 * descriptions we never see. Each test breaks exactly one rule.
 */
function expectRejected(mutate: (kit: ReturnType<typeof validKit>) => void, matching: RegExp) {
  const kit = validKit();
  mutate(kit);

  const result = validateKit(kit);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.issues.join('\n')).toMatch(matching);
}

describe('kit contract', () => {
  it('accepts a well-formed kit', () => {
    const result = validateKit(validKit());

    expect(result.ok).toBe(true);
    if (!result.ok) console.error(result.issues);
  });

  it('rejects a value that is not an object at all', () => {
    expect(validateKit(null).ok).toBe(false);
    expect(validateKit('a kit').ok).toBe(false);
    expect(validateKit([]).ok).toBe(false);
  });

  describe('required fields', () => {
    it('rejects a missing top-level section', () => {
      expectRejected((kit) => {
        // @ts-expect-error -- deliberately removing a required section
        delete kit.coverage;
      }, /coverage/);
    });

    it('rejects a missing field inside source', () => {
      expectRejected((kit) => {
        // @ts-expect-error -- deliberately removing a required field
        delete kit.source.jd_chars;
      }, /source\.jd_chars/);
    });
  });

  describe('enumerations', () => {
    it('rejects a requirement kind outside the contract', () => {
      expectRejected((kit) => {
        // @ts-expect-error -- invalid on purpose
        kit.role.requirements[0].kind = 'soft-skill';
      }, /kind/);
    });

    it('rejects American "behavioral" for the British spelling the contract uses', () => {
      expectRejected((kit) => {
        // @ts-expect-error -- invalid on purpose
        kit.role.requirements[1].kind = 'behavioral';
      }, /kind/);
    });

    it('rejects a priority outside must/nice', () => {
      expectRejected((kit) => {
        // @ts-expect-error -- invalid on purpose
        kit.role.requirements[0].priority = 'required';
      }, /priority/);
    });

    it('rejects a question category outside the contract', () => {
      expectRejected((kit) => {
        // @ts-expect-error -- invalid on purpose
        kit.questions[0].category = 'system design';
      }, /category/);
    });
  });

  describe('numeric rules', () => {
    it.each([0, 4, -1])('rejects difficulty %s', (difficulty) => {
      expectRejected((kit) => {
        kit.questions[0]!.difficulty = difficulty;
      }, /difficulty/);
    });

    it('rejects a fractional difficulty', () => {
      expectRejected((kit) => {
        kit.questions[0]!.difficulty = 1.5;
      }, /difficulty/);
    });

    it('rejects fractional minutes', () => {
      expectRejected((kit) => {
        kit.schedule.days[0]!.minutes = 59.5;
      }, /minutes/);
    });

    it('rejects a zero-minute day', () => {
      expectRejected((kit) => {
        kit.schedule.days[0]!.minutes = 0;
      }, /minutes/);
    });

    it('accepts an integer-valued float for minutes', () => {
      const kit = validKit();
      kit.schedule.days[0]!.minutes = 60.0;
      expect(validateKit(kit).ok).toBe(true);
    });
  });

  describe('identifier uniqueness', () => {
    it('rejects duplicate requirement ids', () => {
      expectRejected((kit) => {
        kit.role.requirements[1]!.id = 'r1';
      }, /Duplicate requirement id "r1"/);
    });

    it('rejects duplicate question ids', () => {
      expectRejected((kit) => {
        kit.questions[1]!.id = 'q1';
      }, /Duplicate question id "q1"/);
    });
  });

  describe('referential integrity', () => {
    it('rejects a question referencing an unknown requirement', () => {
      expectRejected((kit) => {
        kit.questions[0]!.requirement_ids = ['r99'];
      }, /Question "q1" references unknown requirement "r99"/);
    });

    it('rejects a flashcard referencing an unknown requirement', () => {
      expectRejected((kit) => {
        kit.flashcards[0]!.requirement_ids = ['r99'];
      }, /Flashcard "f1" references unknown requirement "r99"/);
    });

    it('rejects coverage referencing an unknown requirement', () => {
      expectRejected((kit) => {
        kit.coverage.uncovered_requirement_ids = ['r99'];
      }, /Coverage references unknown requirement "r99"/);
    });

    // Called out explicitly in the brief.
    it('rejects a schedule day referencing a question that does not exist', () => {
      expectRejected((kit) => {
        kit.schedule.days[0]!.question_ids = ['q99'];
      }, /Day 1 references unknown question "q99"/);
    });

    it('rejects a schedule still pointing at a deleted question', () => {
      expectRejected((kit) => {
        kit.questions.pop();
      }, /unknown question "q2"/);
    });
  });

  describe('schedule shape', () => {
    it('rejects a day count that disagrees with days_available', () => {
      expectRejected((kit) => {
        kit.schedule.days_available = 5;
      }, /Schedule has 2 days but days_available is 5/);
    });

    it('rejects day numbers that do not run 1..N', () => {
      expectRejected((kit) => {
        kit.schedule.days[0]!.day = 3;
      }, /Day numbers must run 1\.\.2/);
    });

    it('rejects days that are out of order', () => {
      expectRejected((kit) => {
        kit.schedule.days.reverse();
      }, /Day numbers must run 1\.\.2/);
    });
  });

  it('reports every problem at once, not just the first', () => {
    const kit = validKit();
    kit.schedule.days_available = 9;
    kit.questions[0]!.requirement_ids = ['r99'];

    const result = validateKit(kit);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(1);
  });
});
