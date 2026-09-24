import { z } from 'zod';

/**
 * The compression step the whole token budget rests on.
 *
 * Raw crawled pages are seen by exactly one LLM call — research synthesis —
 * which turns them into this small typed object. Every later stage receives the
 * digest and never the corpus. Sending eight pages of company website to nine
 * stages would exhaust an 8,000-tokens-per-minute budget on repetition.
 *
 * `hiringFacts` and `interviewFacts` are deliberately separate from
 * `companyFacts`. The brief says a company that publishes a take-home followed
 * by a system-design round should produce a different kit from one that says
 * nothing, which only works if the hiring signal can be addressed on its own.
 */

/**
 * No array bounds in the schema itself: strict JSON Schema support for
 * `maxItems` varies by provider, and a rejected schema fails the whole call.
 * The caps are applied in code after validation instead, where they cannot
 * break generation.
 */
export const researchDigestSchema = z.object({
  industry: z.string(),
  products: z.array(z.string()),
  companyFacts: z.array(z.string()),
  engineeringFacts: z.array(z.string()),
  hiringFacts: z.array(z.string()),
  interviewFacts: z.array(z.string()),
});

export type ResearchDigestFacts = z.infer<typeof researchDigestSchema>;

export interface ResearchDigest extends ResearchDigestFacts {
  /** Set by code from the pages actually fetched, never by the model. */
  sources: string[];
}

const MAX_ITEMS = 8;
const MAX_PRODUCTS = 6;
const MAX_FACT_CHARS = 220;

function tidy(items: readonly string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const trimmed = item.trim().slice(0, MAX_FACT_CHARS);
    if (trimmed.length === 0) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(trimmed);
    if (result.length >= limit) break;
  }

  return result;
}

/** Bounds the digest after validation, so it stays small whatever comes back. */
export function normaliseDigest(
  facts: ResearchDigestFacts,
  sources: readonly string[],
): ResearchDigest {
  return {
    industry: facts.industry.trim().slice(0, MAX_FACT_CHARS),
    products: tidy(facts.products, MAX_PRODUCTS),
    companyFacts: tidy(facts.companyFacts, MAX_ITEMS),
    engineeringFacts: tidy(facts.engineeringFacts, MAX_ITEMS),
    hiringFacts: tidy(facts.hiringFacts, MAX_ITEMS),
    interviewFacts: tidy(facts.interviewFacts, MAX_ITEMS),
    sources: [...sources],
  };
}

/** An honest empty digest: retrieval found nothing, and nothing is invented. */
export function emptyDigest(): ResearchDigest {
  return {
    industry: '',
    products: [],
    companyFacts: [],
    engineeringFacts: [],
    hiringFacts: [],
    interviewFacts: [],
    sources: [],
  };
}

/** True when research produced nothing a prompt could honestly build on. */
export function isDigestEmpty(digest: ResearchDigest): boolean {
  return (
    digest.industry.length === 0 &&
    digest.products.length === 0 &&
    digest.companyFacts.length === 0 &&
    digest.engineeringFacts.length === 0 &&
    digest.hiringFacts.length === 0 &&
    digest.interviewFacts.length === 0
  );
}

/** True when the company published something about how it interviews. */
export function hasHiringSignal(digest: ResearchDigest): boolean {
  return digest.hiringFacts.length > 0 || digest.interviewFacts.length > 0;
}
