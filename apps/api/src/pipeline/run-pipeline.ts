import {
  QUESTION_CATEGORIES,
  validateKit,
  type Kit,
  type KitCompanyBrief,
  type KitQuestion,
} from '@prep/shared';

import type { LlmProvider, LlmUsage } from '../ai/llm-provider.js';
import { coverageNotes } from '../coverage/check-coverage.js';
import { closeCoverageGaps } from '../coverage/close-gaps.js';
import { EMPTY_ID_COUNTERS, type IdCounters } from '../domain/kit/ids.js';
import { logger } from '../logger.js';
import type { CompanyCrawler } from '../retrieval/company-crawler.js';
import { createCompanyCrawler } from '../retrieval/company-crawler.js';
import type { InterviewResearchProvider } from '../research/interview-research-provider.js';
import { research, type ResearchResult } from '../research/research-service.js';
import { assembleKit, deriveCompanyName } from './assemble-kit.js';
import { emptyDigest, type ResearchDigest } from './research-digest.js';
import { extractRequirements } from './stages/extract-requirements.js';
import { generateCompanyBrief } from './stages/generate-company-brief.js';
import { generateFlashcards } from './stages/generate-flashcards.js';
import { generateQuestions } from './stages/generate-questions.js';
import { generateRole, type RoleBreakdown } from './stages/generate-role.js';
import { synthesiseResearch } from './stages/synthesise-research.js';

/**
 * The single sequencing of the whole pipeline, used by both the batch entry
 * point and the HTTP API so there is no parallel implementation to drift.
 *
 * It knows nothing about Express or MongoDB: it takes input, returns an
 * outcome, and reports progress through a callback.
 */

export interface RunPipelineInput {
  jobDescription: string;
  companyUrl: string;
  days: number;
}

export interface PipelineDeps {
  provider: LlmProvider;
  crawler?: CompanyCrawler;
  searchProviders?: InterviewResearchProvider[];
  onProgress?: (step: string, completed: number, total: number) => void;
  /** Injected for deterministic tests. */
  now?: () => Date;
}

export type PipelineFailureCode =
  'EXTRACTION_FAILED' | 'COVERAGE_INCOMPLETE' | 'KIT_VALIDATION_FAILED';

/**
 * Three outcomes, deliberately distinct.
 *
 * `incomplete` exists so a kit that still has uncovered must-have requirements
 * cannot be mistaken for a finished one. The brief is unambiguous: "A kit that
 * ships with uncovered must-have requirements has failed at the one job it
 * had." The generated content is preserved for inspection, but the status
 * makes it impossible to report as a success by accident.
 */
/**
 * `digest` and `counters` travel with a successful outcome because regenerating
 * one part of a kit later needs them.
 *
 * Without the digest, regenerating a single question category would mean
 * crawling the company site and synthesising it again — a minute and most of a
 * token budget spent redoing work already done. Without the counters, they would
 * have to be inferred from array lengths, which is true today only because
 * nothing is dropped after an id has been allocated.
 */
export interface PipelineContext {
  digest: ResearchDigest;
  counters: IdCounters;
}

/**
 * What retrieval managed and failed to reach.
 *
 * Carried out of the pipeline rather than left in it, because a caller storing
 * a kit has to be able to say *why* a page was skipped. "No pages could be
 * retrieved" is the same sentence whether the site was unreachable, refused by
 * robots.txt, or simply larger than the response cap — and those need different
 * things from the user.
 */
export interface PipelineResearch {
  pagesFailed: { url: string; reason: string }[];
  searchUsed: string;
}

export type PipelineOutcome =
  | {
      status: 'ok';
      kit: Kit;
      notes: string[];
      usage: LlmUsage;
      passes: number;
      context: PipelineContext;
      research: PipelineResearch;
    }
  | {
      status: 'incomplete';
      kit: Kit;
      notes: string[];
      usage: LlmUsage;
      passes: number;
      context: PipelineContext;
      research: PipelineResearch;
      error: { code: PipelineFailureCode; message: string };
    }
  | {
      status: 'failed';
      notes: string[];
      usage: LlmUsage;
      error: { code: PipelineFailureCode; message: string };
    };

