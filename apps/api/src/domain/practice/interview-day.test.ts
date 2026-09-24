import type { Kit } from '@prep/shared';
import { describe, expect, it } from 'vitest';

import { emptyDigest, type ResearchDigest } from '../../pipeline/research-digest.js';
import { validKit } from '../../test-support/kit-fixture.js';
import { buildBriefing, requirementSubject } from './interview-day.js';

/**
 * The briefing is composed, not generated. These tests exist to prove that: no
 * model, no network, and — the one that matters — nothing on the page that is
 * not already in the kit.
 */

function digest(overrides: Partial<ResearchDigest> = {}): ResearchDigest {
  return { ...emptyDigest(), ...overrides };
}

describe('buildBriefing', () => {
  it('is deterministic', () => {
    const kit = validKit();
    const research = digest({ products: ['Route planning'], companyFacts: ['Founded 2017'] });

    expect(buildBriefing(kit, research)).toEqual(buildBriefing(kit, research));
  });

  it('carries the company and role the kit already holds', () => {
    const briefing = buildBriefing(validKit(), null);

    expect(briefing.company).toBe('Acme');
    expect(briefing.role).toBe('Senior Backend Engineer');
    expect(briefing.seniority).toBe('senior');
    expect(briefing.location).toBe('Remote');
  });

  it('leads with the must-have requirements', () => {
    const kit = validKit();
    const briefing = buildBriefing(kit, null);

    // r1 is the must; r2 is the nice-to-have.
    expect(briefing.keyRequirements[0]?.id).toBe('r1');
    expect(briefing.keyRequirements.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  /** The whole point of the feature is that it cannot make things up. */
  it('invents nothing when there is no research', () => {
    const briefing = buildBriefing(validKit(), null);

    expect(briefing.companyFacts).toEqual([]);
    expect(briefing.researchIsEmpty).toBe(true);

    const everything = JSON.stringify(briefing).toLowerCase();
    for (const invented of ['probably', 'likely', 'typically', 'industry leader', 'fast-growing']) {
      expect(everything).not.toContain(invented);
    }
  });

  it('surfaces company facts verbatim when research found them', () => {
    const briefing = buildBriefing(
      validKit(),
      digest({ companyFacts: ['Founded in 2017 in Rotterdam.'], products: ['Route optimisation'] }),
    );

    expect(briefing.companyFacts).toContain('Founded in 2017 in Rotterdam.');
    expect(briefing.researchIsEmpty).toBe(false);
  });

  it('puts what the company published about interviewing at the top of the reminders', () => {
    const briefing = buildBriefing(
      validKit(),
      digest({ interviewFacts: ['Take-home exercise, timeboxed to three hours.'] }),
    );

    expect(briefing.reminders[0]).toBe('Take-home exercise, timeboxed to three hours.');
  });

  it('warns about a must-have the kit never covered', () => {
    const kit = validKit();
    kit.coverage.uncovered_requirement_ids = ['r1'];

    const briefing = buildBriefing(kit, null);

    expect(briefing.reminders.join(' ')).toContain('No question in this kit covers');
  });

  it('copes with a kit that has no requirements at all', () => {
    const bare: Kit = {
      ...validKit(),
      role: { title: 'Engineer', seniority: '', responsibilities: [], requirements: [] },
      questions: [],
      flashcards: [],
      schedule: { days_available: 1, days: [{ day: 1, focus: '', question_ids: [], minutes: 15 }] },
      coverage: { uncovered_requirement_ids: [], passes: 1 },
    };

    const briefing = buildBriefing(bare, null);

    expect(briefing.keyRequirements).toEqual([]);
    expect(briefing.reminders).toEqual([]);
    // Still offers the questions that need nothing from the kit to be useful.
    expect(briefing.questionsToAsk.length).toBeGreaterThan(0);
  });
});

/**
 * The difference between a question that sounds written and one that sounds
 * mail-merged. A requirement says what the candidate must have; a question to
 * the interviewer is about the work.
 */
describe('requirementSubject', () => {
  it.each([
    [
      'At least five years of experience building batch and streaming data pipelines',
      'batch and streaming data pipelines',
    ],
    ['5+ years with Node.js and TypeScript', 'Node.js and TypeScript'],
    ['Strong proficiency in SQL and dimensional modeling', 'SQL and dimensional modeling'],
    ['Comfortable mentoring analysts', 'mentoring analysts'],
    ['Experience owning data quality and lineage processes', 'data quality and lineage processes'],
    ['Deep knowledge of distributed systems', 'distributed systems'],
    ['Proven track record of leading incident response', 'leading incident response'],
    ['Ability to work across teams', 'work across teams'],
  ])('reduces %j to its subject', (text, expected) => {
    expect(requirementSubject(text)).toBe(expected);
  });

  it('leaves a phrase it does not recognise alone rather than mangling it', () => {
    expect(requirementSubject('Kubernetes')).toBe('Kubernetes');
    expect(requirementSubject('Owns the routing service')).toBe('Owns the routing service');
  });

  it('never strips a phrase down to nothing', () => {
    for (const text of ['Experience', '5 years', 'Strong', 'Comfortable']) {
      expect(requirementSubject(text).length).toBeGreaterThan(0);
    }
  });
});

describe('questions to ask the interviewer', () => {
  const research = digest({
    products: ['a route optimisation platform'],
    engineeringFacts: ['Backend uses Node.js and TypeScript with PostgreSQL'],
  });

  it('never repeats itself', () => {
    const texts = buildBriefing(validKit(), research).questionsToAsk.map((q) => q.text);

    expect(new Set(texts).size).toBe(texts.length);
  });

  it('gives every question a basis, so none looks invented', () => {
    for (const question of buildBriefing(validKit(), research).questionsToAsk) {
      expect(['role requirements', 'company research', 'the job description']).toContain(
        question.basis,
      );
      expect(question.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('builds from the kit rather than from stock phrasing', () => {
    const texts = buildBriefing(validKit(), research).questionsToAsk.map((q) => q.text);

    // The must-have technical requirement appears in a question about it.
    expect(texts.join(' ')).toContain('Node.js');
    // As does the research.
    expect(texts.join(' ')).toContain('route optimisation platform');
  });

  /** The requirement is a candidate attribute; the question is about the work. */
  it('asks about the subject of a requirement, not the years of experience', () => {
    const texts = buildBriefing(validKit(), research).questionsToAsk.map((q) => q.text);

    expect(texts.join(' ')).toContain('hardest problem the team is facing with Node.js');
    expect(texts.join(' ')).not.toMatch(/challenge.*\d\+? years/i);
    expect(texts.join(' ')).not.toMatch(/facing with (at least |over )?\d/i);
  });

  it('skips the research-backed questions entirely when there is no research', () => {
    const questions = buildBriefing(validKit(), null).questionsToAsk;

    expect(questions.every((question) => question.basis !== 'company research')).toBe(true);
    // And still produces something worth asking.
    expect(questions.length).toBeGreaterThanOrEqual(3);
  });

  it('gives a bare product name an article, and leaves a proper noun alone', () => {
    const bare = buildBriefing(validKit(), digest({ products: ['route optimisation platform'] }));
    expect(bare.questionsToAsk.map((q) => q.text).join(' ')).toContain(
      'contribute to the route optimisation platform',
    );

    const already = buildBriefing(validKit(), digest({ products: ['a dispatch service'] }));
    expect(already.questionsToAsk.map((q) => q.text).join(' ')).toContain(
      'contribute to a dispatch service',
    );

    const proper = buildBriefing(validKit(), digest({ products: ['Kubernetes'] }));
    expect(proper.questionsToAsk.map((q) => q.text).join(' ')).toContain(
      'contribute to Kubernetes',
    );
  });

  it('never leaves a template placeholder in the output', () => {
    const texts = buildBriefing(validKit(), research).questionsToAsk.map((q) => q.text);

    for (const text of texts) {
      expect(text).not.toMatch(/\[|\]|\{|\}|undefined|null/);
    }
  });
});
