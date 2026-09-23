import robotsParserModule from 'robots-parser';

import { REQUEST_TIMEOUT_MS, USER_AGENT } from './fetch-page.js';

/** The part of the parser's surface this module uses. */
interface Robot {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
  getCrawlDelay(userAgent?: string): number | undefined;
}

/**
 * robots-parser ships a broken declaration file: it opens with a bare
 * `declare module 'robots-parser';`, which shadows the `export default`
 * signature written below it, and its `Robot` interface is never exported. The
 * runtime export is a plain callable function — verified directly — so the cast
 * is isolated to this one line and the surface we rely on is typed above.
 */
const robotsParser = robotsParserModule as unknown as (url: string, body: string) => Robot;

/**
 * robots.txt is parsed by a library rather than by hand. Allow/Disallow
 * precedence, wildcards and longest-match are a well-known source of quiet bugs,
 * and getting them wrong means either ignoring a site's wishes or refusing to
 * read pages it permits.
 *
 * A missing or unreachable robots.txt means allowed — the standard reading.
 */

export interface RobotsPolicy {
  isAllowed(url: string): boolean;
  crawlDelayMs: number;
}

const DEFAULT_CRAWL_DELAY_MS = 500;

const ALLOW_EVERYTHING: RobotsPolicy = {
  isAllowed: () => true,
  crawlDelayMs: DEFAULT_CRAWL_DELAY_MS,
};

/** Cached per origin for the lifetime of a run; a crawl hits one origin many times. */
const cache = new Map<string, RobotsPolicy>();

async function load(origin: string): Promise<RobotsPolicy> {
  const robotsUrl = `${origin}/robots.txt`;

  let body: string;
  try {
    const response = await fetch(robotsUrl, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow',
    });

    // 404 is the common case and means "crawl freely".
    if (!response.ok) return ALLOW_EVERYTHING;
    body = await response.text();
  } catch {
    return ALLOW_EVERYTHING;
  }

  const robots = robotsParser(robotsUrl, body);
  const declaredDelay = robots.getCrawlDelay(USER_AGENT);

  return {
    isAllowed: (url: string) => robots.isAllowed(url, USER_AGENT) ?? true,
    // Honour a stated crawl-delay, but never go faster than our own politeness floor.
    crawlDelayMs: Math.max(DEFAULT_CRAWL_DELAY_MS, (declaredDelay ?? 0) * 1000),
  };
}

export async function robotsPolicyFor(url: URL): Promise<RobotsPolicy> {
  const { origin } = url;

  const cached = cache.get(origin);
  if (cached) return cached;

  const policy = await load(origin);
  cache.set(origin, policy);
  return policy;
}

/** Test seam: the cache would otherwise leak one test's fixture into the next. */
export function clearRobotsCache(): void {
  cache.clear();
}
