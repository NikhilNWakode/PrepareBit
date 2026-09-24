import { QUESTION_CATEGORIES, REQUIREMENT_KINDS, REQUIREMENT_PRIORITIES } from '@prep/shared';
import { z } from 'zod';

/**
 * The brief allows a 1-day schedule and a 60-day one, and both are tested. The
 * bound is here rather than only in the UI, because the UI is not the boundary.
 */
export const MIN_DAYS = 1;
export const MAX_DAYS = 60;

/** A pasted posting. Long enough to contain something; bounded to stay affordable. */
const jobDescription = z
  .string()
  .trim()
  .min(20, 'Paste the job description — a few words is not enough to work from.')
  .max(50_000, 'That job description is too long to process.');

const companyUrl = z
  .string()
  .trim()
  .min(1, 'Enter the company website address.')
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Enter a full website address, including https://');

const days = z.coerce
  .number({ message: 'Enter how many days you have.' })
  .int('Enter a whole number of days.')
  .min(MIN_DAYS, `Enter at least ${MIN_DAYS} day.`)
  .max(MAX_DAYS, `Enter at most ${MAX_DAYS} days.`);

export const createKitSchema = z.object({
  jd: jobDescription,
  company_url: companyUrl,
  days,
});

export type CreateKitBody = z.infer<typeof createKitSchema>;

// --- editing -----------------------------------------------------------------

/**
 * The version the client was working from, sent with every change.
 *
 * Required rather than optional: a write with no version is a write that cannot
 * be checked, and an optional guard is the same as no guard for whoever forgets
 * to send it.
 */
const version = z
  .string({ message: 'Reload this kit and try again.' })
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Reload this kit and try again.');

/** Long enough for a real answer outline, bounded so a kit stays a kit. */
const prose = (max: number) => z.string().max(max, 'That is longer than this field allows.');

const difficulty = z.coerce
  .number({ message: 'Choose a difficulty.' })
  .int()
  .min(1, 'Difficulty runs from 1 to 3.')
  .max(3, 'Difficulty runs from 1 to 3.');

const requirementIds = z.array(z.string().min(1)).max(20);

export const versionedSchema = z.object({ version });

export const editQuestionSchema = z
  .object({
    version,
    prompt: prose(2_000).trim().min(1, 'A question needs a prompt.').optional(),
    answer_outline: prose(4_000).optional(),
    difficulty: difficulty.optional(),
    requirement_ids: requirementIds.optional(),
    pinned: z.boolean().optional(),
  })
  // A patch that changes nothing is a mistake worth naming rather than a
  // silent no-op that still bumps the version for everyone else.
  .refine(
    (body) => Object.keys(body).some((key) => key !== 'version'),
    'There is nothing to change here.',
  );

export const addQuestionSchema = z.object({
  version,
  category: z.enum(QUESTION_CATEGORIES),
  prompt: prose(2_000).trim().min(1, 'A question needs a prompt.'),
  answer_outline: prose(4_000).default(''),
  difficulty,
  requirement_ids: requirementIds.default([]),
});

export const reorderSchema = z.object({
  version,
  ids: z.array(z.string().min(1)).min(1, 'Nothing to reorder.').max(200),
});

export const reorderQuestionsSchema = reorderSchema.extend({
  category: z.enum(QUESTION_CATEGORIES),
});

export const editFlashcardSchema = z
  .object({
    version,
    front: prose(500).trim().min(1, 'A flashcard needs a front.').optional(),
    back: prose(2_000).optional(),
    requirement_ids: requirementIds.optional(),
    pinned: z.boolean().optional(),
  })
  .refine(
    (body) => Object.keys(body).some((key) => key !== 'version'),
    'There is nothing to change here.',
  );

export const addFlashcardSchema = z.object({
  version,
  front: prose(500).trim().min(1, 'A flashcard needs a front.'),
  back: prose(2_000).default(''),
  requirement_ids: requirementIds.default([]),
});

export const editBriefSchema = z
  .object({
    version,
    summary: prose(4_000).optional(),
    what_they_do: prose(4_000).optional(),
  })
  .refine(
    (body) => body.summary !== undefined || body.what_they_do !== undefined,
    'There is nothing to change here.',
  );

export const editRequirementSchema = z
  .object({
    version,
    text: prose(1_000).trim().min(1, 'A requirement needs some text.').optional(),
    kind: z.enum(REQUIREMENT_KINDS).optional(),
    priority: z.enum(REQUIREMENT_PRIORITIES).optional(),
  })
  .refine(
    (body) => Object.keys(body).some((key) => key !== 'version'),
    'There is nothing to change here.',
  );

export const editScheduleDaySchema = z.object({
  version,
  day: z.coerce.number().int().positive(),
  focus: prose(300),
});

export const regenerateCategorySchema = z.object({
  version,
  category: z.enum(QUESTION_CATEGORIES),
});

export type EditQuestionBody = z.infer<typeof editQuestionSchema>;
export type AddQuestionBody = z.infer<typeof addQuestionSchema>;
export type ReorderQuestionsBody = z.infer<typeof reorderQuestionsSchema>;
export type ReorderBody = z.infer<typeof reorderSchema>;
export type EditFlashcardBody = z.infer<typeof editFlashcardSchema>;
export type AddFlashcardBody = z.infer<typeof addFlashcardSchema>;
export type EditBriefBody = z.infer<typeof editBriefSchema>;
export type EditRequirementBody = z.infer<typeof editRequirementSchema>;
export type EditScheduleDayBody = z.infer<typeof editScheduleDaySchema>;
export type VersionedBody = z.infer<typeof versionedSchema>;
