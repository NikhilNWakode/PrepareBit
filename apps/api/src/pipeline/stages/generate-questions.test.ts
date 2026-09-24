import type { KitRequirement } from '@prep/shared';
import { describe, expect, it } from 'vitest';

import { EMPTY_ID_COUNTERS } from '../../domain/kit/ids.js';
import { createFakeProvider } from '../../test-support/fake-llm-provider.js';
import { emptyDigest, type ResearchDigest } from '../research-digest.js';
import { CATEGORY_PLANS, generateQuestions } from './generate-questions.js';
import type { RoleBreakdown } from './generate-role.js';

const REQUIREMENTS: KitRequirement[] = [
  { id: 'r1', text: '5+ years with Node.js', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'must' },
  { id: 'r3', text: 'Freight logistics domain knowledge', kind: 'domain', priority: 'nice' },
];

const ROLE: RoleBreakdown = {
  title: 'Senior Backend Engineer',
  seniority: 'senior',
  location: 'Rotterdam',
  responsibilities: ['Own the routing service'],
};

function digestWith(overrides: Partial<ResearchDigest> = {}): ResearchDigest {
  return {
    ...emptyDigest(),
    industry: 'Freight logistics',
    products: ['Route optimisation platform'],
    companyFacts: ['140 people, based in Rotterdam'],
    engineeringFacts: ['Node.js and PostgreSQL'],
    hiringFacts: ['Small cross-functional teams'],
    interviewFacts: ['A take-home exercise', 'A system design round'],
    ...overrides,
  };
}

function response(count: number, requirementId = 'r1') {
  return {
    questions: Array.from({ length: count }, (_unused, index) => ({
      requirement_ids: [requirementId],
      prompt: `Question ${index + 1}?`,
      answer_outline: 'Points to hit.',
      difficulty: 2,
    })),
  };
}

