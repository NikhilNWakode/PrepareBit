import * as cheerio from 'cheerio';

import { REQUEST_TIMEOUT_MS, USER_AGENT } from '../retrieval/fetch-page.js';
import {
  dedupeResults,
  interviewQuery,
  type InterviewResearchProvider,
  type InterviewSearchResult,
} from './interview-research-provider.js';

const ENDPOINT = 'https://html.duckduckgo.com/html/';
const MAX_RESULTS = 5;

/**
 * The fallback when no Tavily key is configured, so the pipeline still attempts
 * public research from a clean clone with no credentials at all.
 *
 * This scrapes an HTML endpoint rather than calling a supported API, so it is
 * genuinely fragile — markup can change and requests can be throttled. That is
 * why it is the fallback and not the default, and why the layer above it treats
 * an empty result as a normal outcome.
 */
export function createDuckDuckGoProvider(): InterviewResearchProvider {
  return {
    name: 'duckduckgo',

    async search(companyName: string): Promise<InterviewSearchResult[]> {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': USER_AGENT,
        },
        body: new URLSearchParams({ q: interviewQuery(companyName) }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) throw new Error(`DuckDuckGo responded ${response.status}`);

      const $ = cheerio.load(await response.text());
      const results: InterviewSearchResult[] = [];

      $('.result').each((_index, element) => {
        if (results.length >= MAX_RESULTS) return;

        const anchor = $(element).find('a.result__a').first();
        const href = anchor.attr('href');
        if (!href) return;

        // Results are wrapped in a redirect carrying the real target in ?uddg=.
        let url: string;
        try {
          const wrapped = new URL(href, ENDPOINT);
          url = wrapped.searchParams.get('uddg') ?? wrapped.href;
        } catch {
          return;
        }

        results.push({
          title: anchor.text().replace(/\s+/g, ' ').trim(),
          url,
          snippet: $(element)
            .find('.result__snippet')
            .text()
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 500),
          source: 'duckduckgo',
        });
      });

      return dedupeResults(results);
    },
  };
}
