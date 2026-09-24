import type { KitRequirement } from '@prep/shared';
import { z } from 'zod';

import type { LlmProvider, LlmUsage } from '../../ai/llm-provider.js';
import { asUntrustedData } from '../../ai/untrusted.js';
import { bulletList, capText, INPUT_CAPS, SYSTEM_RULES } from '../prompts.js';

/**
 * The role breakdown: title, seniority and responsibilities.
 *
 * Requirements are already extracted and verified by this point and are passed
 * in rather than re-derived, so the two stages cannot disagree about what the
 * posting asks for.
 */

const roleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
});

export interface RoleBreakdown {
  title: string;
  seniority: string;
  responsibilities: string[];
}

const INSTRUCTIONS = [
  'Describe the role this posting is advertising.',
  '',
  '- title: the job title as the posting gives it',
  '- seniority: one word or short phrase the posting supports, such as "junior",',
  '  "mid", "senior", "staff" or "lead". Use "" if it does not say and the title',
  '  does not imply one.',
  '- responsibilities: what the person will actually do day to day, one per entry,',
  '  taken from the posting rather than from what such a role usually involves.',
  '',
  'The requirements below have already been extracted. Do not repeat them as',
  'responsibilities: a requirement is what the candidate must bring, a responsibility',
  'is what they will do.',
].join('\n');

export interface GenerateRoleResult {
  role: RoleBreakdown;
  usage: LlmUsage;
}

export async function generateRole(
  jobDescription: string,
  requirements: readonly KitRequirement[],
  provider: LlmProvider,
): Promise<GenerateRoleResult> {
  const capped = capText(jobDescription, INPUT_CAPS.jobDescription);

  const requirementList = capText(
    bulletList(
      requirements.map((requirement) => requirement.text),
      '(none extracted)',
    ),
    INPUT_CAPS.itemList,
  );

  const response = await provider.generateStructured(
    [
      { role: 'system', content: SYSTEM_RULES },
      {
        role: 'user',
        content: [
          INSTRUCTIONS,
          '',
          'Already-extracted requirements:',
          requirementList.text,
          '',
          asUntrustedData('job description', capped.text),
        ].join('\n'),
      },
    ],
    roleSchema,
    'role_breakdown',
    { stage: 'generate-role', tier: 'primary', maxTokens: 1_500 },
  );

  return {
    role: {
      title: response.value.title.trim(),
      seniority: response.value.seniority.trim(),
      responsibilities: response.value.responsibilities
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    },
    usage: response.usage,
  };
}
