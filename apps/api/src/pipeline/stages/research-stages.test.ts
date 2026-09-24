import type { KitQuestion, KitRequirement } from '@prep/shared';
import { describe, expect, it } from 'vitest';

import { EMPTY_ID_COUNTERS } from '../../domain/kit/ids.js';
import type { ResearchResult } from '../../research/research-service.js';
import { createFakeProvider } from '../../test-support/fake-llm-provider.js';
import { emptyDigest, isDigestEmpty, normaliseDigest } from '../research-digest.js';
import { generateCompanyBrief } from './generate-company-brief.js';
import { generateFlashcards } from './generate-flashcards.js';
import { generateRole } from './generate-role.js';
import { synthesiseResearch } from './synthesise-research.js';

const DIGEST_RESPONSE = {
  industry: 'Freight logistics',
  products: ['Route optimisation platform'],
  companyFacts: ['140 people in Rotterdam'],
  engineeringFacts: ['Node.js, TypeScript, PostgreSQL'],
  hiringFacts: ['Small cross-functional teams'],
  interviewFacts: ['Take-home exercise', 'System design round'],
};

function research(overrides: Partial<ResearchResult> = {}): ResearchResult {
  return {
    pages: [
      {
        url: 'https://acme.example/',
        title: 'Acme Freight',
        text: 'We build route optimisation software.',
        hiringScore: 0,
      },
      {
        url: 'https://acme.example/handbook/how-we-hire',
        title: 'How we hire',
        text: 'Our interview process has four stages, including a take-home.',
        hiringScore: 4,
      },
    ],
    interviewReports: [],
    pagesFailed: [],
    notes: [],
    hiringPagesFound: ['https://acme.example/handbook/how-we-hire'],
    ...overrides,
  };
}

describe('synthesiseResearch', () => {
  it('compresses the corpus into a digest and records the real sources', async () => {
    const provider = createFakeProvider([DIGEST_RESPONSE]);

    const result = await synthesiseResearch(research(), provider);

    expect(result.digest.industry).toBe('Freight logistics');
    // Sources come from the pages actually fetched, not from the model.
    expect(result.digest.sources).toEqual([
      'https://acme.example/',
      'https://acme.example/handbook/how-we-hire',
    ]);
  });

  /** Hiring pages are what change the kit, so they must survive the cap. */
  it('puts the hiring page first, ahead of the homepage', async () => {
    const provider = createFakeProvider([DIGEST_RESPONSE]);

    await synthesiseResearch(research(), provider);

    const prompt = provider.lastPrompt();
    expect(prompt.indexOf('How we hire')).toBeLessThan(prompt.indexOf('Acme Freight'));
  });

  it('treats page text as data rather than instructions', async () => {
    const provider = createFakeProvider([DIGEST_RESPONSE]);

    await synthesiseResearch(research(), provider);

    expect(provider.lastPrompt()).toContain('BEGIN_UNTRUSTED company pages');
  });

  /** Nothing retrieved means nothing to summarise, and no tokens worth spending. */
  it('returns an empty digest without calling the model when nothing was found', async () => {
    const provider = createFakeProvider([]);

    const result = await synthesiseResearch(
      research({ pages: [], interviewReports: [], hiringPagesFound: [] }),
      provider,
    );

    expect(provider.calls).toHaveLength(0);
    expect(isDigestEmpty(result.digest)).toBe(true);
    expect(result.usage).toBeNull();
    expect(result.notes.join(' ')).toMatch(/rather than guessed at/i);
  });

  it('caps a very large site and says the least relevant pages were dropped', async () => {
    const provider = createFakeProvider([DIGEST_RESPONSE]);
    const bulky = research({
      pages: Array.from({ length: 12 }, (_unused, index) => ({
        url: `https://acme.example/page-${index}`,
        title: `Page ${index}`,
        text: 'filler. '.repeat(600),
        hiringScore: 0,
      })),
    });

    const result = await synthesiseResearch(bulky, provider);

    expect(provider.lastPrompt().length).toBeLessThan(11_000);
    expect(result.notes.join(' ')).toMatch(/least relevant/i);
  });

  it('bounds the digest whatever the model returns', () => {
    const digest = normaliseDigest(
      {
        industry: 'x'.repeat(500),
        products: Array.from({ length: 30 }, (_unused, index) => `product ${index}`),
        companyFacts: ['a fact', 'A FACT', 'another'],
        engineeringFacts: [],
        hiringFacts: [],
        interviewFacts: [],
      },
      ['https://acme.example/'],
    );

    expect(digest.industry.length).toBeLessThanOrEqual(220);
    expect(digest.products.length).toBeLessThanOrEqual(6);
    // Case-insensitive de-duplication, so the same fact is not paid for twice.
    expect(digest.companyFacts).toEqual(['a fact', 'another']);
  });
});

