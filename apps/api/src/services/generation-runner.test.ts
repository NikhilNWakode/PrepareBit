import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { kitRepository, type KitInput } from '../repositories/kit.repository.js';
import { createFakeProvider, type RecordedCall } from '../test-support/fake-llm-provider.js';
import {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from '../test-support/database.js';
import type { CompanyCrawler } from '../retrieval/company-crawler.js';
import { generateKit } from './generation-runner.js';

/**
 * The runner's one guarantee: every execution ends in a terminal state.
 *
 * A kit stuck in `generating` is worse than a failed one, because the interface
 * polls it forever and the user is never told anything.
 */

const database = await connectTestDatabase(import.meta.url);

const INPUT: KitInput = {
  jd: [
    'Senior Backend Engineer',
    '',
    'Required:',
    '- 5+ years with Node.js and TypeScript',
    '- Experience mentoring junior engineers',
  ].join('\n'),
  company_url: 'https://acme.example/',
  days: 5,
};

/** Enough of a response set for the pipeline to complete. */
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
      products: [],
      companyFacts: [],
      engineeringFacts: [],
      hiringFacts: [],
      interviewFacts: [],
    };
  }

  if (stage === 'generate-company-brief') return { summary: 'Acme.', what_they_do: 'Routing.' };

  if (stage === 'generate-role') {
    return {
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      location: '',
      responsibilities: [],
    };
  }

  if (stage.startsWith('generate-questions:')) {
    const category = stage.split(':')[1];
    if (category === 'technical') {
      if (options.coverTechnical === false) return { questions: [] };
      return {
        questions: [
          { requirement_ids: ['r1'], prompt: 'Loop?', answer_outline: '', difficulty: 2 },
        ],
      };
    }
    if (category === 'behavioural') {
      return {
        questions: [
          { requirement_ids: ['r2'], prompt: 'Mentor?', answer_outline: '', difficulty: 2 },
        ],
      };
    }
    return { questions: [] };
  }

  if (stage === 'generate-flashcards') {
    return { flashcards: [{ requirement_ids: ['r1'], front: 'Loop', back: 'One thread.' }] };
  }

  throw new Error(`Unexpected stage: ${stage}`);
}

async function seedKit(): Promise<string> {
  const created = await kitRepository.create(
    '6ab41dc0cc4069c489f03e7d',
    INPUT,
    `fp-${Math.random()}`,
  );
  return created.id;
}

/** Reads back through the repository, since that is what the API serves. */
async function reload(kitId: string) {
  return kitRepository.findOwned('6ab41dc0cc4069c489f03e7d', kitId);
}

afterEach(clearTestDatabase);
afterAll(disconnectTestDatabase);

