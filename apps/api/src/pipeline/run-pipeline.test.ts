import { validateKit } from '@prep/shared';
import { describe, expect, it, vi } from 'vitest';

import type { CompanyCrawler } from '../retrieval/company-crawler.js';
import type { InterviewResearchProvider } from '../research/interview-research-provider.js';
import { createFakeProvider, type RecordedCall } from '../test-support/fake-llm-provider.js';
import { deriveCompanyName } from './assemble-kit.js';
import { runKitPipeline } from './run-pipeline.js';

const JOB_DESCRIPTION = [
  'Senior Backend Engineer',
  '',
  'Required:',
  '- 5+ years with Node.js and TypeScript',
  '- Experience mentoring junior engineers',
].join('\n');

const CRAWLER: CompanyCrawler = {
  crawl: () =>
    Promise.resolve({
      pages: [
        {
          url: 'https://acme.example/',
          title: 'Acme',
          text: 'We build routing software.',
          hiringScore: 0,
        },
      ],
      pagesFailed: [],
      notes: [],
      hiringPagesFound: [],
    }),
};

const NO_SEARCH: InterviewResearchProvider[] = [
  { name: 'none', search: () => Promise.resolve([]) },
];

/**
 * Responds by stage, so a test can make exactly one stage misbehave while the
 * rest of the pipeline runs normally.
 */
function respondByStage(overrides: Record<string, unknown> = {}) {
  return (call: RecordedCall): unknown => {
    const stage = call.options.stage;
    if (stage in overrides) {
      const value = overrides[stage];
      if (typeof value === 'function') return (value as () => unknown)();
      return value;
    }

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
        products: ['Routing platform'],
        companyFacts: ['Based in Rotterdam'],
        engineeringFacts: ['Node.js'],
        hiringFacts: [],
        interviewFacts: [],
      };
    }

    if (stage === 'generate-company-brief') {
      return { summary: 'Acme builds routing software.', what_they_do: 'Route planning.' };
    }

    if (stage === 'generate-role') {
      return {
        title: 'Senior Backend Engineer',
        seniority: 'senior',
        location: 'Rotterdam',
        responsibilities: ['Own the routing service'],
      };
    }

    if (stage.startsWith('generate-questions:')) {
      const category = stage.split(':')[1];
      // Technical and behavioural each cover their own requirement; the other
      // two categories legitimately produce nothing extra here.
      if (category === 'technical') {
        return {
          questions: [
            { requirement_ids: ['r1'], prompt: 'Event loop?', answer_outline: '', difficulty: 3 },
          ],
        };
      }
      if (category === 'behavioural') {
        return {
          questions: [
            {
              requirement_ids: ['r2'],
              prompt: 'Mentoring story?',
              answer_outline: '',
              difficulty: 2,
            },
          ],
        };
      }
      return { questions: [] };
    }

    if (stage === 'generate-flashcards') {
      return {
        flashcards: [{ requirement_ids: ['r1'], front: 'Event loop', back: 'Single thread.' }],
      };
    }

    throw new Error(`Unexpected stage: ${stage}`);
  };
}

function run(overrides: Record<string, unknown> = {}, days = 5) {
  const provider = createFakeProvider(respondByStage(overrides));

  return runKitPipeline(
    { jobDescription: JOB_DESCRIPTION, companyUrl: 'https://acme.example/', days },
    {
      provider,
      crawler: CRAWLER,
      searchProviders: NO_SEARCH,
      now: () => new Date('2026-09-24T09:00:00Z'),
    },
  );
}

describe('deriveCompanyName', () => {
  it.each([
    ['https://acme.example/', 'Acme'],
    ['https://careers.acme-freight.com/jobs', 'Acme Freight'],
    // The registrable domain, not the last two labels.
    ['https://careers.example.co.uk/', 'Example'],
    // Appendix B's own example shape.
    ['http://localhost:8099/acme/', 'Acme'],
  ])('derives %s -> %s', (url, expected) => {
    expect(deriveCompanyName(url)).toBe(expected);
  });

  it('returns empty for something unusable rather than guessing', () => {
    expect(deriveCompanyName('not a url')).toBe('');
  });
});

