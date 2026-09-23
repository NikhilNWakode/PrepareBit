import { z } from 'zod';

/**
 * The Appendix A kit structure.
 *
 * This is one of only two parts of the brief that are exact rather than open:
 * the assessment runs this pipeline over job descriptions we have not seen and
 * checks the shape of what comes back. Field names are copied verbatim and must
 * not be renamed, reordered into something friendlier, or "improved".
 *
 * Two spellings are easy to get wrong and expensive to get wrong:
 * `behavioural` is British, and `system-design` / `company-fit` are hyphenated.
 */

export const REQUIREMENT_KINDS = ['technical', 'behavioural', 'domain'] as const;
export const REQUIREMENT_PRIORITIES = ['must', 'nice'] as const;
export const QUESTION_CATEGORIES = [
  'technical',
  'behavioural',
  'system-design',
  'company-fit',
] as const;

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

const isoTimestamp = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be an ISO 8601 timestamp');

const requirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(REQUIREMENT_PRIORITIES),
});

const questionSchema = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)),
  category: z.enum(QUESTION_CATEGORIES),
  prompt: z.string().min(1),
  // May be empty: a thin job description should produce a thin kit, not padding.
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
});

const flashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string().min(1),
  back: z.string(),
  requirement_ids: z.array(z.string().min(1)),
});

const scheduleDaySchema = z.object({
  day: z.number().int().positive(),
  focus: z.string(),
  question_ids: z.array(z.string().min(1)),
  // "Durations are integer minutes. No floats, no 'about an hour'." A zero-minute
  // day is a scheduling bug, so it is rejected here rather than shipped.
  minutes: z.number().int().positive(),
});

const sourceSchema = z.object({
  // Empty is honest when the company could not be identified; invented is not.
  company: z.string(),
  company_url: z.string().min(1),
  role: z.string(),
  location: z.string(),
  jd_chars: z.number().int().nonnegative(),
  researched_at: isoTimestamp,
  pages_used: z.array(z.string().min(1)),
});

const companyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string().min(1)),
});

const roleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(requirementSchema),
});

const scheduleSchema = z.object({
  days_available: z.number().int().positive(),
  days: z.array(scheduleDaySchema),
});

const coverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string().min(1)),
  passes: z.number().int().nonnegative(),
});

const kitShape = z.object({
  source: sourceSchema,
  company_brief: companyBriefSchema,
  role: roleSchema,
  questions: z.array(questionSchema),
  flashcards: z.array(flashcardSchema),
  schedule: scheduleSchema,
  coverage: coverageSchema,
});

function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) duplicated.add(id);
    seen.add(id);
  }

  return [...duplicated];
}

/**
 * Every field can have the right type while the kit as a whole is incoherent:
 * a schedule pointing at a question that was deleted, a question claiming to
 * cover a requirement that does not exist. The brief calls one of these out by
 * name — every `question_ids` entry must refer to a question that exists — and
 * the rest follow the same principle.
 *
 * These checks are what make coverage verifiable rather than a matter of
 * opinion, so they belong in the contract, not in a caller.
 */
export const kitSchema = kitShape.superRefine((kit, ctx) => {
  const requirementIds = kit.role.requirements.map((requirement) => requirement.id);
  const questionIds = kit.questions.map((question) => question.id);
  const flashcardIds = kit.flashcards.map((flashcard) => flashcard.id);

  const knownRequirements = new Set(requirementIds);
  const knownQuestions = new Set(questionIds);

  for (const duplicate of findDuplicates(requirementIds)) {
    ctx.addIssue({
      code: 'custom',
      path: ['role', 'requirements'],
      message: `Duplicate requirement id "${duplicate}".`,
    });
  }

  for (const duplicate of findDuplicates(questionIds)) {
    ctx.addIssue({
      code: 'custom',
      path: ['questions'],
      message: `Duplicate question id "${duplicate}".`,
    });
  }

  for (const duplicate of findDuplicates(flashcardIds)) {
    ctx.addIssue({
      code: 'custom',
      path: ['flashcards'],
      message: `Duplicate flashcard id "${duplicate}".`,
    });
  }

  kit.questions.forEach((question, index) => {
    for (const requirementId of question.requirement_ids) {
      if (!knownRequirements.has(requirementId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['questions', index, 'requirement_ids'],
          message: `Question "${question.id}" references unknown requirement "${requirementId}".`,
        });
      }
    }
  });

  kit.flashcards.forEach((flashcard, index) => {
    for (const requirementId of flashcard.requirement_ids) {
      if (!knownRequirements.has(requirementId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['flashcards', index, 'requirement_ids'],
          message: `Flashcard "${flashcard.id}" references unknown requirement "${requirementId}".`,
        });
      }
    }
  });

  for (const requirementId of kit.coverage.uncovered_requirement_ids) {
    if (!knownRequirements.has(requirementId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['coverage', 'uncovered_requirement_ids'],
        message: `Coverage references unknown requirement "${requirementId}".`,
      });
    }
  }

  // "The number of days in the schedule equals the number of days requested."
  if (kit.schedule.days.length !== kit.schedule.days_available) {
    ctx.addIssue({
      code: 'custom',
      path: ['schedule', 'days'],
      message: `Schedule has ${kit.schedule.days.length} days but days_available is ${kit.schedule.days_available}.`,
    });
  }

  const dayNumbers = kit.schedule.days.map((day) => day.day);
  const expectedDays = Array.from({ length: kit.schedule.days.length }, (_, index) => index + 1);

  if (dayNumbers.join(',') !== expectedDays.join(',')) {
    ctx.addIssue({
      code: 'custom',
      path: ['schedule', 'days'],
      message: `Day numbers must run 1..${kit.schedule.days.length} in order, got [${dayNumbers.join(', ')}].`,
    });
  }

  kit.schedule.days.forEach((day, index) => {
    for (const questionId of day.question_ids) {
      if (!knownQuestions.has(questionId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['schedule', 'days', index, 'question_ids'],
          message: `Day ${day.day} references unknown question "${questionId}".`,
        });
      }
    }
  });
});

export type Kit = z.infer<typeof kitShape>;
export type KitRequirement = z.infer<typeof requirementSchema>;
export type KitQuestion = z.infer<typeof questionSchema>;
export type KitFlashcard = z.infer<typeof flashcardSchema>;
export type KitScheduleDay = z.infer<typeof scheduleDaySchema>;
export type KitSchedule = z.infer<typeof scheduleSchema>;
export type KitCoverage = z.infer<typeof coverageSchema>;
export type KitSource = z.infer<typeof sourceSchema>;
export type KitCompanyBrief = z.infer<typeof companyBriefSchema>;

export type KitValidationResult = { ok: true; kit: Kit } | { ok: false; issues: readonly string[] };

/**
 * Returns a result rather than throwing, because the generation pipeline needs
 * to record *why* a kit failed validation — a malformed kit is a reportable
 * outcome, not an exception.
 */
export function validateKit(value: unknown): KitValidationResult {
  const result = kitSchema.safeParse(value);
  if (result.success) return { ok: true, kit: result.data };

  return {
    ok: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}
