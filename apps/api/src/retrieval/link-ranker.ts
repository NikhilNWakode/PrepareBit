/**
 * The interesting half of retrieval.
 *
 * The brief is explicit that a fixed list of paths is not sufficient: companies
 * bury hiring information at /careers, /jobs, a handbook, or an engineering
 * blog, and the path cannot be guessed. So nothing is fetched *because of* its
 * path. Links are discovered from the pages the site actually publishes, scored
 * against relevance signals, and the best candidates are fetched.
 *
 * Pure on purpose — no network, no state — so the scoring can be tested
 * exhaustively, which is where the real risk in this module lives.
 */

export interface DiscoveredLink {
  url: URL;
  /** Visible anchor text; often more descriptive than the path ("How we hire"). */
  anchorText: string;
  depth: number;
}

export interface RankedLink extends DiscoveredLink {
  score: number;
}

interface Signal {
  pattern: RegExp;
  weight: number;
}

/**
 * Hiring-process material scores highest, because a company that publishes its
 * loop changes what questions make sense. General company material is worth
 * fetching but worth less.
 */
const SIGNALS: Signal[] = [
  // Hiring process itself — the thing most worth finding.
  { pattern: /how[-_ ]?we[-_ ]?hire/, weight: 30 },
  { pattern: /hiring[-_ ]?process/, weight: 30 },
  { pattern: /interview(ing|s)?[-_ ]?(process|guide|loop)?/, weight: 25 },
  { pattern: /recruit(ing|ment)/, weight: 18 },
  { pattern: /\bhiring\b/, weight: 18 },

  // Where hiring material usually lives.
  { pattern: /careers?/, weight: 16 },
  { pattern: /\bjobs?\b/, weight: 14 },
  { pattern: /handbook/, weight: 14 },
  { pattern: /open[-_ ]?roles?/, weight: 12 },
  { pattern: /join[-_ ]?us/, weight: 12 },

  // Company context: useful for the brief and for company-fit questions.
  { pattern: /\babout\b/, weight: 10 },
  { pattern: /engineering/, weight: 9 },
  { pattern: /culture/, weight: 9 },
  { pattern: /values/, weight: 8 },
  { pattern: /life[-_ ]?at/, weight: 8 },
  { pattern: /working[-_ ]?at/, weight: 8 },
  { pattern: /\bteam\b/, weight: 6 },
  { pattern: /benefits/, weight: 5 },
  { pattern: /what[-_ ]?we[-_ ]?do/, weight: 8 },

  // Pages that cost budget and teach nothing about the company or its hiring.
  { pattern: /login|signin|sign[-_ ]?in|signup|sign[-_ ]?up|register/, weight: -40 },
  { pattern: /privacy|terms|cookie|legal|gdpr|compliance/, weight: -30 },
  { pattern: /pricing|checkout|cart|billing/, weight: -20 },
  { pattern: /investors?|press|newsroom/, weight: -15 },
  { pattern: /\/tag\/|\/category\/|\/archive\/|\/page\/\d+/, weight: -15 },
  { pattern: /support|help[-_ ]?cent(er|re)|docs?\//, weight: -10 },
];

/** Targets that are not documents we can read. */
const NON_DOCUMENT = /\.(pdf|zip|docx?|xlsx?|pptx?|png|jpe?g|gif|svg|webp|mp4|mp3|css|js|ico)$/i;

/** Applied per level of depth, so a shallow /careers beats a deeply buried one. */
const DEPTH_PENALTY = 4;

export function scoreLink(link: DiscoveredLink): number {
  const haystack = `${decodeURIComponent(link.url.pathname)} ${link.anchorText}`.toLowerCase();

  let score = 0;
  for (const signal of SIGNALS) {
    if (signal.pattern.test(haystack)) score += signal.weight;
  }

  // A long query string usually means a filtered listing rather than content.
  if (link.url.search.length > 40) score -= 8;

  return score - link.depth * DEPTH_PENALTY;
}

export function isFetchableDocument(url: URL): boolean {
  return !NON_DOCUMENT.test(url.pathname);
}

/**
 * Scores and orders candidates, best first. Ties break on shallower depth and
 * then on URL, so the ordering is deterministic and a test can assert on it.
 */
export function rankLinks(links: readonly DiscoveredLink[]): RankedLink[] {
  return links
    .filter((link) => isFetchableDocument(link.url))
    .map((link) => ({ ...link, score: scoreLink(link) }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.depth !== right.depth) return left.depth - right.depth;
      return left.url.href.localeCompare(right.url.href);
    });
}

/**
 * Whether a page, once fetched, actually *is* hiring-process material — a
 * deterministic judgement, not one handed to the model, because it decides
 * whether the kit says "we found how they hire" or admits it did not.
 *
 * The distinction that matters is between a page that describes a hiring
 * process and one that merely links to such a page: an index whose navigation
 * says "How we hire" carries that phrase in its text too. Claiming the second
 * is the first would suppress an honest "no hiring page found", which is the
 * failure the brief cares about most.
 *
 * So the title is weighted above the body. A page *titled* "How we hire" is
 * making a claim about itself; a stray phrase in a link list is not.
 */
const HIRING_CONTENT = [
  /how we hire/i,
  /hiring process/i,
  /interview process/i,
  /interview loop/i,
  /take[- ]?home/i,
  /technical screen/i,
  /onsite interview/i,
  /coding (interview|exercise)/i,
  /what to expect.{0,30}interview/i,
];

const TITLE_WEIGHT = 2;

/** At or above this, a page counts as describing the hiring process. */
export const HIRING_CONTENT_THRESHOLD = 2;

export function scoreHiringContent(title: string, text: string): number {
  const body = text.slice(0, 4000);

  return HIRING_CONTENT.reduce((score, pattern) => {
    if (pattern.test(title)) return score + TITLE_WEIGHT;
    return pattern.test(body) ? score + 1 : score;
  }, 0);
}
