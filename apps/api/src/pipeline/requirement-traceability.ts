import type { RequirementKind, RequirementPriority } from '@prep/shared';

/**
 * Proof that an extracted requirement actually came from the job description.
 *
 * The brief is blunt: "Inventing requirements a description does not contain is
 * worse than reporting that there were few." Instructing a model not to invent
 * is necessary and not sufficient, so the model is made to *quote* its source
 * and code checks the quote.
 *
 * The model is never asked whether its own evidence is valid. It supplies the
 * span; this module decides.
 *
 * `evidence` is internal pipeline metadata. It never reaches the Appendix A
 * requirement, which stays exactly `{ id, text, kind, priority }`.
 */

export interface ExtractedRequirement {
  text: string;
  /** A verbatim span the model copied out of the job description. */
  evidence: string;
  kind: RequirementKind;
  priority: RequirementPriority;
}

export interface DroppedRequirement {
  text: string;
  reason: string;
}

export interface TraceabilityResult {
  kept: ExtractedRequirement[];
  dropped: DroppedRequirement[];
}

/**
 * Short enough and a model could cite "and" as evidence for anything. Long
 * enough that a genuine requirement always has a quotable phrase behind it.
 */
const MIN_EVIDENCE_CHARS = 12;

/**
 * How much of a requirement's wording must also appear in its own evidence.
 *
 * Deliberately lenient. This is a secondary check against a model citing a real
 * but unrelated span; the verbatim match is the primary guarantee. Dropping a
 * genuine must-have costs coverage points, so the bar for the heuristic is low.
 */
const MIN_TEXT_EVIDENCE_OVERLAP = 0.2;

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'you',
  'your',
  'our',
  'are',
  'have',
  'has',
  'will',
  'this',
  'that',
  'from',
  'able',
  'must',
  'should',
  'would',
  'can',
  'who',
  'what',
  'they',
  'them',
  'their',
  'been',
  'was',
  'were',
  'his',
  'her',
  'its',
  'but',
  'not',
  'all',
  'any',
  'some',
  'more',
  'most',
  'other',
  'such',
  'into',
  'about',
  'over',
  'than',
  'then',
  'also',
  'very',
  'work',
  'working',
  'experience',
  'years',
  'year',
  'strong',
  'good',
  'great',
  'plus',
  'nice',
  'like',
  'using',
  'use',
  'well',
]);

/**
 * Whitespace and case are cosmetic: a model reflowing a line break into a space
 * has still quoted the posting. Unicode punctuation is folded too, because a
 * smart quote copied as a straight one is the same quotation.
 */
export function normaliseForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201f\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A crude stemmer, applied to both sides so they fold the same way.
 *
 * "Knows Go" should match "Must know Go" — a requirement is phrased in the
 * candidate's terms while the posting is phrased in the employer's, and the
 * difference is usually nothing more than a verb ending.
 */
function stem(token: string): string {
  if (token.length <= 3) return token;

  return token.replace(/ies$/, 'y').replace(/(ing|ed|es|s)$/, '');
}

function contentTokens(text: string): string[] {
  return (
    normaliseForMatching(text)
      .replace(/[^a-z0-9+#. ]/g, ' ')
      .split(' ')
      .map((token) => token.replace(/^[.]+|[.]+$/g, ''))
      // Two characters, not three: Go, C#, R and AI are real technologies, and
      // dropping them would blind the check to exactly the terms that matter.
      .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
      .map(stem)
  );
}

/** Share of the requirement's own words that also appear in its evidence. */
function overlapRatio(text: string, evidence: string): number {
  const textTokens = contentTokens(text);
  if (textTokens.length === 0) return 1;

  const evidenceTokens = new Set(contentTokens(evidence));
  const matched = textTokens.filter((token) => evidenceTokens.has(token)).length;

  return matched / textTokens.length;
}

/**
 * Keeps only requirements whose evidence genuinely appears in the job
 * description. Pure: same input, same verdict, no model involved.
 */
export function verifyRequirementEvidence(
  jobDescription: string,
  requirements: readonly ExtractedRequirement[],
): TraceabilityResult {
  const haystack = normaliseForMatching(jobDescription);

  const kept: ExtractedRequirement[] = [];
  const dropped: DroppedRequirement[] = [];

  for (const requirement of requirements) {
    const evidence = requirement.evidence.trim();

    if (evidence.length < MIN_EVIDENCE_CHARS) {
      dropped.push({
        text: requirement.text,
        reason: 'no usable quotation from the job description was supplied',
      });
      continue;
    }

    // The primary guarantee: the quoted span is really in the posting.
    if (!haystack.includes(normaliseForMatching(evidence))) {
      dropped.push({
        text: requirement.text,
        reason: 'the quoted supporting text does not appear in the job description',
      });
      continue;
    }

    // Secondary: a real span cited for an unrelated claim is still invention.
    if (overlapRatio(requirement.text, evidence) < MIN_TEXT_EVIDENCE_OVERLAP) {
      dropped.push({
        text: requirement.text,
        reason: 'the quoted supporting text does not support this requirement',
      });
      continue;
    }

    kept.push({ ...requirement, evidence });
  }

  return { kept, dropped };
}

/** Honest, human-readable notes for `research.notes`. */
export function traceabilityNotes(dropped: readonly DroppedRequirement[]): string[] {
  if (dropped.length === 0) return [];

  return [
    `${dropped.length} extracted requirement${dropped.length === 1 ? '' : 's'} could not be traced to the job description and ${dropped.length === 1 ? 'was' : 'were'} discarded:`,
    ...dropped.map((entry) => `  - "${entry.text}" — ${entry.reason}`),
  ];
}
