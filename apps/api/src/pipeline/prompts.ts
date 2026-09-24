import { UNTRUSTED_CONTENT_RULE } from '../ai/untrusted.js';

/**
 * Shared prompt construction.
 *
 * Two concerns live here rather than being repeated in every stage: the rules
 * that must hold for all generation, and the input caps that keep the token
 * budget legible in one place.
 */

/**
 * Prepended to every stage. The anti-invention rule is first because it is the
 * one the assessment scores hardest: "Inventing requirements a description does
 * not contain is worse than reporting that there were few."
 *
 * Stating it is necessary but never sufficient — extraction also runs a
 * deterministic traceability check, and every output is schema-validated.
 */
export const SYSTEM_RULES = [
  'You help a candidate prepare for a job interview.',
  '',
  'Rules that always apply:',
  '- Never invent facts. If the source material does not say something, do not claim it.',
  '- Reporting that little was found is correct and useful. Padding is not.',
  '- Do not repeat yourself across items.',
  '- Reply with JSON matching the schema, and nothing else.',
  '',
  UNTRUSTED_CONTENT_RULE,
].join('\n');

/**
 * Character caps per stage input, in one table so the budget can be read and
 * tested rather than inferred from scattered `.slice()` calls.
 *
 * Sized from the measured cost of a call: roughly 3.5 characters per token, and
 * these models spend a further ~100-200 hidden reasoning tokens per response.
 */
export const INPUT_CAPS = {
  /** A long posting still fits; a pasted novel does not. */
  jobDescription: 12_000,
  /** Read once, by research synthesis only. The single largest prompt. */
  researchCorpus: 9_000,
  /** The digest is reused by every later stage, so it must stay small. */
  digest: 3_000,
  /** Requirement and question lists passed between stages. */
  itemList: 4_000,
} as const;

export interface CappedText {
  text: string;
  truncated: boolean;
}

/**
 * Truncates on a paragraph boundary where possible, so a stage never receives a
 * sentence cut mid-word.
 *
 * Callers that can rank their input do so before calling this — research
 * synthesis orders hiring pages first — so what gets dropped is the least
 * relevant material rather than whatever happened to be last.
 */
export function capText(text: string, limit: number): CappedText {
  if (text.length <= limit) return { text, truncated: false };

  const clipped = text.slice(0, limit);
  const lastBreak = Math.max(clipped.lastIndexOf('\n\n'), clipped.lastIndexOf('\n'));

  // Only honour the break if it keeps most of the budget.
  const cut = lastBreak > limit * 0.6 ? lastBreak : limit;

  return { text: `${text.slice(0, cut).trimEnd()}\n[truncated]`, truncated: true };
}

/** A short, stable label for a list of strings inside a prompt. */
export function bulletList(items: readonly string[], emptyLabel = '(none found)'): string {
  if (items.length === 0) return emptyLabel;
  return items.map((item) => `- ${item}`).join('\n');
}
