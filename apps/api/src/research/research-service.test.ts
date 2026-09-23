import { describe, expect, it, vi } from 'vitest';

import type { CompanyCrawler, CompanySiteResult } from '../retrieval/company-crawler.js';
import {
  dedupeResults,
  type InterviewResearchProvider,
  type InterviewSearchResult,
} from './interview-research-provider.js';
import { research, searchInterviewReports } from './research-service.js';

function result(url: string, source = 'tavily'): InterviewSearchResult {
  return { title: `About ${url}`, url, snippet: 'A snippet.', source };
}

/** Search providers are mocked: this suite is about the composition, not the network. */
function provider(
  name: string,
  behaviour: () => Promise<InterviewSearchResult[]>,
): InterviewResearchProvider {
  return { name, search: behaviour };
}

const EMPTY_SITE: CompanySiteResult = {
  pages: [],
  pagesFailed: [],
  notes: [],
  hiringPagesFound: [],
};

describe('dedupeResults', () => {
  it('collapses the same page reached two ways', () => {
    const deduped = dedupeResults([
      result('https://glassdoor.example/acme'),
      result('https://glassdoor.example/acme/'),
      result('https://glassdoor.example/acme#reviews'),
      result('https://other.example/acme'),
    ]);

    expect(deduped).toHaveLength(2);
  });

  it('keeps an unparseable URL rather than discarding the result', () => {
    expect(dedupeResults([result('not-a-url')])).toHaveLength(1);
  });
});

describe('searchInterviewReports', () => {
  it('uses the first provider that returns something', async () => {
    const tavily = provider('tavily', () => Promise.resolve([result('https://a.example')]));
    const duck = vi.fn(() => Promise.resolve([result('https://b.example', 'duckduckgo')]));

    const outcome = await searchInterviewReports('Acme', [tavily, provider('duckduckgo', duck)]);

    expect(outcome.providerUsed).toBe('tavily');
    expect(outcome.results).toHaveLength(1);
    // The fallback is never even attempted.
    expect(duck).not.toHaveBeenCalled();
  });

  it('falls back when the first provider throws', async () => {
    const tavily = provider('tavily', () => Promise.reject(new Error('429 rate limited')));
    const duck = provider('duckduckgo', () =>
      Promise.resolve([result('https://b.example', 'duckduckgo')]),
    );

    const outcome = await searchInterviewReports('Acme', [tavily, duck]);

    expect(outcome.providerUsed).toBe('duckduckgo');
    expect(outcome.notes.join(' ')).toMatch(/tavily was unavailable/i);
  });

  it('falls back when the first provider returns nothing', async () => {
    const tavily = provider('tavily', () => Promise.resolve([]));
    const duck = provider('duckduckgo', () =>
      Promise.resolve([result('https://b.example', 'duckduckgo')]),
    );

    const outcome = await searchInterviewReports('Acme', [tavily, duck]);

    expect(outcome.providerUsed).toBe('duckduckgo');
  });

  /**
   * The rule that matters: nothing found is reported as nothing found. No
   * interview process is ever invented to fill the gap.
   */
  it('returns an explicit empty result when every provider fails', async () => {
    const outcome = await searchInterviewReports('Acme', [
      provider('tavily', () => Promise.reject(new Error('down'))),
      provider('duckduckgo', () => Promise.reject(new Error('down'))),
    ]);

    expect(outcome.results).toEqual([]);
    expect(outcome.providerUsed).toBe('none');
    expect(outcome.notes.join(' ')).toMatch(/no public discussion/i);
  });

  it('does not search at all without a company name', async () => {
    const search = vi.fn(() => Promise.resolve([result('https://a.example')]));

    const outcome = await searchInterviewReports('  ', [provider('tavily', search)]);

    expect(search).not.toHaveBeenCalled();
    expect(outcome.results).toEqual([]);
  });

  it('never throws, whatever the providers do', async () => {
    await expect(
      searchInterviewReports('Acme', [
        provider('boom', () => {
          throw new Error('synchronous explosion');
        }),
      ]),
    ).resolves.toBeDefined();
  });
});

describe('research', () => {
  it('normalises both modules into one result', async () => {
    const crawler: CompanyCrawler = {
      crawl: () =>
        Promise.resolve({
          pages: [
            {
              url: 'https://acme.example/',
              title: 'Acme',
              text: 'We route freight.',
              hiringScore: 0,
            },
          ],
          pagesFailed: [{ url: 'https://acme.example/jobs', reason: 'http-error: HTTP 404' }],
          notes: ['No page describing the hiring or interview process was found on this site.'],
          hiringPagesFound: [],
        }),
    };

    const outcome = await research('https://acme.example', 'Acme', crawler, [
      provider('tavily', () => Promise.resolve([result('https://reports.example/acme')])),
    ]);

    expect(outcome.pages).toHaveLength(1);
    expect(outcome.interviewReports).toHaveLength(1);
    expect(outcome.pagesFailed).toHaveLength(1);
    expect(outcome.hiringPagesFound).toEqual([]);
    expect(outcome.notes.join(' ')).toMatch(/no page describing the hiring/i);
  });

  /** A search outage must not cost the user their company research. */
  it('still returns company pages when search is entirely unavailable', async () => {
    const crawler: CompanyCrawler = {
      crawl: () =>
        Promise.resolve({
          ...EMPTY_SITE,
          pages: [
            {
              url: 'https://acme.example/',
              title: 'Acme',
              text: 'We route freight.',
              hiringScore: 0,
            },
          ],
        }),
    };

    const outcome = await research('https://acme.example', 'Acme', crawler, [
      provider('tavily', () => Promise.reject(new Error('down'))),
    ]);

    expect(outcome.pages).toHaveLength(1);
    expect(outcome.interviewReports).toEqual([]);
  });
});