describe('generateCompanyBrief', () => {
  it('writes a brief from the digest', async () => {
    const provider = createFakeProvider([
      { summary: 'Acme routes freight.', what_they_do: 'Route optimisation.' },
    ]);

    const result = await generateCompanyBrief(
      normaliseDigest(DIGEST_RESPONSE, ['https://acme.example/']),
      provider,
    );

    expect(result.brief.summary).toBe('Acme routes freight.');
    expect(result.brief.sources).toEqual(['https://acme.example/']);
  });

  it('never sees the raw pages, only the digest', async () => {
    const provider = createFakeProvider([{ summary: 'x', what_they_do: 'y' }]);

    await generateCompanyBrief(normaliseDigest(DIGEST_RESPONSE, []), provider);

    expect(provider.lastPrompt()).toContain('Freight logistics');
    expect(provider.lastPrompt()).not.toContain('We build route optimisation software.');
  });

  /**
   * "A company you can find nothing about should produce an honest brief rather
   * than a fabricated one."
   */
  it('says nothing was found instead of inventing a company', async () => {
    const provider = createFakeProvider([]);

    const result = await generateCompanyBrief(emptyDigest(), provider);

    expect(provider.calls).toHaveLength(0);
    expect(result.brief.summary).toMatch(/no public information/i);
    expect(result.brief.what_they_do).toBe('');
    expect(result.usage).toBeNull();
  });

  it('marks an absent interview process explicitly rather than omitting it', async () => {
    const provider = createFakeProvider([{ summary: 'x', what_they_do: 'y' }]);

    await generateCompanyBrief(
      normaliseDigest({ ...DIGEST_RESPONSE, interviewFacts: [] }, []),
      provider,
    );

    expect(provider.lastPrompt()).toContain('nothing published about how they interview');
  });
});

describe('generateRole', () => {
  const requirements: KitRequirement[] = [
    { id: 'r1', text: '5+ years with Node.js', kind: 'technical', priority: 'must' },
  ];

  it('returns the role breakdown', async () => {
    const provider = createFakeProvider([
      {
        title: 'Senior Backend Engineer',
        seniority: 'senior',
        responsibilities: ['Own the routing service', '  '],
      },
    ]);

    const result = await generateRole('Senior Backend Engineer...', requirements, provider);

    expect(result.role.title).toBe('Senior Backend Engineer');
    // Empty entries are dropped rather than shipped as blank responsibilities.
    expect(result.role.responsibilities).toEqual(['Own the routing service']);
  });

  it('is told the requirements so it does not restate them as responsibilities', async () => {
    const provider = createFakeProvider([{ title: 'x', seniority: '', responsibilities: [] }]);

    await generateRole('A posting', requirements, provider);

    const prompt = provider.lastPrompt();
    expect(prompt).toContain('5+ years with Node.js');
    expect(prompt).toContain('Do not repeat them as');
  });
});

describe('generateFlashcards', () => {
  const requirements: KitRequirement[] = [
    { id: 'r1', text: '5+ years with Node.js', kind: 'technical', priority: 'must' },
  ];

  const questions: KitQuestion[] = [
    {
      id: 'q1',
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'How do you avoid blocking the event loop?',
      answer_outline: 'Offload CPU-bound work.',
      difficulty: 2,
    },
  ];

  it('returns contract-shaped flashcards with code-assigned ids', async () => {
    const provider = createFakeProvider([
      {
        flashcards: [
          { requirement_ids: ['r1'], front: 'Event loop', back: 'Single-threaded queue.' },
        ],
      },
    ]);

    const result = await generateFlashcards(requirements, questions, provider, EMPTY_ID_COUNTERS);

    expect(result.flashcards[0]?.id).toBe('f1');
    expect(result.counters.flashcard).toBe(1);
  });

  /** Already-distilled material: going back to the corpus would re-spend tokens. */
  it('is built from requirements and questions, never from the pages', async () => {
    const provider = createFakeProvider([{ flashcards: [] }]);

    await generateFlashcards(requirements, questions, provider, EMPTY_ID_COUNTERS);

    const prompt = provider.lastPrompt();
    expect(prompt).toContain('5+ years with Node.js');
    expect(prompt).toContain('How do you avoid blocking the event loop?');

    // No untrusted block is wrapped in. The shared rules mention the markers by
    // name when explaining them, so the check is for an actual opened block.
    const opensUntrustedBlock = prompt
      .split('\n')
      .some((line) => line.startsWith('BEGIN_UNTRUSTED'));
    expect(opensUntrustedBlock).toBe(false);
  });

  it('drops a card that references nothing real', async () => {
    const provider = createFakeProvider([
      {
        flashcards: [
          { requirement_ids: ['r99'], front: 'Bogus', back: 'x' },
          { requirement_ids: ['r1'], front: 'Real', back: 'y' },
        ],
      },
    ]);

    const result = await generateFlashcards(requirements, questions, provider, EMPTY_ID_COUNTERS);

    expect(result.flashcards).toHaveLength(1);
    expect(result.flashcards[0]?.front).toBe('Real');
  });

  it('skips the call when there is nothing to practise against', async () => {
    const provider = createFakeProvider([]);

    const result = await generateFlashcards([], [], provider, EMPTY_ID_COUNTERS);

    expect(provider.calls).toHaveLength(0);
    expect(result.flashcards).toEqual([]);
    expect(result.usage).toBeNull();
  });
});
