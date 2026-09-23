import { REQUEST_TIMEOUT_MS } from '../retrieval/fetch-page.js';
import {
  dedupeResults,
  interviewQuery,
  type InterviewResearchProvider,
  type InterviewSearchResult,
} from './interview-research-provider.js';

/** Only the fields used; the API returns more. */
interface TavilyResponse {
  results?: { title?: string; url?: string; content?: string }[];
}

const ENDPOINT = 'https://api.tavily.com/search';
const MAX_RESULTS = 5;

/**
 * Preferred when a key is configured: results come back ranked and summarised
 * for machine consumption, which suits a tight token budget.
 *
 * Throws on failure by design — the resolver decides whether to fall back.
 */
export function createTavilyProvider(apiKey: string): InterviewResearchProvider {
  return {
    name: 'tavily',

    async search(companyName: string): Promise<InterviewSearchResult[]> {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          query: interviewQuery(companyName),
          max_results: MAX_RESULTS,
          search_depth: 'basic',
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) throw new Error(`Tavily responded ${response.status}`);

      const body = (await response.json()) as TavilyResponse;

      const results = (body.results ?? [])
        .filter(
          (result): result is { title?: string; url: string; content?: string } =>
            typeof result.url === 'string' && result.url.length > 0,
        )
        .map((result) => ({
          title: result.title?.trim() ?? '',
          url: result.url,
          snippet: (result.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
          source: 'tavily',
        }));

      return dedupeResults(results);
    },
  };
}
