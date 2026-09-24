import type { KitQuestion, KitRequirement } from '@prep/shared';
import { describe, expect, it } from 'vitest';

import { EMPTY_ID_COUNTERS } from '../domain/kit/ids.js';
import { emptyDigest } from '../pipeline/research-digest.js';
import type { RoleBreakdown } from '../pipeline/stages/generate-role.js';
import { createFakeProvider } from '../test-support/fake-llm-provider.js';
import { closeCoverageGaps, GAP_CATEGORY_BY_KIND } from './close-gaps.js';

const REQUIREMENTS: KitRequirement[] = [
  { id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'Mentoring', kind: 'behavioural', priority: 'must' },
  { id: 'r3', text: 'Kafka', kind: 'technical', priority: 'nice' },
];

const ROLE: RoleBreakdown = {
  title: 'Senior Backend Engineer',
  seniority: 'senior',
  location: 'Remote',
  responsibilities: [],
};

const DIGEST = { ...emptyDigest(), engineeringFacts: ['Node.js'], hiringFacts: ['Small teams'] };

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

/** What the model returns for a gap-filling call. */
function filling(requirementId: string) {
  return {
    questions: [
      {
        requirement_ids: [requirementId],
        prompt: `Covering ${requirementId}?`,
        answer_outline: 'Points.',
        difficulty: 2,
      },
    ],
  };
}

function deps(provider: ReturnType<typeof createFakeProvider>) {
  return { provider, digest: DIGEST, role: ROLE };
}

describe('GAP_CATEGORY_BY_KIND', () => {
  /** One deterministic mapping, so a gap always reaches a category built for it. */
  it('routes each requirement kind to exactly one category', () => {
    expect(GAP_CATEGORY_BY_KIND).toEqual({
      technical: 'technical',
      behavioural: 'behavioural',
      domain: 'system-design',
    });
  });
});

describe('closeCoverageGaps', () => {
  it('does nothing and counts one pass when the first draft is already complete', async () => {
    const provider = createFakeProvider([]);
    const covered = [question('q1', ['r1']), question('q2', ['r2']), question('q3', ['r3'])];

    const result = await closeCoverageGaps(REQUIREMENTS, covered, EMPTY_ID_COUNTERS, deps(provider));

    expect(provider.calls).toHaveLength(0);
    expect(result.passes).toBe(1);
    expect(result.coverage.uncoveredMustIds).toEqual([]);
  });

  it('closes a gap in one round and counts two passes', async () => {
    const provider = createFakeProvider([filling('r2')]);

    const result = await closeCoverageGaps(
      REQUIREMENTS,
      [question('q1', ['r1'])],
      EMPTY_ID_COUNTERS,
      deps(provider),
    );

    expect(result.passes).toBe(2);
    expect(result.coverage.uncoveredMustIds).toEqual([]);
    expect(result.questions).toHaveLength(2);
  });

  /** A nice-to-have gap is reported, never retried — it costs tokens to fix nothing. */
  it('does not run a gap round for a nice-to-have', async () => {
    const provider = createFakeProvider([]);
    const questions = [question('q1', ['r1']), question('q2', ['r2'])];

    const result = await closeCoverageGaps(
      REQUIREMENTS,
      questions,
      EMPTY_ID_COUNTERS,
      deps(provider),
    );

    expect(provider.calls).toHaveLength(0);
    expect(result.passes).toBe(1);
    expect(result.coverage.uncoveredRequirementIds).toEqual(['r3']);
  });

  it('sends each uncovered requirement to the category matching its kind', async () => {
    const provider = createFakeProvider([filling('r1'), filling('r2')]);

    await closeCoverageGaps(REQUIREMENTS, [], EMPTY_ID_COUNTERS, deps(provider));

    const categories = provider.calls.map((call) => call.options.stage);
    expect(categories).toContain('generate-questions:technical');
    expect(categories).toContain('generate-questions:behavioural');
  });

  it('sends only the uncovered requirements, not the whole list', async () => {
    const provider = createFakeProvider([filling('r2')]);

    await closeCoverageGaps(
      REQUIREMENTS,
      [question('q1', ['r1'])],
      EMPTY_ID_COUNTERS,
      deps(provider),
    );

    const prompt = provider.lastPrompt();
    expect(prompt).toContain('r2');
    expect(prompt).not.toContain('r1:');
  });

  describe('when a gap cannot be closed', () => {
    /**
     * Two rounds, then stop. Each round here closes one gap but leaves another,
     * so the loop runs to its limit rather than breaking early, and the third
     * requirement is still reported as uncovered.
     */
    it('stops after the maximum rounds and leaves the remaining gap reported', async () => {
      const threeMusts: KitRequirement[] = [
        { id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'PostgreSQL', kind: 'technical', priority: 'must' },
        { id: 'r5', text: 'Kubernetes', kind: 'technical', priority: 'must' },
      ];

      // Round one covers r1, round two covers r2. Nothing ever covers r5.
      const provider = createFakeProvider([filling('r1'), filling('r2')]);

      const result = await closeCoverageGaps(threeMusts, [], EMPTY_ID_COUNTERS, deps(provider));

      // One initial check plus one after each of the two rounds.
      expect(result.passes).toBe(3);
      expect(provider.calls).toHaveLength(2);
      expect(result.coverage.uncoveredMustIds).toEqual(['r5']);
    });

    /** The gap stays open rather than being closed with something invented. */
    it('never fabricates a question to make the count look right', async () => {
      const provider = createFakeProvider(() => ({ questions: [] }));

      const result = await closeCoverageGaps(
        REQUIREMENTS,
        [question('q1', ['r1'])],
        EMPTY_ID_COUNTERS,
        deps(provider),
      );

      expect(result.questions).toHaveLength(1);
      expect(result.coverage.uncoveredMustIds).toEqual(['r2']);
    });

    it('stops early when a round adds nothing, rather than repeating itself', async () => {
      const provider = createFakeProvider(() => ({ questions: [] }));

      const result = await closeCoverageGaps(
        REQUIREMENTS,
        [question('q1', ['r1'])],
        EMPTY_ID_COUNTERS,
        deps(provider),
      );

      // One attempt, one recheck — no second identical round.
      expect(provider.calls).toHaveLength(1);
      expect(result.passes).toBe(2);
    });

    it('records a failed gap call instead of letting it end the run', async () => {
      const provider = createFakeProvider(() => {
        throw new Error('provider exploded');
      });

      const result = await closeCoverageGaps(
        REQUIREMENTS,
        [question('q1', ['r1'])],
        EMPTY_ID_COUNTERS,
        deps(provider),
      );

      expect(result.notes.join(' ')).toMatch(/could not generate .* coverage gap/i);
      expect(result.coverage.uncoveredMustIds).toEqual(['r2']);
    });
  });

  it('keeps id numbering continuous across gap questions', async () => {
    const provider = createFakeProvider([filling('r2')]);

    const result = await closeCoverageGaps(REQUIREMENTS, [question('q1', ['r1'])], {
      requirement: 3,
      question: 1,
      flashcard: 0,
    }, deps(provider));

    expect(result.questions[1]?.id).toBe('q2');
    expect(result.counters.question).toBe(2);
  });
});
