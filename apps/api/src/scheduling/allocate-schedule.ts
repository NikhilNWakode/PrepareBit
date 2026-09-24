import type { KitQuestion, KitRequirement, KitSchedule, QuestionCategory } from '@prep/shared';

/**
 * Distributing material across the days available is arithmetic, and the brief
 * says so: "Allocating topics across the days available is arithmetic, and the
 * application should do it." No model is involved here.
 *
 * Pure and deterministic — no clock, no randomness. The same inputs always
 * produce the same schedule, which is what makes it testable at all.
 */

/** Study minutes for a question the first time it is seen, by difficulty. */
const MINUTES_BY_DIFFICULTY: Record<number, number> = { 1: 10, 2: 15, 3: 25 };

/** Revisiting costs less than learning. */
const REVIEW_MINUTES_DIVISOR = 2;

/** A scheduled day is worth opening the laptop for. */
const MIN_DAY_MINUTES = 15;

/** How many earlier questions a review day revisits. */
const REVIEW_BATCH_SIZE = 3;

const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  'system-design': 'System design',
  'company-fit': 'Company fit',
};

/**
 * The internal plan, which distinguishes the two things a contract
 * `question_ids` array cannot.
 *
 * `introduced` is new material and every question appears in exactly one day's
 * introduced list. `review` repeats ids introduced on an earlier day and never
 * counts as an introduction — otherwise "every question is scheduled" would be
 * satisfiable by repeating one question sixty times.
 */
export interface DayPlan {
  day: number;
  introduced: string[];
  review: string[];
  minutes: number;
  focus: string;
}

function priorityWeight(
  question: KitQuestion,
  requirementsById: Map<string, KitRequirement>,
): number {
  // The strongest priority among the requirements it covers: a question
  // assessing one must and one nice is must-grade material.
  const isMust = question.requirement_ids.some(
    (id) => requirementsById.get(id)?.priority === 'must',
  );
  return isMust ? 2 : 1;
}

/** Higher scores study earlier. Ties break on id, so ordering is stable. */
function sortByStudyOrder(
  questions: readonly KitQuestion[],
  requirementsById: Map<string, KitRequirement>,
): KitQuestion[] {
  return [...questions].sort((left, right) => {
    const leftScore = priorityWeight(left, requirementsById) * 10 + left.difficulty;
    const rightScore = priorityWeight(right, requirementsById) * 10 + right.difficulty;

    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.id.localeCompare(right.id);
  });
}

/**
 * Splits `total` items across `days` using the largest-remainder method over
 * front-loaded weights, so day 1 gets the biggest share.
 *
 * Largest remainder rather than rounding each share independently, because it
 * is guaranteed to sum to exactly `total` — no question silently dropped or
 * scheduled twice.
 */
export function allocateCounts(total: number, days: number): number[] {
  if (days <= 0) return [];
  if (total <= 0) return new Array<number>(days).fill(0);

  const weights = Array.from({ length: days }, (_unused, index) => days - index);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

  const exact = weights.map((weight) => (total * weight) / weightSum);
  const counts = exact.map((value) => Math.floor(value));

  const allocated = counts.reduce((sum, count) => sum + count, 0);
  const remainder = total - allocated;

  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (let position = 0; position < remainder; position += 1) {
    const entry = byFraction[position];
    if (entry) counts[entry.index] = (counts[entry.index] ?? 0) + 1;
  }

  return counts;
}

function minutesFor(
  introduced: readonly KitQuestion[],
  reviewCount: number,
  hasAnyMaterial: boolean,
): number {
  if (!hasAnyMaterial) return MIN_DAY_MINUTES;

  const learning = introduced.reduce(
    (total, question) => total + (MINUTES_BY_DIFFICULTY[question.difficulty] ?? 15),
    0,
  );
  const reviewing = Math.round((reviewCount * 15) / REVIEW_MINUTES_DIVISOR);

  return Math.max(MIN_DAY_MINUTES, learning + reviewing);
}

