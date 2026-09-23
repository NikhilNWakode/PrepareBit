/**
 * Public discussion of how a company interviews.
 *
 * Kept behind an interface and entirely separate from the company crawler, so
 * either can be replaced without touching the other, and neither knows anything
 * about the LLM.
 *
 * Two rules hold absolutely:
 *   - a search failure never fails kit generation
 *   - nothing is invented when search finds nothing
 */

export interface InterviewSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Which provider produced it, so the brief can attribute honestly. */
  source: string;
}

export interface InterviewResearchProvider {
  readonly name: string;
  /** Resolves to an empty array when there is nothing useful. Never throws. */
  search(companyName: string): Promise<InterviewSearchResult[]>;
}

/** Used when no provider is configured or all of them fail. */
export const EMPTY_PROVIDER: InterviewResearchProvider = {
  name: 'none',
  search: () => Promise.resolve([]),
};

export function interviewQuery(companyName: string): string {
  return `${companyName} interview process experience questions`;
}

/** Same page reached two ways is one result. */
export function dedupeResults(results: InterviewSearchResult[]): InterviewSearchResult[] {
  const seen = new Set<string>();
  const unique: InterviewSearchResult[] = [];

  for (const result of results) {
    let key: string;
    try {
      const url = new URL(result.url);
      url.hash = '';
      url.hostname = url.hostname.toLowerCase();
      key = url.href.replace(/\/$/, '');
    } catch {
      key = result.url;
    }

    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(result);
  }

  return unique;
}
