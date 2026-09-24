import type { KitQuestion, KitRequirement } from '@prep/shared';

/**
 * Which requirements have a question against them, and which do not.
 *
 * The brief is explicit that this is not the model's decision: "Comparing the
 * extracted requirements against the generated questions to find the gaps is
 * likewise your code's decision to make, not the model's."
 *
 * The check is only meaningful because every question carries the requirement
 * ids it assesses, and because question generation already strips citations
 * that do not resolve. Asking a model "did we cover everything?" would produce
 * an opinion; this produces a fact.
 *
 * Pure: no clock, no randomness, no I/O.
 */

export interface CoverageReport {
  coveredRequirementIds: string[];
  /** Everything without a question, `must` and `nice` alike. */
  uncoveredRequirementIds: string[];
  /** The subset that actually blocks: only these drive the second pass. */
  uncoveredMustIds: string[];
}

export function checkCoverage(
  requirements: readonly KitRequirement[],
  questions: readonly KitQuestion[],
): CoverageReport {
  const covered = new Set<string>();

  for (const question of questions) {
    for (const requirementId of question.requirement_ids) {
      covered.add(requirementId);
    }
  }

  const coveredRequirementIds: string[] = [];
  const uncoveredRequirementIds: string[] = [];
  const uncoveredMustIds: string[] = [];

  // Driven by the requirement list rather than by the covered set, so a
  // question citing an id that no longer exists cannot inflate the result.
  for (const requirement of requirements) {
    if (covered.has(requirement.id)) {
      coveredRequirementIds.push(requirement.id);
      continue;
    }

    uncoveredRequirementIds.push(requirement.id);
    if (requirement.priority === 'must') uncoveredMustIds.push(requirement.id);
  }

  return { coveredRequirementIds, uncoveredRequirementIds, uncoveredMustIds };
}

/** Honest wording for `research.notes` when something is still uncovered. */
export function coverageNotes(
  report: CoverageReport,
  requirements: readonly KitRequirement[],
): string[] {
  if (report.uncoveredRequirementIds.length === 0) return [];

  const byId = new Map(requirements.map((requirement) => [requirement.id, requirement]));

  const describe = (id: string): string => {
    const requirement = byId.get(id);
    return requirement ? `${id} (${requirement.priority}): ${requirement.text}` : id;
  };

  const notes: string[] = [];

  if (report.uncoveredMustIds.length > 0) {
    notes.push(
      `${report.uncoveredMustIds.length} must-have requirement${report.uncoveredMustIds.length === 1 ? '' : 's'} could not be covered by a question:`,
      ...report.uncoveredMustIds.map((id) => `  - ${describe(id)}`),
    );
  }

  const niceIds = report.uncoveredRequirementIds.filter(
    (id) => !report.uncoveredMustIds.includes(id),
  );

  if (niceIds.length > 0) {
    notes.push(
      `${niceIds.length} nice-to-have requirement${niceIds.length === 1 ? '' : 's'} have no question, which is acceptable but worth knowing:`,
      ...niceIds.map((id) => `  - ${describe(id)}`),
    );
  }

  return notes;
}
