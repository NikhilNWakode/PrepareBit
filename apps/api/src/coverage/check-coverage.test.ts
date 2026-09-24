import type { KitQuestion, KitRequirement } from '@prep/shared';
import { describe, expect, it } from 'vitest';

import { checkCoverage, coverageNotes } from './check-coverage.js';

const REQUIREMENTS: KitRequirement[] = [
  { id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'Mentoring', kind: 'behavioural', priority: 'must' },
  { id: 'r3', text: 'Kafka', kind: 'technical', priority: 'nice' },
];

function question(id: string, requirementIds: string[]): KitQuestion {
  return {
    id,
    requirement_ids: requirementIds,
    category: 'technical',
    prompt: 'A question?',
    answer_outline: '',
    difficulty: 2,
  };
}

describe('checkCoverage', () => {
  it('reports everything covered when each requirement has a question', () => {
    const report = checkCoverage(REQUIREMENTS, [
      question('q1', ['r1']),
      question('q2', ['r2']),
      question('q3', ['r3']),
    ]);

    expect(report.coveredRequirementIds).toEqual(['r1', 'r2', 'r3']);
    expect(report.uncoveredRequirementIds).toEqual([]);
    expect(report.uncoveredMustIds).toEqual([]);
  });

  it('counts a single question against every requirement it cites', () => {
    const report = checkCoverage(REQUIREMENTS, [question('q1', ['r1', 'r2', 'r3'])]);

    expect(report.uncoveredRequirementIds).toEqual([]);
  });

  it('reports an uncovered must as blocking', () => {
    const report = checkCoverage(REQUIREMENTS, [question('q1', ['r1']), question('q2', ['r3'])]);

    expect(report.uncoveredRequirementIds).toEqual(['r2']);
    expect(report.uncoveredMustIds).toEqual(['r2']);
  });

  /** A nice-to-have gap is reported honestly but must not trigger the loop. */
  it('reports an uncovered nice without making it blocking', () => {
    const report = checkCoverage(REQUIREMENTS, [question('q1', ['r1']), question('q2', ['r2'])]);

    expect(report.uncoveredRequirementIds).toEqual(['r3']);
    expect(report.uncoveredMustIds).toEqual([]);
  });

  it('treats every requirement as uncovered when there are no questions', () => {
    const report = checkCoverage(REQUIREMENTS, []);

    expect(report.uncoveredRequirementIds).toEqual(['r1', 'r2', 'r3']);
    expect(report.uncoveredMustIds).toEqual(['r1', 'r2']);
  });

  /**
   * Driven by the requirement list, not the citations, so a stale id cannot
   * inflate the result into a false pass.
   */
  it('ignores a citation pointing at a requirement that does not exist', () => {
    const report = checkCoverage(REQUIREMENTS, [question('q1', ['r99'])]);

    expect(report.coveredRequirementIds).toEqual([]);
    expect(report.uncoveredMustIds).toEqual(['r1', 'r2']);
  });

  it('handles an empty requirement list', () => {
    expect(checkCoverage([], [question('q1', ['r1'])])).toEqual({
      coveredRequirementIds: [],
      uncoveredRequirementIds: [],
      uncoveredMustIds: [],
    });
  });

  it('is a pure function of its inputs', () => {
    const questions = [question('q1', ['r1'])];
    const first = checkCoverage(REQUIREMENTS, questions);
    const second = checkCoverage(REQUIREMENTS, questions);

    expect(first).toEqual(second);
  });
});

describe('coverageNotes', () => {
  it('says nothing when everything is covered', () => {
    const report = checkCoverage(REQUIREMENTS, [question('q1', ['r1', 'r2', 'r3'])]);

    expect(coverageNotes(report, REQUIREMENTS)).toEqual([]);
  });

  it('names the uncovered must-haves and their text', () => {
    const report = checkCoverage(REQUIREMENTS, [question('q1', ['r1'])]);
    const notes = coverageNotes(report, REQUIREMENTS).join('\n');

    expect(notes).toContain('must-have');
    expect(notes).toContain('r2');
    expect(notes).toContain('Mentoring');
  });

  it('separates nice-to-have gaps, which are acceptable', () => {
    const report = checkCoverage(REQUIREMENTS, [question('q1', ['r1']), question('q2', ['r2'])]);
    const notes = coverageNotes(report, REQUIREMENTS).join('\n');

    expect(notes).toContain('nice-to-have');
    expect(notes).toContain('acceptable');
    expect(notes).not.toContain('must-have');
  });
});