function focusFor(
  introduced: readonly KitQuestion[],
  reviewed: readonly KitQuestion[],
  requirementsById: Map<string, KitRequirement>,
  hasAnyMaterial: boolean,
): string {
  // Honest rather than invented: a posting nothing could be extracted from
  // produces days that say so.
  if (!hasAnyMaterial) {
    return 'No study material — nothing could be extracted from this job description';
  }

  if (introduced.length === 0) {
    const categories = [...new Set(reviewed.map((question) => question.category))]
      .map((category) => CATEGORY_LABELS[category])
      .sort();
    return categories.length > 0 ? `Review: ${categories.join(' and ')}` : 'Review';
  }

  const counts = new Map<QuestionCategory, number>();
  for (const question of introduced) {
    counts.set(question.category, (counts.get(question.category) ?? 0) + 1);
  }

  const dominant = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0];

  const label = dominant ? CATEGORY_LABELS[dominant[0]] : 'Practice';

  // Name what is actually being studied, taken from the highest-priority
  // requirement the day covers.
  const leadRequirement = introduced
    .flatMap((question) => question.requirement_ids)
    .map((id) => requirementsById.get(id))
    .find((requirement) => requirement !== undefined);

  if (!leadRequirement) return label;

  const subject =
    leadRequirement.text.length > 60
      ? `${leadRequirement.text.slice(0, 57).trimEnd()}...`
      : leadRequirement.text;

  return `${label}: ${subject}`;
}

/**
 * The full plan, exposed separately from the contract shape so the
 * introduce-once invariant can be asserted directly in tests.
 */
export function planSchedule(
  requirements: readonly KitRequirement[],
  questions: readonly KitQuestion[],
  daysAvailable: number,
): DayPlan[] {
  const days = Math.max(1, Math.floor(daysAvailable));
  const requirementsById = new Map(
    requirements.map((requirement) => [requirement.id, requirement]),
  );

  const ordered = sortByStudyOrder(questions, requirementsById);
  const byId = new Map(ordered.map((question) => [question.id, question]));
  const counts = allocateCounts(ordered.length, days);

  const hasAnyMaterial = ordered.length > 0;
  const plans: DayPlan[] = [];

  let cursor = 0;
  /** Everything introduced so far, in order, for review days to draw from. */
  const introducedSoFar: string[] = [];
  let reviewOffset = 0;

  for (let index = 0; index < days; index += 1) {
    const take = counts[index] ?? 0;
    const introduced = ordered.slice(cursor, cursor + take);
    cursor += take;

    let review: string[] = [];

    // A day with no new material revisits earlier work rather than sitting
    // empty. Only possible once something has been introduced.
    if (introduced.length === 0 && introducedSoFar.length > 0) {
      const size = Math.min(REVIEW_BATCH_SIZE, introducedSoFar.length);
      review = Array.from({ length: size }, (_unused, offset) => {
        const id = introducedSoFar[(reviewOffset + offset) % introducedSoFar.length];
        return id as string;
      });
      reviewOffset = (reviewOffset + size) % introducedSoFar.length;
    }

    const reviewedQuestions = review
      .map((id) => byId.get(id))
      .filter((question): question is KitQuestion => question !== undefined);

    plans.push({
      day: index + 1,
      introduced: introduced.map((question) => question.id),
      review,
      minutes: minutesFor(introduced, review.length, hasAnyMaterial),
      focus: focusFor(introduced, reviewedQuestions, requirementsById, hasAnyMaterial),
    });

    introducedSoFar.push(...introduced.map((question) => question.id));
  }

  return plans;
}

/** The Appendix A shape, flattened from the plan. */
export function allocateSchedule(
  requirements: readonly KitRequirement[],
  questions: readonly KitQuestion[],
  daysAvailable: number,
): KitSchedule {
  const plans = planSchedule(requirements, questions, daysAvailable);

  return {
    days_available: plans.length,
    days: plans.map((plan) => ({
      day: plan.day,
      focus: plan.focus,
      question_ids: [...plan.introduced, ...plan.review],
      minutes: plan.minutes,
    })),
  };
}
