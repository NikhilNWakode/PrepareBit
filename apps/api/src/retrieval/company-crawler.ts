import { logger } from '../logger.js';
import { extractContent, removeSharedBoilerplate } from './extract-content.js';
import { fetchPage } from './fetch-page.js';
import {
  HIRING_CONTENT_THRESHOLD,
  rankLinks,
  scoreHiringContent,
  type DiscoveredLink,
} from './link-ranker.js';
import { normaliseUrl } from './normalise-url.js';
import { robotsPolicyFor } from './robots.js';
import { checkFetchableUrl, isSameRegistrableDomain, parseFetchableUrl } from './url-guard.js';

/**
 * A bounded, relevance-ranked crawler — deliberately not a general web crawler.
 *
 * It starts at the homepage, extracts the links the site actually publishes,
 * ranks them, and spends a small page budget on the best candidates. Nothing is
 * fetched because of its path: the brief is explicit that a fixed list of paths
 * is not sufficient, since companies bury hiring material at /careers, /jobs, a
 * handbook or an engineering blog.
 */

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
  hiringScore: number;
}

export interface FailedSource {
  url: string;
  reason: string;
}

export interface CompanySiteResult {
  pages: CrawledPage[];
  pagesFailed: FailedSource[];
  notes: string[];
  hiringPagesFound: string[];
}

/** Either module can be swapped without touching the other. */
export interface CompanyCrawler {
  crawl(companyUrl: string): Promise<CompanySiteResult>;
}

export interface CrawlLimits {
  maxPages: number;
  maxDepth: number;
}

export const DEFAULT_CRAWL_LIMITS: CrawlLimits = { maxPages: 8, maxDepth: 2 };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createCompanyCrawler(limits: CrawlLimits = DEFAULT_CRAWL_LIMITS): CompanyCrawler {
  return {
    async crawl(companyUrl: string): Promise<CompanySiteResult> {
      const pages: CrawledPage[] = [];
      const pagesFailed: FailedSource[] = [];
      const notes: string[] = [];

      const entry = await checkFetchableUrl(companyUrl);
      if (!entry.ok) {
        // An unusable company URL is a reported outcome, not a thrown error:
        // the pipeline still produces an honest kit around it.
        return {
          pages: [],
          pagesFailed: [{ url: companyUrl, reason: `invalid-url: ${entry.reason}` }],
          notes: [`The company URL could not be used (${entry.reason}).`],
          hiringPagesFound: [],
        };
      }

      const origin = entry.url;
      const robots = await robotsPolicyFor(origin);

      const visited = new Set<string>([normaliseUrl(origin)]);
      const queue: DiscoveredLink[] = [{ url: origin, anchorText: '', depth: 0 }];

      while (queue.length > 0 && pages.length < limits.maxPages) {
        // Re-ranked every round, so links discovered deeper can still outrank
        // shallow ones that turned out to be uninteresting.
        const ranked = rankLinks(queue);
        const next = ranked[0];
        if (!next) break;

        queue.splice(
          queue.findIndex((link) => link.url.href === next.url.href),
          1,
        );

        if (!robots.isAllowed(next.url.href)) {
          notes.push(`robots.txt disallowed ${next.url.pathname}`);
          continue;
        }

        const result = await fetchPage(next.url, { confineToDomainOf: origin });

        if (!result.ok) {
          // Recorded and skipped — never fatal to the run.
          pagesFailed.push({ url: result.url, reason: `${result.reason}: ${result.detail}` });
          logger.warn('retrieval: page skipped', { url: result.url, reason: result.reason });
          await delay(robots.crawlDelayMs);
          continue;
        }

        const extracted = extractContent(result.page.html, result.page.url);
        pages.push({
          url: result.page.url,
          title: extracted.title,
          text: extracted.text,
          hiringScore: scoreHiringContent(extracted.title, extracted.text),
        });

        if (next.depth < limits.maxDepth) {
          for (const link of extracted.links) {
            const parsed = parseFetchableUrl(link.href);
            if (!parsed.ok) continue;

            // The crawl boundary is the registrable domain, so careers.acme.com
            // is in scope while an unrelated site linked from the footer is not.
            if (!isSameRegistrableDomain(parsed.url, origin)) continue;

            const key = normaliseUrl(parsed.url);
            if (visited.has(key)) continue;

            visited.add(key);
            queue.push({ url: parsed.url, anchorText: link.anchorText, depth: next.depth + 1 });
          }
        }

        await delay(robots.crawlDelayMs);
      }

      // Boilerplate is only detectable across pages, so it is stripped at the end.
      const cleaned = removeSharedBoilerplate(pages);
      cleaned.forEach((text, index) => {
        const page = pages[index];
        if (page) page.text = text;
      });

      const hiringPagesFound = pages
        .filter((page) => page.hiringScore >= HIRING_CONTENT_THRESHOLD)
        .map((page) => page.url);

      // An honest "nothing here" beats an invented hiring process. The brief
      // tests a company whose site has no hiring page anywhere.
      if (hiringPagesFound.length === 0) {
        notes.push('No page describing the hiring or interview process was found on this site.');
      }
      if (pages.length === 0) {
        notes.push('No pages could be retrieved from the company site.');
      }

      return { pages, pagesFailed, notes, hiringPagesFound };
    },
  };
}
