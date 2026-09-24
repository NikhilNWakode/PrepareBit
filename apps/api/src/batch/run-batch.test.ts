import { validateKit } from '@prep/shared';
import { describe, expect, it } from 'vitest';

import type { CompanyCrawler } from '../retrieval/company-crawler.js';
import type { InterviewResearchProvider } from '../research/interview-research-provider.js';
import { createFakeProvider, type RecordedCall } from '../test-support/fake-llm-provider.js';
import { batchOutputSchema, fallbackCaseId } from './batch-contract.js';
import { runBatch } from './run-batch.js';

const JD = [
  'Senior Backend Engineer',
  '',
  'Required:',
  '- 5+ years with Node.js and TypeScript',
  '- Experience mentoring junior engineers',
].join('\n');

const CRAWLER: CompanyCrawler = {
  crawl: () =>
    Promise.resolve({
      pages: [{ url: 'https://acme.example/', title: 'Acme', text: 'Routing.', hiringScore: 0 }],
      pagesFailed: [],
      notes: [],
      hiringPagesFound: [],
    }),
};

const NO_SEARCH: InterviewResearchProvider[] = [
  { name: 'none', search: () => Promise.resolve([]) },
];

/** A complete, well-behaved set of stage responses. */
function stageResponse(call: RecordedCall, options: { coverTechnical?: boolean } = {}): unknown {
  const stage = call.options.stage;

  if (stage === 'extract-requirements') {
    return {
      requirements: [
        {
          text: '5+ years with Node.js and TypeScript',
          evidence: '5+ years with Node.js and TypeScript',
          kind: 'technical',
          priority: 'must',
        },
        {
          text: 'Mentoring junior engineers',
          evidence: 'Experience mentoring junior engineers',
          kind: 'behavioural',
          priority: 'must',
        },
      ],
    };
  }

  if (stage === 'synthesise-research') {
    return {
      industry: 'Logistics',
      products: ['Routing'],
      companyFacts: [],
      engineeringFacts: ['Node.js'],
      hiringFacts: [],
      interviewFacts: [],
    };
  }

  if (stage === 'generate-company-brief') {
    return { summary: 'Acme routes freight.', what_they_do: 'Routing.' };
  }

  if (stage === 'generate-role') {
    return {
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      location: 'Remote',
      responsibilities: ['Own the routing service'],
    };
  }

  if (stage.startsWith('generate-questions:')) {
    const category = stage.split(':')[1];
    if (category === 'technical') {
      if (options.coverTechnical === false) return { questions: [] };
      return {
        questions: [
          { requirement_ids: ['r1'], prompt: 'Event loop?', answer_outline: '', difficulty: 3 },
        ],
      };
    }
    if (category === 'behavioural') {
      return {
        questions: [
          { requirement_ids: ['r2'], prompt: 'Mentoring?', answer_outline: '', difficulty: 2 },
        ],
      };
    }
    return { questions: [] };
  }

  if (stage === 'generate-flashcards') {
    return { flashcards: [{ requirement_ids: ['r1'], front: 'Loop', back: 'Single thread.' }] };
  }

  throw new Error(`Unexpected stage: ${stage}`);
}

function deps(responder: (call: RecordedCall) => unknown = (call) => stageResponse(call)) {
  return {
    provider: createFakeProvider(responder),
    crawler: CRAWLER,
    searchProviders: NO_SEARCH,
    now: () => new Date('2026-09-24T09:12:44.123Z'),
  };
}

function aCase(id: string, days = 5) {
  return { id, jd: JD, company_url: 'https://acme.example/', days };
}

