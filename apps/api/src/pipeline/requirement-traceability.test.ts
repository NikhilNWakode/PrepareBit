import { describe, expect, it } from 'vitest';

import {
  normaliseForMatching,
  traceabilityNotes,
  verifyRequirementEvidence,
  type ExtractedRequirement,
} from './requirement-traceability.js';

const JOB_DESCRIPTION = [
  'Senior Backend Engineer',
  '',
  'Required:',
  '- 5+ years building production services with Node.js and TypeScript',
  '- Strong PostgreSQL skills, including query tuning',
  '- Experience mentoring junior engineers',
  '',
  'Nice to have:',
  '- Bonus points for exposure to Kafka',
].join('\n');

function requirement(overrides: Partial<ExtractedRequirement>): ExtractedRequirement {
  return {
    text: '5+ years with Node.js',
    evidence: '5+ years building production services with Node.js and TypeScript',
    kind: 'technical',
    priority: 'must',
    ...overrides,
  };
}

describe('normaliseForMatching', () => {
  it('folds case and collapses whitespace', () => {
    expect(normaliseForMatching('  Node.JS   and\n\nTypeScript ')).toBe('node.js and typescript');
  });

  it('folds smart punctuation, so a re-typed quotation still matches', () => {
    expect(normaliseForMatching('don’t “guess” — verify')).toBe('don\'t "guess" - verify');
  });
});

describe('verifyRequirementEvidence', () => {
  it('keeps a requirement whose evidence is quoted verbatim', () => {
    const result = verifyRequirementEvidence(JOB_DESCRIPTION, [requirement({})]);

    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toEqual([]);
  });

  it('keeps evidence that differs only in whitespace or case', () => {
    const result = verifyRequirementEvidence(JOB_DESCRIPTION, [
      requirement({
        evidence: '5+ YEARS building   production services\nwith Node.js and TypeScript',
      }),
    ]);

    expect(result.kept).toHaveLength(1);
  });

  /**
   * The failure the brief punishes hardest: a plausible requirement for a
   * technology the posting never mentions.
   */
  it('drops a requirement whose evidence is not in the job description', () => {
    const result = verifyRequirementEvidence(JOB_DESCRIPTION, [
      requirement({
        text: 'Kubernetes administration',
        evidence: 'Deep experience operating Kubernetes clusters in production',
      }),
    ]);

    expect(result.kept).toEqual([]);
    expect(result.dropped[0]?.reason).toMatch(/does not appear in the job description/);
  });

  it('drops a requirement with no usable quotation', () => {
    for (const evidence of ['', '   ', 'and']) {
      const result = verifyRequirementEvidence(JOB_DESCRIPTION, [requirement({ evidence })]);

      expect(result.kept).toEqual([]);
      expect(result.dropped[0]?.reason).toMatch(/no usable quotation/);
    }
  });

  /** A real span cited for an unrelated claim is still invention. */
  it('drops a requirement whose evidence is real but unrelated to it', () => {
    const result = verifyRequirementEvidence(JOB_DESCRIPTION, [
      requirement({
        text: 'Kubernetes cluster administration at scale',
        evidence: 'Experience mentoring junior engineers',
      }),
    ]);

    expect(result.kept).toEqual([]);
    expect(result.dropped[0]?.reason).toMatch(/does not support this requirement/);
  });

  /** Dropping a genuine must-have costs coverage, so the bar stays low. */
  it('keeps a reworded requirement backed by a genuine quotation', () => {
    const result = verifyRequirementEvidence(JOB_DESCRIPTION, [
      requirement({
        text: 'Able to tune PostgreSQL queries',
        evidence: 'Strong PostgreSQL skills, including query tuning',
      }),
    ]);

    expect(result.kept).toHaveLength(1);
  });

  it('judges each requirement on its own evidence', () => {
    const result = verifyRequirementEvidence(JOB_DESCRIPTION, [
      requirement({}),
      requirement({ text: 'Invented', evidence: 'Must hold a commercial pilot licence' }),
      requirement({
        text: 'Mentoring junior engineers',
        evidence: 'Experience mentoring junior engineers',
        kind: 'behavioural',
      }),
    ]);

    expect(result.kept.map((entry) => entry.text)).toEqual([
      '5+ years with Node.js',
      'Mentoring junior engineers',
    ]);
    expect(result.dropped).toHaveLength(1);
  });

  it('returns nothing rather than failing on an empty job description', () => {
    const result = verifyRequirementEvidence('', [requirement({})]);

    expect(result.kept).toEqual([]);
    expect(result.dropped).toHaveLength(1);
  });

  it('handles an empty requirement list', () => {
    expect(verifyRequirementEvidence(JOB_DESCRIPTION, [])).toEqual({ kept: [], dropped: [] });
  });
});

describe('traceabilityNotes', () => {
  it('says nothing when nothing was dropped', () => {
    expect(traceabilityNotes([])).toEqual([]);
  });

  it('records what was discarded and why, rather than hiding it', () => {
    const notes = traceabilityNotes([{ text: 'Kubernetes', reason: 'not in the posting' }]);

    expect(notes.join('\n')).toContain('Kubernetes');
    expect(notes.join('\n')).toContain('not in the posting');
  });
});