const TOTAL_STEPS = 9;

function addUsage(total: LlmUsage, next: LlmUsage | null | undefined): LlmUsage {
  if (!next) return total;
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    totalTokens: total.totalTokens + next.totalTokens,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A last-resort role when the role stage fails: taken from the posting, not invented. */
function fallbackRole(jobDescription: string): RoleBreakdown {
  const firstLine = jobDescription
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return {
    title: (firstLine ?? '').slice(0, 120),
    seniority: '',
    location: '',
    responsibilities: [],
  };
}

export async function runKitPipeline(
  input: RunPipelineInput,
  deps: PipelineDeps,
): Promise<PipelineOutcome> {
  const {
    provider,
    crawler = createCompanyCrawler(),
    searchProviders,
    onProgress,
    now = () => new Date(),
  } = deps;

  const notes: string[] = [];
  let usage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let counters: IdCounters = EMPTY_ID_COUNTERS;
  let completed = 0;

  const step = (name: string): void => {
    completed += 1;
    logger.info('pipeline: stage', { step: name, completed, total: TOTAL_STEPS });
    onProgress?.(name, completed, TOTAL_STEPS);
  };

  const companyName = deriveCompanyName(input.companyUrl);

  // --- 1 & 2: extraction and retrieval, concurrently -------------------------
  // They have no dependency on each other, and retrieval spends no tokens, so
  // overlapping them is free wall-clock against the batch time limit.
  onProgress?.('Reading the job description', 0, TOTAL_STEPS);

  const [extraction, retrieved] = await Promise.all([
    extractRequirements(input.jobDescription, provider, counters).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    research(input.companyUrl, companyName, crawler, searchProviders).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);

  // Fatal: with no requirements there is no kit to build, and padding one would
  // be exactly the invention the brief forbids.
  if (!extraction.ok) {
    return {
      status: 'failed',
      notes: [...notes, `Could not read the job description: ${describe(extraction.error)}`],
      usage,
      error: {
        code: 'EXTRACTION_FAILED',
        message: `Requirement extraction failed: ${describe(extraction.error)}`,
      },
    };
  }

  const requirements = extraction.result.requirements;
  counters = extraction.result.counters;
  usage = addUsage(usage, extraction.result.usage);
  notes.push(...extraction.result.notes);
  step('Reading the job description');

  // Recoverable: an unreachable company site is reported, not fatal.
  let researchResult: ResearchResult = {
    pages: [],
    interviewReports: [],
    pagesFailed: [],
    searchUsed: '',
    notes: [],
    hiringPagesFound: [],
  };

  if (retrieved.ok) {
    researchResult = retrieved.result;
  } else {
    notes.push(`The company website could not be researched: ${describe(retrieved.error)}`);
  }
  notes.push(...researchResult.notes);
  step('Researching the company');

  // --- 3: compress the corpus once ------------------------------------------
  let digest: ResearchDigest = emptyDigest();
  try {
    const synthesis = await synthesiseResearch(researchResult, provider);
    digest = synthesis.digest;
    usage = addUsage(usage, synthesis.usage);
    notes.push(...synthesis.notes);
  } catch (error) {
    notes.push(`Company research could not be summarised: ${describe(error)}`);
  }
  step('Summarising what was found');

  // --- 4: company brief ------------------------------------------------------
  let brief: KitCompanyBrief;
  try {
    const briefResult = await generateCompanyBrief(digest, provider);
    brief = briefResult.brief;
    usage = addUsage(usage, briefResult.usage);
  } catch (error) {
    notes.push(`The company brief could not be written: ${describe(error)}`);
    brief = {
      summary: 'The company brief could not be generated for this kit.',
      what_they_do: '',
      sources: digest.sources,
    };
  }
  step('Writing the company brief');

  // --- 5: role breakdown -----------------------------------------------------
  let role = fallbackRole(input.jobDescription);
  try {
    const roleResult = await generateRole(input.jobDescription, requirements, provider);
    role = roleResult.role;
    usage = addUsage(usage, roleResult.usage);
  } catch (error) {
    notes.push(`The role breakdown could not be generated: ${describe(error)}`);
  }
  step('Breaking down the role');

  // --- 6: questions, one call per category -----------------------------------
  let questions: KitQuestion[] = [];

  for (const category of QUESTION_CATEGORIES) {
    try {
      const result = await generateQuestions(
        category,
        requirements,
        digest,
        role,
        provider,
        counters,
      );
      questions = [...questions, ...result.questions];
      counters = result.counters;
      usage = addUsage(usage, result.usage);
      notes.push(...result.notes);
    } catch (error) {
      // One category failing must not cost the other three.
      notes.push(`No ${category} questions could be generated: ${describe(error)}`);
    }
  }
  step('Writing interview questions');

  // --- 7: coverage and the second pass ---------------------------------------
  // The first check happens inside closeCoverageGaps and is counted as pass 1,
  // so there is nothing to compute here.
  const gapResult = await closeCoverageGaps(requirements, questions, counters, {
    provider,
    digest,
    role,
  });

  questions = gapResult.questions;
  counters = gapResult.counters;
  const coverage = gapResult.coverage;
  const passes = gapResult.passes;
  notes.push(...gapResult.notes);
  notes.push(...coverageNotes(coverage, requirements));
  step('Checking every requirement is covered');

  // --- 8: flashcards ---------------------------------------------------------
  let flashcards: Awaited<ReturnType<typeof generateFlashcards>>['flashcards'] = [];
  try {
    const result = await generateFlashcards(requirements, questions, provider, counters);
    flashcards = result.flashcards;
    counters = result.counters;
    usage = addUsage(usage, result.usage);
    notes.push(...result.notes);
  } catch (error) {
    notes.push(`Flashcards could not be generated: ${describe(error)}`);
  }
  step('Building flashcards');

  // --- 9: schedule, assemble, validate ---------------------------------------
  const kit = assembleKit({
    jobDescription: input.jobDescription,
    companyUrl: input.companyUrl,
    daysAvailable: input.days,
    role,
    requirements,
    questions,
    flashcards,
    brief,
    coverage,
    passes,
    pagesUsed: researchResult.pages.map((page) => page.url),
    researchedAt: now(),
  });

  const validation = validateKit(kit);

  // Fatal: nothing leaves this function claiming to be a kit unless it is one.
  if (!validation.ok) {
    logger.error('pipeline: assembled kit failed validation', {
      issues: validation.issues.slice(0, 5).join('; '),
    });

    return {
      status: 'failed',
      notes,
      usage,
      error: {
        code: 'KIT_VALIDATION_FAILED',
        message: `The assembled kit did not match the required structure: ${validation.issues.join('; ')}`,
      },
    };
  }

  step('Planning the schedule');

  const context: PipelineContext = { digest, counters };
  const researchDetail: PipelineResearch = {
    pagesFailed: researchResult.pagesFailed,
    searchUsed: researchResult.searchUsed,
  };

  // Completion-blocking: the content is preserved for inspection, but the
  // status prevents it being reported as a finished kit.
  if (coverage.uncoveredMustIds.length > 0) {
    return {
      status: 'incomplete',
      kit: validation.kit,
      notes,
      usage,
      passes,
      context,
      research: researchDetail,
      error: {
        code: 'COVERAGE_INCOMPLETE',
        message: `${coverage.uncoveredMustIds.length} must-have requirement(s) still have no question after ${passes} coverage pass(es): ${coverage.uncoveredMustIds.join(', ')}`,
      },
    };
  }

  return {
    status: 'ok',
    kit: validation.kit,
    notes,
    usage,
    passes,
    context,
    research: researchDetail,
  };
}