describe.skipIf(!database.available)('generateKit', () => {
  it('stores a completed kit when the pipeline succeeds', async () => {
    const kitId = await seedKit();

    await generateKit(kitId, INPUT, {
      provider: createFakeProvider((call) => stageResponse(call)),
    });

    const stored = await reload(kitId);
    expect(stored?.status).toBe('completed');
    expect(stored?.kit).not.toBeNull();
    expect(stored?.kit?.schedule.days).toHaveLength(5);
    expect(stored?.error).toBeNull();
  });

  it('records the research notes so the interface can show what was not found', async () => {
    const kitId = await seedKit();

    await generateKit(kitId, INPUT, {
      provider: createFakeProvider((call) => stageResponse(call)),
    });

    const stored = await reload(kitId);
    expect(stored?.research.notes.length).toBeGreaterThan(0);
  });

  /** An incomplete kit is still a kit; the gap travels with it. */
  /**
   * The reason a page was skipped used to stop at the pipeline boundary and was
   * stored as an empty list, so the interface could only ever say "no pages
   * could be retrieved" — the same sentence for a site that was unreachable and
   * one that was merely too large to download.
   */
  it('stores why a page could not be read, rather than an empty list', async () => {
    const kitId = await seedKit();
    const crawler: CompanyCrawler = {
      crawl: () =>
        Promise.resolve({
          pages: [],
          pagesFailed: [{ url: 'https://acme.example/', reason: 'too-large: > 3000000 bytes' }],
          notes: [],
          hiringPagesFound: [],
        }),
    };

    await generateKit(kitId, INPUT, {
      provider: createFakeProvider((call) => stageResponse(call)),
      crawler,
    });

    const stored = await reload(kitId);
    expect(stored?.research.pagesFailed).toEqual([
      { url: 'https://acme.example/', reason: 'too-large: > 3000000 bytes' },
    ]);
  });

  it('stores an incomplete result as completed, with the coverage gap intact', async () => {
    const kitId = await seedKit();

    await generateKit(kitId, INPUT, {
      provider: createFakeProvider((call) => stageResponse(call, { coverTechnical: false })),
    });

    const stored = await reload(kitId);
    expect(stored?.status).toBe('completed');
    expect(stored?.kit?.coverage.uncovered_requirement_ids).toContain('r1');
  });

  it('marks the kit failed when the pipeline cannot produce one', async () => {
    const kitId = await seedKit();

    await generateKit(kitId, INPUT, {
      provider: createFakeProvider((call) => {
        if (call.options.stage === 'extract-requirements') throw new Error('provider down');
        return stageResponse(call);
      }),
    });

    const stored = await reload(kitId);
    expect(stored?.status).toBe('failed');
    expect(stored?.error?.message).toContain('provider down');
    expect(stored?.kit).toBeNull();
  });

  /**
   * The safety net. Whatever goes wrong, the kit must not be left mid-flight
   * for the interface to poll forever.
   */
  it('never leaves a kit in a non-terminal state', async () => {
    const kitId = await seedKit();

    await generateKit(kitId, INPUT, {
      provider: {
        name: 'broken',
        generateText: () => {
          throw new Error('catastrophic');
        },
        generateStructured: () => {
          throw new Error('catastrophic');
        },
      },
    });

    const stored = await reload(kitId);
    expect(['completed', 'failed']).toContain(stored?.status);
    expect(stored?.status).toBe('failed');
  });

  it('does not reject, so a fire-and-forget call cannot become an unhandled rejection', async () => {
    const kitId = await seedKit();

    await expect(
      generateKit(kitId, INPUT, {
        provider: {
          name: 'broken',
          generateText: () => Promise.reject(new Error('nope')),
          generateStructured: () => Promise.reject(new Error('nope')),
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('persists progress as the pipeline advances', async () => {
    const kitId = await seedKit();
    const seen: number[] = [];

    await generateKit(kitId, INPUT, {
      provider: createFakeProvider(async (call) => {
        const current = await reload(kitId);
        if (current?.progress) seen.push(current.progress.completedSteps);
        return stageResponse(call);
      }),
    });

    // Progress was written during the run, not only at the end.
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeGreaterThan(0);

    const stored = await reload(kitId);
    expect(stored?.progress.totalSteps).toBe(9);
  });
});

describe.skipIf(!database.available)('failStaleGenerations', () => {
  it('fails a kit abandoned mid-generation by a dead process', async () => {
    const kitId = await seedKit();
    await kitRepository.updateProgress(kitId, 'researching', {
      step: 'Researching the company',
      completedSteps: 2,
      totalSteps: 9,
    });

    // Everything older than "now" counts as stale for the purposes of the test.
    const failed = await kitRepository.failStaleGenerations(new Date(Date.now() + 1000));

    expect(failed).toBe(1);

    const stored = await reload(kitId);
    expect(stored?.status).toBe('failed');
    expect(stored?.error?.message).toMatch(/interrupted/i);
  });

  it('leaves a completed kit alone', async () => {
    const kitId = await seedKit();
    await generateKit(kitId, INPUT, {
      provider: createFakeProvider((call) => stageResponse(call)),
    });

    await kitRepository.failStaleGenerations(new Date(Date.now() + 1000));

    expect((await reload(kitId))?.status).toBe('completed');
  });
});