describe('runKitPipeline', () => {
  it('produces a kit that satisfies the Appendix A contract', async () => {
    const outcome = await run();

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;

    expect(validateKit(outcome.kit).ok).toBe(true);
    expect(outcome.kit.source.company).toBe('Acme');
    expect(outcome.kit.source.jd_chars).toBe(JOB_DESCRIPTION.length);
    expect(outcome.kit.source.pages_used).toEqual(['https://acme.example/']);
    expect(outcome.kit.schedule.days_available).toBe(5);
    expect(outcome.kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(outcome.kit.coverage.passes).toBe(1);
  });

  it('reports progress in order, once per step', async () => {
    const onProgress = vi.fn();
    const provider = createFakeProvider(respondByStage());

    await runKitPipeline(
      { jobDescription: JOB_DESCRIPTION, companyUrl: 'https://acme.example/', days: 3 },
      { provider, crawler: CRAWLER, searchProviders: NO_SEARCH, onProgress },
    );

    const completed = onProgress.mock.calls.map((call) => call[1] as number);
    // Monotonic, never exceeding the declared total.
    expect(completed).toEqual([...completed].sort((a, b) => a - b));
    expect(Math.max(...completed)).toBeLessThanOrEqual(onProgress.mock.calls[0]?.[2] as number);
  });

  /**
   * Extraction and retrieval have no dependency on each other, and retrieval
   * spends no tokens, so overlapping them is free wall-clock against the batch
   * time limit.
   *
   * Observed by ordering rather than by a timing threshold: the crawl is made
   * quick and extraction slow, so the crawl can only finish first if the two
   * actually overlap. Run sequentially, extraction would finish before the
   * crawl had even started.
   */
  it('runs extraction and retrieval concurrently', async () => {
    const finished: string[] = [];

    const quickCrawler: CompanyCrawler = {
      crawl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        finished.push('crawl');
        return { pages: [], pagesFailed: [], notes: [], hiringPagesFound: [] };
      },
    };

    const provider = createFakeProvider(async (call) => {
      if (call.options.stage === 'extract-requirements') {
        await new Promise((resolve) => setTimeout(resolve, 40));
        finished.push('extract');
      }
      return respondByStage()(call);
    });

    await runKitPipeline(
      { jobDescription: JOB_DESCRIPTION, companyUrl: 'https://acme.example/', days: 3 },
      { provider, crawler: quickCrawler, searchProviders: NO_SEARCH },
    );

    expect(finished).toEqual(['crawl', 'extract']);
  });

  describe('recoverable failures', () => {
    it('still produces a kit when the company site cannot be reached', async () => {
      const brokenCrawler: CompanyCrawler = {
        crawl: () => Promise.reject(new Error('DNS failure')),
      };
      const provider = createFakeProvider(respondByStage());

      const outcome = await runKitPipeline(
        { jobDescription: JOB_DESCRIPTION, companyUrl: 'https://acme.example/', days: 3 },
        { provider, crawler: brokenCrawler, searchProviders: NO_SEARCH },
      );

      expect(outcome.status).toBe('ok');
      if (outcome.status !== 'ok') return;

      expect(validateKit(outcome.kit).ok).toBe(true);
      expect(outcome.kit.source.pages_used).toEqual([]);
      expect(outcome.notes.join(' ')).toMatch(/could not be researched/i);
    });

    it('keeps the other categories when one question category fails', async () => {
      const outcome = await run({
        'generate-questions:technical': () => {
          throw new Error('rate limited');
        },
      });

      // r1 has no question now, so the gap loop runs and the run is incomplete
      // rather than silently losing a requirement.
      expect(outcome.status).not.toBe('failed');
      if (outcome.status === 'failed') return;

      const behavioural = outcome.kit.questions.filter((q) => q.category === 'behavioural');
      expect(behavioural.length).toBeGreaterThan(0);
    });

    it('writes an honest brief when the brief stage fails', async () => {
      const outcome = await run({
        'generate-company-brief': () => {
          throw new Error('provider down');
        },
      });

      expect(outcome.status).toBe('ok');
      if (outcome.status !== 'ok') return;

      expect(outcome.kit.company_brief.summary).toMatch(/could not be generated/i);
      expect(outcome.notes.join(' ')).toMatch(/brief could not be written/i);
    });

    it('falls back to the posting for the role when that stage fails', async () => {
      const outcome = await run({
        'generate-role': () => {
          throw new Error('provider down');
        },
      });

      expect(outcome.status).toBe('ok');
      if (outcome.status !== 'ok') return;

      // Taken from the posting's first line, not invented.
      expect(outcome.kit.role.title).toBe('Senior Backend Engineer');
      expect(outcome.kit.role.seniority).toBe('');
    });

    it('produces a kit with no flashcards when that stage fails', async () => {
      const outcome = await run({
        'generate-flashcards': () => {
          throw new Error('provider down');
        },
      });

      expect(outcome.status).toBe('ok');
      if (outcome.status !== 'ok') return;

      expect(outcome.kit.flashcards).toEqual([]);
      expect(validateKit(outcome.kit).ok).toBe(true);
    });
  });

  describe('fatal failures', () => {
    /** Without requirements there is no kit, and padding one would be invention. */
    it('fails when requirement extraction fails', async () => {
      const outcome = await run({
        'extract-requirements': () => {
          throw new Error('provider down');
        },
      });

      expect(outcome.status).toBe('failed');
      if (outcome.status !== 'failed') return;

      expect(outcome.error.code).toBe('EXTRACTION_FAILED');
      expect(outcome).not.toHaveProperty('kit');
    });

    /**
     * "A kit that ships with uncovered must-have requirements has failed at the
     * one job it had." The content is preserved, but the status makes it
     * impossible to report as a finished kit.
     */
    it('returns incomplete when a must-have is still uncovered after the gap rounds', async () => {
      const outcome = await run({
        'generate-questions:technical': { questions: [] },
        'generate-questions:behavioural': { questions: [] },
        'generate-questions:system-design': { questions: [] },
        'generate-questions:company-fit': { questions: [] },
      });

      expect(outcome.status).toBe('incomplete');
      if (outcome.status !== 'incomplete') return;

      expect(outcome.error.code).toBe('COVERAGE_INCOMPLETE');
      expect(outcome.error.message).toContain('r1');

      // Content is preserved for inspection.
      expect(outcome.kit.role.requirements).toHaveLength(2);
      expect(outcome.kit.coverage.uncovered_requirement_ids).toEqual(['r1', 'r2']);
    });

    it('cannot have an incomplete outcome mistaken for a successful one', async () => {
      const outcome = await run({
        'generate-questions:technical': { questions: [] },
        'generate-questions:behavioural': { questions: [] },
        'generate-questions:system-design': { questions: [] },
        'generate-questions:company-fit': { questions: [] },
      });

      // The discriminant is the only way to read the result, so a caller
      // checking for success cannot accidentally accept this one.
      expect(outcome.status).not.toBe('ok');
      expect(['incomplete', 'failed']).toContain(outcome.status);
    });
  });

  it('produces a thin kit that says so for a posting with almost nothing in it', async () => {
    const provider = createFakeProvider(
      respondByStage({
        'extract-requirements': {
          requirements: [
            { text: 'Knows Go', evidence: 'Must know Go.', kind: 'technical', priority: 'must' },
          ],
        },
        'generate-questions:technical': {
          questions: [
            {
              requirement_ids: ['r1'],
              prompt: 'Go concurrency?',
              answer_outline: '',
              difficulty: 2,
            },
          ],
        },
      }),
    );

    const outcome = await runKitPipeline(
      {
        jobDescription: 'Backend engineer. Must know Go.',
        companyUrl: 'https://acme.example/',
        days: 2,
      },
      { provider, crawler: CRAWLER, searchProviders: NO_SEARCH },
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;

    expect(outcome.kit.role.requirements).toHaveLength(1);
    expect(outcome.notes.join(' ')).toMatch(/thin/i);
    expect(validateKit(outcome.kit).ok).toBe(true);
  });

  it.each([1, 2, 7, 60])('validates against the contract for %i day(s)', async (days) => {
    const outcome = await run({}, days);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;

    expect(validateKit(outcome.kit).ok).toBe(true);
    expect(outcome.kit.schedule.days).toHaveLength(days);
  });
});

/**
 * These two travelled no further than the pipeline until now, so the caller
 * storing the kit hardcoded them empty — which made an unreachable site, a site
 * refused by robots.txt and a site merely over the response cap indistinguishable
 * to the reader.
 */
describe('retrieval detail', () => {
  it('carries what could not be reached, and which search answered, out of the pipeline', async () => {
    const crawler: CompanyCrawler = {
      crawl: () =>
        Promise.resolve({
          pages: [
            {
              url: 'https://acme.example/',
              title: 'Acme',
              text: 'We build routing software.',
              hiringScore: 0,
            },
          ],
          pagesFailed: [{ url: 'https://acme.example/blog', reason: 'too-large: > 1500000 bytes' }],
          notes: [],
          hiringPagesFound: [],
        }),
    };

    const outcome = await runKitPipeline(
      { jobDescription: JOB_DESCRIPTION, companyUrl: 'https://acme.example/', days: 5 },
      {
        provider: createFakeProvider(respondByStage()),
        crawler,
        searchProviders: [
          {
            name: 'duckduckgo',
            search: () =>
              Promise.resolve([
                {
                  title: 'Acme interview',
                  url: 'https://reports.example/acme',
                  snippet: 'Four stages.',
                  source: 'duckduckgo',
                },
              ]),
          },
        ],
        now: () => new Date('2026-09-24T09:00:00Z'),
      },
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'failed') return;

    expect(outcome.research.pagesFailed).toEqual([
      { url: 'https://acme.example/blog', reason: 'too-large: > 1500000 bytes' },
    ]);
    expect(outcome.research.searchUsed).toBe('duckduckgo');
  });

  it('reports no search rather than a sentinel when none contributed', async () => {
    const outcome = await run();

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'failed') return;

    expect(outcome.research.searchUsed).toBe('');
    expect(outcome.research.pagesFailed).toEqual([]);
  });
});
