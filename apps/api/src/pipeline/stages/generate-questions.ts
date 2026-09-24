import type { KitQuestion, KitRequirement, QuestionCategory } from '@prep/shared';
import { z } from 'zod';

import type { LlmProvider, LlmUsage, ModelTier } from '../../ai/llm-provider.js';
import { allocateIds, type IdCounters } from '../../domain/kit/ids.js';
import { bulletList, capText, INPUT_CAPS, SYSTEM_RULES } from '../prompts.js';
import { hasHiringSignal, type ResearchDigest } from '../research-digest.js';
import type { RoleBreakdown } from './generate-role.js';

/**
 * One stage, four configurations — not four copies of the same code.
 *
 * The brief requires the categories to be genuinely distinct: "a requirement
 * like five years of React leads to technical questions while mentoring junior
 * engineers leads to behavioural ones; the two should not come from the same
 * call with the same instructions."
 *
 * So each category differs in three ways that matter:
 *   - which requirements it is given
 *   - which research context it is given
 *   - what it is told to produce
 *
 * Sharing the plumbing while varying all three is the point: a single reusable
 * stage makes the differences explicit and comparable instead of burying them
 * in four near-identical files.
 */

const questionSchema = z.object({
  questions: z.array(
    z.object({
      requirement_ids: z.array(z.string()),
      prompt: z.string(),
      answer_outline: z.string(),
      difficulty: z.number().int().min(1).max(3),
    }),
  ),
});

export interface CategoryPlan {
  tier: ModelTier;
  /** Which requirements this category is responsible for covering. */
  selectRequirements(requirements: readonly KitRequirement[]): KitRequirement[];
  /** The research this category can legitimately draw on. */
  buildContext(digest: ResearchDigest, role: RoleBreakdown): string;
  instructions: string;
}

const SHARED_RULES = [
  '',
  'For every question return:',
  '- requirement_ids: the ids from the list above that it genuinely assesses.',
  '  Cite at least one. This is how coverage is checked, so never invent an id',
  '  and never cite one the question does not actually test.',
  '- prompt: the question as an interviewer would ask it',
  '- answer_outline: the points a strong answer would hit, not a full script',
  '- difficulty: 1, 2 or 3',
  '',
  'Prefer fewer, sharper questions over padding out the list.',
].join('\n');

/**
 * The model tiers are split across categories on purpose: the free-tier rate
 * limit is applied per model, so spreading the four calls across both buckets
 * roughly halves the wall-clock time for a batch run.
 */
export const CATEGORY_PLANS: Record<QuestionCategory, CategoryPlan> = {
  technical: {
    tier: 'fast',
    selectRequirements: (requirements) =>
      requirements.filter((requirement) => requirement.kind === 'technical'),
    buildContext: (digest) =>
      ['What is known about their engineering:', bulletList(digest.engineeringFacts)].join('\n'),
    instructions: [
      'Write technical interview questions that test the skills listed below.',
      '',
      'Ask about practice rather than definitions: how they would use the thing, what',
      'goes wrong with it, how they would debug or choose between options. Avoid',
      'trivia that a search engine answers.',
    ].join('\n'),
  },

  behavioural: {
    tier: 'fast',
    selectRequirements: (requirements) =>
      requirements.filter((requirement) => requirement.kind === 'behavioural'),
    buildContext: (digest) =>
      [
        'What this company says about how it hires and works:',
        bulletList(digest.hiringFacts, '(nothing published)'),
      ].join('\n'),
    instructions: [
      'Write behavioural interview questions about the expectations listed below.',
      '',
      'Ask for specific past experience — "tell me about a time when" — not hypotheticals',
      'or opinions. The answer outline should describe the situation, the actions and the',
      'outcome an interviewer is listening for.',
    ].join('\n'),
  },

  'system-design': {
    tier: 'primary',
    selectRequirements: (requirements) =>
      requirements.filter(
        (requirement) => requirement.kind === 'technical' || requirement.kind === 'domain',
      ),
    buildContext: (digest, role) =>
      [
        `The role is: ${role.title}${role.seniority ? ` (${role.seniority})` : ''}`,
        '',
        'What they build, which the design question should resemble:',
        bulletList([...digest.products, ...digest.engineeringFacts]),
        '',
        'Their interview process:',
        bulletList(digest.interviewFacts, '(nothing published about how they interview)'),
      ].join('\n'),
    instructions: [
      'Write system design questions pitched at this role and grounded in the kind of',
      'system this company actually runs.',
      '',
      'Each should be an open design problem, not a quiz. The answer outline should name',
      'the trade-offs and failure modes a strong candidate would raise. Pitch the scope to',
      'the seniority stated above rather than defaulting to web-scale.',
    ].join('\n'),
  },

  'company-fit': {
    tier: 'primary',
    // Anchored to must-haves: a fit question still has to assess something the
    // posting actually asked for, or it cannot be coverage-checked.
    selectRequirements: (requirements) =>
      requirements.filter((requirement) => requirement.priority === 'must'),
    buildContext: (digest, role) =>
      [
        `The role is: ${role.title}`,
        '',
        'What this company does:',
        bulletList([digest.industry, ...digest.products].filter((item) => item.length > 0)),
        '',
        'About them:',
        bulletList(digest.companyFacts),
        '',
        'What they say about hiring:',
        bulletList(digest.hiringFacts, '(nothing published)'),
      ].join('\n'),
    instructions: [
      'Write questions this company specifically is likely to ask, or that the candidate',
      'should be ready to answer about working there.',
      '',
      'Ground each one in a fact listed above. If little is known about the company, write',
      'fewer questions rather than generic ones that would suit any employer — and never',
      'invent a mission, value or product that is not listed.',
    ].join('\n'),
  },
};

