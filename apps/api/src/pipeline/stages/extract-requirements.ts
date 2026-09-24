import { REQUIREMENT_KINDS, REQUIREMENT_PRIORITIES, type KitRequirement } from '@prep/shared';
import { z } from 'zod';

import type { LlmProvider, LlmUsage } from '../../ai/llm-provider.js';
import { asUntrustedData } from '../../ai/untrusted.js';
import { allocateIds, type IdCounters } from '../../domain/kit/ids.js';
import { capText, INPUT_CAPS, SYSTEM_RULES } from '../prompts.js';
import {
  traceabilityNotes,
  verifyRequirementEvidence,
  type ExtractedRequirement,
} from '../requirement-traceability.js';

/**
 * The first stage, and the one carrying the largest scoring band: the
 * must-haves found, marked correctly, and nothing invented.
 *
 * It sees the job description and nothing else. No company research is an input
 * here, because nothing about a company is a requirement of the role — mixing
 * them is how "we use Kubernetes" becomes a requirement the posting never made.
 */

/**
 * The model's output shape, which is *not* the contract shape.
 *
 * `evidence` is internal pipeline metadata used to verify the claim and then
 * discarded. The Appendix A requirement stays exactly
 * `{ id, text, kind, priority }`.
 */
const extractionSchema = z.object({
  requirements: z.array(
    z.object({
      text: z.string(),
      evidence: z.string(),
      kind: z.enum(REQUIREMENT_KINDS),
      priority: z.enum(REQUIREMENT_PRIORITIES),
    }),
  ),
});

export interface ExtractRequirementsResult {
  requirements: KitRequirement[];
  counters: IdCounters;
  notes: string[];
  usage: LlmUsage;
}

const INSTRUCTIONS = [
  'Extract the requirements this job description states for the candidate.',
  '',
  'For every requirement, return:',
  '- text: the requirement in your own words, one specific capability per entry',
  '- evidence: a VERBATIM span copied exactly from the job description that states it',
  '- kind: "technical" (tools, languages, systems), "behavioural" (collaboration,',
  '  communication, leadership, mentoring) or "domain" (industry or subject knowledge)',
  '- priority: "must" or "nice"',
  '',
  'Priority comes from how the posting words it, not from how important it sounds:',
  '- "required", "must have", "you have", "X+ years of" -> must',
  '- "nice to have", "bonus", "a plus", "preferred", "ideally" -> nice',
  '',
  'The evidence field is checked against the posting automatically.',
  'A requirement whose evidence is not found word-for-word in the posting is discarded,',
  'so copy the span exactly rather than paraphrasing it.',
  '',
  'If the posting is short or vague, return only the few requirements it genuinely states.',
  'Returning three real requirements is a better answer than inventing ten.',
].join('\n');

export async function extractRequirements(
  jobDescription: string,
  provider: LlmProvider,
  counters: IdCounters,
): Promise<ExtractRequirementsResult> {
  const capped = capText(jobDescription, INPUT_CAPS.jobDescription);
  const notes: string[] = [];

  if (capped.truncated) {
    notes.push('The job description was very long and was truncated before analysis.');
  }

  const response = await provider.generateStructured(
    [
      { role: 'system', content: SYSTEM_RULES },
      {
        role: 'user',
        content: [INSTRUCTIONS, '', asUntrustedData('job description', capped.text)].join('\n'),
      },
    ],
    extractionSchema,
    'requirement_extraction',
    { stage: 'extract-requirements', tier: 'fast', maxTokens: 2_500 },
  );

  // The model supplies the quotation; this decides whether it is real. The
  // model is never asked to judge its own evidence.
  const verified = verifyRequirementEvidence(capped.text, response.value.requirements);
  notes.push(...traceabilityNotes(verified.dropped));

  const { ids, counters: nextCounters } = allocateIds(
    counters,
    'requirement',
    verified.kept.length,
  );

  // `evidence` is dropped here: it has done its job and has no place in the
  // contract object.
  const requirements: KitRequirement[] = verified.kept.map((requirement, index) => ({
    id: ids[index] as string,
    text: requirement.text.trim(),
    kind: requirement.kind,
    priority: requirement.priority,
  }));

  if (requirements.length === 0) {
    notes.push(
      'No requirements could be traced to this job description, so the kit is necessarily thin.',
    );
  } else if (requirements.length <= 3) {
    notes.push(
      `This job description states only ${requirements.length} requirement${requirements.length === 1 ? '' : 's'}, so the kit built from it is thin.`,
    );
  }

  return { requirements, counters: nextCounters, notes, usage: response.usage };
}

/** Exposed for the stage's own tests; not part of the contract. */
export type { ExtractedRequirement };
