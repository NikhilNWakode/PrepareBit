import type {
  KitQuestion,
  KitRequirement,
  QuestionCategory,
  RequirementKind,
} from '@prep/shared';

import type { LlmProvider } from '../ai/llm-provider.js';
import type { IdCounters } from '../domain/kit/ids.js';
import { logger } from '../logger.js';
import { generateQuestions } from '../pipeline/stages/generate-questions.js';
import type { RoleBreakdown } from '../pipeline/stages/generate-role.js';
import type { ResearchDigest } from '../pipeline/research-digest.js';
import { checkCoverage, type CoverageReport } from './check-coverage.js';

/**
 * The second pass the brief demands:
 *
 *   "The coverage check exists to force a loop rather than a single shot. After
 *   the first draft, the system compares the questions against the requirements,
 *   and any requirement with no question against it comes back as a gap. It must
 *   then act on those gaps - generating the missing questions - and check again."
 *
 * The loop is bounded, and what it must never do is close a gap by inventing
 * something. A requirement that cannot be covered is reported, not papered over.
 */

/**
 * Two rounds.
 *
 * Each round costs roughly one call per affected category. A model that has
 * twice failed to write a question for a requirement placed directly in front
 * of it will not succeed on a third attempt, and the brief prefers an honest
 * gap to a padded kit. Raising this would spend free-tier budget to buy nothing.
 */
export const MAX_GAP_ROUNDS = 2;

/**
 * One deterministic mapping, chosen so each kind lands in the category whose
 * selector already accepts it — no parallel generation path, no special cases.
 */
export const GAP_CATEGORY_BY_KIND: Record<RequirementKind, QuestionCategory> = {
  technical: 'technical',
  behavioural: 'behavioural',
  domain: 'system-design',
};

export interface CloseGapsResult {
  questions: KitQuestion[];
  counters: IdCounters;
  coverage: CoverageReport;
  /** Coverage checks performed: 1 when the first draft was already complete. */
  passes: number;
  notes: string[];
}

export interface CloseGapsDeps {
  provider: LlmProvider;
  digest: ResearchDigest;
  role: RoleBreakdown;
  maxRounds?: number;
}

export async function closeCoverageGaps(
  requirements: readonly KitRequirement[],
  initialQuestions: readonly KitQuestion[],
  counters: IdCounters,
  deps: CloseGapsDeps,
): Promise<CloseGapsResult> {
  const { provider, digest, role, maxRounds = MAX_GAP_ROUNDS } = deps;

  const requirementsById = new Map(requirements.map((requirement) => [requirement.id, requirement]));

  let questions = [...initialQuestions];
  let currentCounters = counters;
  const notes: string[] = [];

  // The first check is pass 1, whether or not anything needs fixing.
  let coverage = checkCoverage(requirements, questions);
  let passes = 1;

  for (let round = 1; round <= maxRounds; round += 1) {
    if (coverage.uncoveredMustIds.length === 0) break;

    const uncovered = coverage.uncoveredMustIds
      .map((id) => requirementsById.get(id))
      .filter((requirement): requirement is KitRequirement => requirement !== undefined);

    logger.info('coverage: filling gaps', {
      round,
      uncovered: uncovered.length,
    });

    // Group by kind so each gap is sent to the category built to assess it.
    const byCategory = new Map<QuestionCategory, KitRequirement[]>();
    for (const requirement of uncovered) {
      const category = GAP_CATEGORY_BY_KIND[requirement.kind];
      byCategory.set(category, [...(byCategory.get(category) ?? []), requirement]);
    }

    let addedThisRound = 0;

    for (const [category, subset] of byCategory) {
      try {
        // Only the uncovered requirements are passed, so the call is small and
        // the model cannot drift back onto material already covered.
        const result = await generateQuestions(
          category,
          subset,
          digest,
          role,
          provider,
          currentCounters,
        );

        questions = [...questions, ...result.questions];
        currentCounters = result.counters;
        addedThisRound += result.questions.length;
        notes.push(...result.notes);
      } catch (error) {
        // A failed gap round leaves the gap open and says so. It never
        // fabricates a question to make the count look right.
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('coverage: gap generation failed', { round, category, message });
        notes.push(`Could not generate ${category} questions to close a coverage gap: ${message}`);
      }
    }

    coverage = checkCoverage(requirements, questions);
    passes += 1;

    // Nothing new arrived, so another identical round would achieve nothing.
    if (addedThisRound === 0) break;
  }

  return { questions, counters: currentCounters, coverage, passes, notes };
}