export interface GenerateQuestionsResult {
  questions: KitQuestion[];
  counters: IdCounters;
  notes: string[];
  usage: LlmUsage | null;
}

export async function generateQuestions(
  category: QuestionCategory,
  requirements: readonly KitRequirement[],
  digest: ResearchDigest,
  role: RoleBreakdown,
  provider: LlmProvider,
  counters: IdCounters,
): Promise<GenerateQuestionsResult> {
  const plan = CATEGORY_PLANS[category];
  const selected = plan.selectRequirements(requirements);

  // No requirements of this kind: there is nothing to assess, and a call could
  // only produce questions that cover nothing.
  if (selected.length === 0) {
    return {
      questions: [],
      counters,
      notes: [
        `No ${category} questions were generated: the posting states no matching requirements.`,
      ],
      usage: null,
    };
  }

  const requirementList = capText(
    selected.map((requirement) => `- ${requirement.id}: ${requirement.text}`).join('\n'),
    INPUT_CAPS.itemList,
  );

  const context = capText(plan.buildContext(digest, role), INPUT_CAPS.digest);

  const response = await provider.generateStructured(
    [
      { role: 'system', content: SYSTEM_RULES },
      {
        role: 'user',
        content: [
          plan.instructions,
          '',
          'Requirements to cover:',
          requirementList.text,
          '',
          context.text,
          SHARED_RULES,
        ].join('\n'),
      },
    ],
    questionSchema,
    `${category.replace('-', '_')}_questions`,
    { stage: `generate-questions:${category}`, tier: plan.tier, maxTokens: 2_500 },
  );

  // A cited id must exist, or coverage becomes unverifiable. Unknown ids are
  // dropped, and a question left citing nothing goes with them.
  const known = new Set(selected.map((requirement) => requirement.id));
  const notes: string[] = [];

  const usable = response.value.questions
    .map((question) => ({
      ...question,
      requirement_ids: [...new Set(question.requirement_ids)].filter((id) => known.has(id)),
    }))
    .filter((question) => {
      if (question.requirement_ids.length > 0 && question.prompt.trim().length > 0) return true;
      notes.push(
        `A ${category} question was discarded: it did not reference any requirement it assesses.`,
      );
      return false;
    });

  const { ids, counters: nextCounters } = allocateIds(counters, 'question', usable.length);

  const questions: KitQuestion[] = usable.map((question, index) => ({
    id: ids[index] as string,
    requirement_ids: question.requirement_ids,
    category,
    prompt: question.prompt.trim(),
    answer_outline: question.answer_outline.trim(),
    difficulty: question.difficulty,
  }));

  if (category === 'company-fit' && !hasHiringSignal(digest) && questions.length > 0) {
    notes.push(
      'Company-fit questions were written without any published hiring information, so they are general rather than specific to this company.',
    );
  }

  return { questions, counters: nextCounters, notes, usage: response.usage };
}