describe('generateQuestions', () => {
  it('returns contract-shaped questions with code-assigned ids', async () => {
    const provider = createFakeProvider([response(2)]);

    const result = await generateQuestions(
      'technical',
      REQUIREMENTS,
      digestWith(),
      ROLE,
      provider,
      EMPTY_ID_COUNTERS,
    );

    expect(result.questions.map((question) => question.id)).toEqual(['q1', 'q2']);
    expect(result.questions[0]?.category).toBe('technical');
    expect(result.counters.question).toBe(2);
  });

  describe('the four categories are genuinely different', () => {
    it('gives each category a different requirement subset', () => {
      const subset = (category: keyof typeof CATEGORY_PLANS) =>
        CATEGORY_PLANS[category].selectRequirements(REQUIREMENTS).map((r) => r.id);

      expect(subset('technical')).toEqual(['r1']);
      expect(subset('behavioural')).toEqual(['r2']);
      expect(subset('system-design')).toEqual(['r1', 'r3']);
      // Anchored to must-haves, so a fit question still assesses something asked for.
      expect(subset('company-fit')).toEqual(['r1', 'r2']);
    });

    it('gives each category different research context', () => {
      const digest = digestWith();
      const contexts = Object.values(CATEGORY_PLANS).map((plan) => plan.buildContext(digest, ROLE));

      expect(new Set(contexts).size).toBe(4);
    });

    it('gives each category different instructions', () => {
      const instructions = Object.values(CATEGORY_PLANS).map((plan) => plan.instructions);

      expect(new Set(instructions).size).toBe(4);
    });

    it('spreads the four calls across both model buckets', () => {
      const tiers = Object.values(CATEGORY_PLANS).map((plan) => plan.tier);

      // Per-model rate limits mean an even split roughly halves wall-clock time.
      expect(new Set(tiers)).toEqual(new Set(['fast', 'primary']));
    });

    /** A behavioural requirement must not be handed to the technical prompt. */
    it('keeps behavioural requirements out of the technical call', async () => {
      const provider = createFakeProvider([response(1)]);

      await generateQuestions(
        'technical',
        REQUIREMENTS,
        digestWith(),
        ROLE,
        provider,
        EMPTY_ID_COUNTERS,
      );

      const prompt = provider.lastPrompt();
      expect(prompt).toContain('5+ years with Node.js');
      expect(prompt).not.toContain('Mentoring junior engineers');
    });
  });

  /**
   * The sequencing has to be genuine: a company publishing a take-home and a
   * system design round should produce a different kit from one that says
   * nothing.
   */
  it('feeds a published interview process into system-design questions', async () => {
    const withProcess = createFakeProvider([response(1)]);
    await generateQuestions(
      'system-design',
      REQUIREMENTS,
      digestWith(),
      ROLE,
      withProcess,
      EMPTY_ID_COUNTERS,
    );

    const withoutProcess = createFakeProvider([response(1)]);
    await generateQuestions(
      'system-design',
      REQUIREMENTS,
      digestWith({ interviewFacts: [], products: [], engineeringFacts: [] }),
      ROLE,
      withoutProcess,
      EMPTY_ID_COUNTERS,
    );

    expect(withProcess.lastPrompt()).toContain('system design round');
    expect(withoutProcess.lastPrompt()).not.toContain('system design round');
    expect(withProcess.lastPrompt()).not.toBe(withoutProcess.lastPrompt());
  });

  it('passes the seniority signal to system-design, which scopes the problem', async () => {
    const provider = createFakeProvider([response(1)]);

    await generateQuestions(
      'system-design',
      REQUIREMENTS,
      digestWith(),
      ROLE,
      provider,
      EMPTY_ID_COUNTERS,
    );

    expect(provider.lastPrompt()).toContain('senior');
  });

  describe('coverage stays verifiable', () => {
    it('drops a question citing a requirement that does not exist', async () => {
      const provider = createFakeProvider([
        {
          questions: [
            { requirement_ids: ['r99'], prompt: 'Bogus?', answer_outline: '', difficulty: 2 },
            { requirement_ids: ['r1'], prompt: 'Real?', answer_outline: '', difficulty: 2 },
          ],
        },
      ]);

      const result = await generateQuestions(
        'technical',
        REQUIREMENTS,
        digestWith(),
        ROLE,
        provider,
        EMPTY_ID_COUNTERS,
      );

      expect(result.questions).toHaveLength(1);
      expect(result.questions[0]?.prompt).toBe('Real?');
      expect(result.notes.join(' ')).toMatch(/did not reference any requirement/);
    });

    it('drops a question that cites nothing at all', async () => {
      const provider = createFakeProvider([
        {
          questions: [{ requirement_ids: [], prompt: 'Vague?', answer_outline: '', difficulty: 1 }],
        },
      ]);

      const result = await generateQuestions(
        'technical',
        REQUIREMENTS,
        digestWith(),
        ROLE,
        provider,
        EMPTY_ID_COUNTERS,
      );

      expect(result.questions).toEqual([]);
    });

    it('removes a duplicated requirement id', async () => {
      const provider = createFakeProvider([
        {
          questions: [
            { requirement_ids: ['r1', 'r1'], prompt: 'Q?', answer_outline: '', difficulty: 2 },
          ],
        },
      ]);

      const result = await generateQuestions(
        'technical',
        REQUIREMENTS,
        digestWith(),
        ROLE,
        provider,
        EMPTY_ID_COUNTERS,
      );

      expect(result.questions[0]?.requirement_ids).toEqual(['r1']);
    });
  });

  /** No matching requirements means no call — and no tokens spent. */
  it('skips the call entirely when no requirement matches the category', async () => {
    const provider = createFakeProvider([]);

    const result = await generateQuestions(
      'behavioural',
      [REQUIREMENTS[0] as KitRequirement],
      digestWith(),
      ROLE,
      provider,
      EMPTY_ID_COUNTERS,
    );

    expect(provider.calls).toHaveLength(0);
    expect(result.questions).toEqual([]);
    expect(result.usage).toBeNull();
    expect(result.notes.join(' ')).toMatch(/no behavioural questions/i);
  });

  it('admits when company-fit questions had no company research behind them', async () => {
    const provider = createFakeProvider([response(1)]);

    const result = await generateQuestions(
      'company-fit',
      REQUIREMENTS,
      emptyDigest(),
      ROLE,
      provider,
      EMPTY_ID_COUNTERS,
    );

    expect(result.notes.join(' ')).toMatch(/without any published hiring information/i);
  });

  it('continues numbering from the counters it was given', async () => {
    const provider = createFakeProvider([response(2)]);

    const result = await generateQuestions(
      'technical',
      REQUIREMENTS,
      digestWith(),
      ROLE,
      provider,
      { requirement: 3, question: 7, flashcard: 0 },
    );

    expect(result.questions.map((question) => question.id)).toEqual(['q8', 'q9']);
  });
});
