import type { KitCompanyBrief } from '@prep/shared';
import { z } from 'zod';

import type { LlmProvider, LlmUsage } from '../../ai/llm-provider.js';
import { bulletList, SYSTEM_RULES } from '../prompts.js';
import { isDigestEmpty, type ResearchDigest } from '../research-digest.js';

/**
 * The company brief. Receives the digest only — never the pages again.
 *
 * Its hardest requirement is negative: "a company you can find nothing about
 * should produce an honest brief rather than a fabricated one."
 */

const briefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
});

const INSTRUCTIONS = [
  'Write a short company brief for a candidate about to interview.',
  '',
  '- summary: two or three sentences on who they are and anything worth knowing',
  '  before the interview, including how they hire if that is stated below.',
  '- what_they_do: one or two sentences on their actual product or service.',
  '',
  'Use only the facts listed. Do not add context from general knowledge about this',
  'company or its industry, however confident you feel: the candidate needs to know',
  'what was actually found, not what is plausible.',
].join('\n');

/** Said out loud when research came back empty, rather than papered over. */
const NOTHING_FOUND_SUMMARY =
  'No public information about this company could be retrieved, so there is nothing reliable to summarise here. Treat this as a gap to fill by asking them directly rather than as a description of the company.';

export interface GenerateCompanyBriefResult {
  brief: KitCompanyBrief;
  usage: LlmUsage | null;
}

export async function generateCompanyBrief(
  digest: ResearchDigest,
  provider: LlmProvider,
): Promise<GenerateCompanyBriefResult> {
  // Nothing was found. Saying so costs no tokens and is the honest answer; a
  // call here could only produce invention.
  if (isDigestEmpty(digest)) {
    return {
      brief: { summary: NOTHING_FOUND_SUMMARY, what_they_do: '', sources: [] },
      usage: null,
    };
  }

  const facts = [
    `Industry: ${digest.industry || '(not stated)'}`,
    '',
    'Products:',
    bulletList(digest.products),
    '',
    'About the company:',
    bulletList(digest.companyFacts),
    '',
    'Engineering:',
    bulletList(digest.engineeringFacts),
    '',
    'What they say about hiring:',
    bulletList(digest.hiringFacts),
    '',
    'Their interview process:',
    bulletList(digest.interviewFacts, '(nothing published about how they interview)'),
  ].join('\n');

  const response = await provider.generateStructured(
    [
      { role: 'system', content: SYSTEM_RULES },
      { role: 'user', content: [INSTRUCTIONS, '', facts].join('\n') },
    ],
    briefSchema,
    'company_brief',
    { stage: 'generate-company-brief', tier: 'fast', maxTokens: 1_200 },
  );

  return {
    brief: {
      summary: response.value.summary.trim(),
      what_they_do: response.value.what_they_do.trim(),
      // Sources are the pages actually fetched, recorded by code. The model is
      // not asked which URLs it used, because it has no way to know.
      sources: digest.sources,
    },
    usage: response.usage,
  };
}
