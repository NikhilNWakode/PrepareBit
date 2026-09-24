import type { Kit, KitCompanyBrief, KitFlashcard, KitQuestion, KitRequirement } from '@prep/shared';

import { allocateSchedule } from '../scheduling/allocate-schedule.js';
import { registrableDomain } from '../retrieval/url-guard.js';
import type { CoverageReport } from '../coverage/check-coverage.js';
import type { RoleBreakdown } from './stages/generate-role.js';

/**
 * Builds the Appendix A object from the parts the stages produced.
 *
 * Everything here is computed rather than generated: the model contributes
 * content, never structure, ids, counts or timestamps.
 */

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * A company name derived from its URL, deterministically.
 *
 * Not asked of the model: it has no way to know the company's name from a URL
 * it has not fetched, and a guess here would propagate into the brief, the
 * search query and `source.company`.
 *
 * `https://acme-freight.example/` -> "Acme Freight"
 * `https://careers.example.co.uk/` -> "Example"       (registrable domain, not "Co")
 * `http://localhost:8099/acme/`   -> "Acme"           (Appendix B's own example)
 */
export function deriveCompanyName(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return '';
  }

  const domain = registrableDomain(url.hostname);

  if (domain !== null) {
    const label = domain.split('.')[0];
    if (label && label.length > 0) return titleCase(label);
  }

  // No public suffix — a fixture server or a bare host. The first path segment
  // is the meaningful identifier there.
  const segment = url.pathname.split('/').find((part) => part.length > 0);
  if (segment) return titleCase(segment);

  const host = url.hostname.replace(/^www\./, '');
  return host.length > 0 ? titleCase(host.split('.')[0] ?? host) : '';
}

export interface AssembleKitInput {
  jobDescription: string;
  companyUrl: string;
  daysAvailable: number;
  role: RoleBreakdown;
  requirements: KitRequirement[];
  questions: KitQuestion[];
  flashcards: KitFlashcard[];
  brief: KitCompanyBrief;
  coverage: CoverageReport;
  passes: number;
  pagesUsed: string[];
  /** Injected so assembly stays pure and testable. */
  researchedAt?: Date;
}

export function assembleKit(input: AssembleKitInput): Kit {
  const researchedAt = input.researchedAt ?? new Date();

  return {
    source: {
      company: deriveCompanyName(input.companyUrl),
      company_url: input.companyUrl,
      role: input.role.title,
      location: input.role.location,
      // Counted, not estimated by a model.
      jd_chars: input.jobDescription.length,
      researched_at: researchedAt.toISOString(),
      pages_used: input.pagesUsed,
    },

    company_brief: input.brief,

    role: {
      title: input.role.title,
      seniority: input.role.seniority,
      responsibilities: input.role.responsibilities,
      requirements: input.requirements,
    },

    questions: input.questions,
    flashcards: input.flashcards,

    // Arithmetic, in code.
    schedule: allocateSchedule(input.requirements, input.questions, input.daysAvailable),

    coverage: {
      uncovered_requirement_ids: input.coverage.uncoveredRequirementIds,
      passes: input.passes,
    },
  };
}
