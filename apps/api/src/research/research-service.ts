import { env } from '../config/env.js';
import { logger } from '../logger.js';
import type { CompanyCrawler, FailedSource } from '../retrieval/company-crawler.js';
import { createDuckDuckGoProvider } from './duckduckgo-provider.js';
import {
  EMPTY_PROVIDER,
  type InterviewResearchProvider,
  type InterviewSearchResult,
} from './interview-research-provider.js';
import { createTavilyProvider } from './tavily-provider.js';

/**
 * Composes the two independent retrieval modules into the single contract the
 * generation pipeline consumes. It knows nothing about the LLM, and neither
 * module knows about the other.
 */
export interface ResearchResult {
  pages: { url: string; title: string; text: string; hiringScore: number }[];
  interviewReports: InterviewSearchResult[];
  pagesFailed: FailedSource[];
  notes: string[];
  hiringPagesFound: string[];
}

/**
 * Strict priority: Tavily when keyed, DuckDuckGo otherwise, and an explicit
 * empty result when both are unavailable.
 */
export function resolveInterviewProviders(): InterviewResearchProvider[] {
  const providers: InterviewResearchProvider[] = [];

  if (env.TAVILY_API_KEY) providers.push(createTavilyProvider(env.TAVILY_API_KEY));
  providers.push(createDuckDuckGoProvider());

  return providers;
}

/**
 * Tries each provider in order and returns the first that yields anything
 * useful. A provider that throws or comes back empty is a reason to try the
 * next one, never a reason to fail the run.
 */
export async function searchInterviewReports(
  companyName: string,
  providers: InterviewResearchProvider[] = resolveInterviewProviders(),
): Promise<{ results: InterviewSearchResult[]; providerUsed: string; notes: string[] }> {
  const notes: string[] = [];

  if (companyName.trim().length === 0) {
    return {
      results: [],
      providerUsed: EMPTY_PROVIDER.name,
      notes: ['No company name was available to search for interview reports.'],
    };
  }

  for (const provider of providers) {
    try {
      const results = await provider.search(companyName);
      if (results.length > 0) return { results, providerUsed: provider.name, notes };

      notes.push(`${provider.name} returned no results for "${companyName}".`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('interview research provider failed', { provider: provider.name, message });
      notes.push(`${provider.name} was unavailable.`);
    }
  }

  // Explicitly empty, and said out loud. Never fabricated.
  notes.push('No public discussion of this company’s interview process was found.');
  return { results: [], providerUsed: EMPTY_PROVIDER.name, notes };
}

export async function research(
  companyUrl: string,
  companyName: string,
  crawler: CompanyCrawler,
  providers: InterviewResearchProvider[] = resolveInterviewProviders(),
): Promise<ResearchResult> {
  const site = await crawler.crawl(companyUrl);
  const interview = await searchInterviewReports(companyName, providers);

  return {
    pages: site.pages,
    interviewReports: interview.results,
    pagesFailed: site.pagesFailed,
    notes: [...site.notes, ...interview.notes],
    hiringPagesFound: site.hiringPagesFound,
  };
}