describe('runBatch', () => {
  it('produces a document matching Appendix B', async () => {
    const result = await runBatch([aCase('case-01')], deps());

    expect(batchOutputSchema.safeParse(result.output).success).toBe(true);
    expect(result.output.version).toBe('1.0');
    // Appendix B's own example carries no milliseconds.
    expect(result.output.generated_at).toBe('2026-09-24T09:12:44Z');
  });

  it('writes exactly one entry per input case, keyed by the given id', async () => {
    const result = await runBatch([aCase('case-01'), aCase('case-02'), aCase('case-03')], deps());

    expect(result.output.kits.map((entry) => entry.id)).toEqual(['case-01', 'case-02', 'case-03']);
  });

  it('gives each case its own days value', async () => {
    const result = await runBatch([aCase('a', 1), aCase('b', 30)], deps());

    const days = result.output.kits.map((entry) => entry.kit?.schedule.days.length);
    expect(days).toEqual([1, 30]);
  });

  it('produces kits that validate against the Appendix A contract', async () => {
    const result = await runBatch([aCase('case-01')], deps());
    const kit = result.output.kits[0]?.kit;

    expect(kit).not.toBeNull();
    if (kit) expect(validateKit(kit).ok).toBe(true);
  });

  describe('failure isolation', () => {
    /** "Continues after one case fails, recording the failure rather than aborting." */
    it('keeps going when a case in the middle collapses', async () => {
      let callCount = 0;

      const result = await runBatch(
        [aCase('first'), aCase('second'), aCase('third')],
        deps((call) => {
          if (call.options.stage === 'extract-requirements') {
            callCount += 1;
            // Only the second case's extraction fails, which is fatal for it.
            if (callCount === 2) throw new Error('provider exploded');
          }
          return stageResponse(call);
        }),
      );

      expect(result.output.kits.map((entry) => entry.status)).toEqual(['ok', 'failed', 'ok']);
      expect(result.okCount).toBe(2);
      expect(result.failedCount).toBe(1);
    });

    it('records a failed case with a null kit and a real error', async () => {
      const result = await runBatch(
        [aCase('broken')],
        deps((call) => {
          if (call.options.stage === 'extract-requirements') throw new Error('provider down');
          return stageResponse(call);
        }),
      );

      const entry = result.output.kits[0];
      expect(entry?.status).toBe('failed');
      expect(entry?.kit).toBeNull();
      expect(entry?.error?.code).toBe('GENERATION_FAILED');
      expect(entry?.error?.message).toContain('provider down');
    });

    it('still produces valid output when every case fails', async () => {
      const result = await runBatch(
        [aCase('a'), aCase('b')],
        deps(() => {
          throw new Error('everything is down');
        }),
      );

      expect(batchOutputSchema.safeParse(result.output).success).toBe(true);
      expect(result.okCount).toBe(0);
    });
  });

  describe('per-case validation', () => {
    it('records a malformed case rather than rejecting the whole file', async () => {
      const result = await runBatch(
        [aCase('good'), { id: 'bad', jd: 'x' }, aCase('also-good')],
        deps(),
      );

      expect(result.output.kits.map((entry) => entry.status)).toEqual(['ok', 'failed', 'ok']);
      expect(result.output.kits[1]?.error?.code).toBe('VALIDATION_FAILED');
    });

    it('gives a case with no usable id a deterministic positional id', async () => {
      const result = await runBatch([aCase('good'), { jd: 'x' }], deps());

      expect(result.output.kits[1]?.id).toBe(fallbackCaseId(1));
      expect(result.output.kits[1]?.id).toBe('input-index-1');
    });

    it('keeps a real id even when the rest of the case is invalid', async () => {
      const result = await runBatch([{ id: 'named-but-broken', days: 'five' }], deps());

      expect(result.output.kits[0]?.id).toBe('named-but-broken');
      expect(result.output.kits[0]?.status).toBe('failed');
    });

    it.each([0, -1, 1.5])('rejects a days value of %s', async (days) => {
      const result = await runBatch([{ ...aCase('x'), days }], deps());

      expect(result.output.kits[0]?.status).toBe('failed');
    });
  });

  describe('an incomplete kit', () => {
    /**
     * The FAQ reserves `failed` for a case no kit could be produced for at all,
     * and says a partially researched case is still ok with the gaps recorded.
     */
    it('is written as ok, with the gap visible in coverage', async () => {
      const result = await runBatch(
        [aCase('partial')],
        deps((call) => stageResponse(call, { coverTechnical: false })),
      );

      const entry = result.output.kits[0];
      expect(entry?.status).toBe('ok');
      expect(entry?.kit).not.toBeNull();

      // Nothing hidden: the uncovered must-have is named in the kit itself.
      expect(entry?.kit?.coverage.uncovered_requirement_ids).toContain('r1');
    });

    it('never fabricates a question to make the gap disappear', async () => {
      const result = await runBatch(
        [aCase('partial')],
        deps((call) => stageResponse(call, { coverTechnical: false })),
      );

      const kit = result.output.kits[0]?.kit;
      expect(kit?.questions.some((question) => question.requirement_ids.includes('r1'))).toBe(
        false,
      );
    });
  });

  describe('retrieval problems', () => {
    /** "A missing hiring page is not a failure." */
    it('degrades to a job-description-based kit when the company cannot be reached', async () => {
      const result = await runBatch([aCase('unreachable')], {
        ...deps(),
        crawler: { crawl: () => Promise.reject(new Error('ENOTFOUND')) },
      });

      const entry = result.output.kits[0];
      expect(entry?.status).toBe('ok');
      expect(entry?.kit?.source.pages_used).toEqual([]);
      expect(entry?.kit?.role.requirements.length).toBeGreaterThan(0);
    });
  });

  describe('per-case timeout', () => {
    it('reports a case that overruns, and cancels its work', async () => {
      let aborted = false;

      const result = await runBatch([aCase('slow')], {
        ...deps(),
        caseTimeoutMs: 20,
        provider: createFakeProvider(async (call) => {
          if (call.options.stage === 'extract-requirements') {
            // Long enough to overrun, and observing the signal proves the
            // deadline reached the provider rather than merely being raced.
            await new Promise((resolve) => setTimeout(resolve, 80));
            aborted = call.options.signal?.aborted ?? false;
          }
          return stageResponse(call);
        }),
      });

      expect(result.output.kits[0]?.status).toBe('failed');
      expect(result.output.kits[0]?.error?.message).toMatch(/time limit/i);
      expect(aborted).toBe(true);
    });
  });

  it('reports progress for every case', async () => {
    const started: string[] = [];
    const finished: string[] = [];

    await runBatch([aCase('a'), aCase('b')], {
      ...deps(),
      onCaseStart: (_index, _total, id) => started.push(id),
      onCaseFinish: (entry) => finished.push(entry.id),
    });

    expect(started).toEqual(['a', 'b']);
    expect(finished).toEqual(['a', 'b']);
  });

  it('handles an empty case list without failing', async () => {
    const result = await runBatch([], deps());

    expect(result.output.kits).toEqual([]);
    expect(batchOutputSchema.safeParse(result.output).success).toBe(true);
  });
});
