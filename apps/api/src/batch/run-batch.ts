import type { ErrorCode } from '@prep/shared';

import type { LlmProvider, LlmUsage } from '../ai/llm-provider.js';
import { withAbortSignal } from '../ai/with-abort-signal.js';
import { runKitPipeline, type PipelineFailureCode } from '../pipeline/run-pipeline.js';
import type { CompanyCrawler } from '../retrieval/company-crawler.js';
import type { InterviewResearchProvider } from '../research/interview-research-provider.js';
import {
  BATCH_OUTPUT_VERSION,
  batchCaseSchema,
  batchTimestamp,
  fallbackCaseId,
  failedEntry,
  okEntry,
  type BatchEntry,
  type BatchOutput,
} from './batch-contract.js';

/**
 * Runs the pipeline over a set of cases and produces the Appendix B document.
 *
 * Separate from the CLI so it can be tested without touching argv, the file
 * system or `process.exit`. It drives `runKitPipeline` — the same code the HTTP
 * API will use — rather than a second implementation.
 */

/**
 * Generous: one measured case took about a minute, and a case that legitimately
 * waits on the token budget takes longer. This exists to stop one pathological
 * case consuming the whole run, not to police normal slowness.
 */
export const DEFAULT_CASE_TIMEOUT_MS = 5 * 60 * 1000;

export interface RunBatchDeps {
  /**
   * One provider for the whole run, so the rate limiter tracks the token budget
   * across every case. A provider per case would each believe it had the full
   * per-minute allowance and collect 429s.
   */
  provider: LlmProvider;
  crawler?: CompanyCrawler;
  searchProviders?: InterviewResearchProvider[];
  caseTimeoutMs?: number;
  now?: () => Date;
  onCaseStart?: (index: number, total: number, id: string) => void;
  onCaseFinish?: (entry: BatchEntry, elapsedMs: number, usage: LlmUsage) => void;
}

export interface RunBatchResult {
  output: BatchOutput;
  okCount: number;
  failedCount: number;
  totalTokens: number;
}

/** Pipeline failures carry their own vocabulary; Appendix B uses the shared codes. */
const FAILURE_CODES: Record<PipelineFailureCode, ErrorCode> = {
  EXTRACTION_FAILED: 'GENERATION_FAILED',
  KIT_VALIDATION_FAILED: 'KIT_VALIDATION_FAILED',
  COVERAGE_INCOMPLETE: 'GENERATION_FAILED',
};

const NO_USAGE: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/**
 * Recovers an id even from a case that is otherwise invalid, so every input
 * gets exactly one output entry keyed by something meaningful.
 */
function caseIdFor(raw: unknown, index: number): string {
  if (typeof raw === 'object' && raw !== null && 'id' in raw) {
    const id = (raw as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim().length > 0) return id.trim();
  }
  return fallbackCaseId(index);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runOneCase(
  raw: unknown,
  index: number,
  deps: RunBatchDeps,
): Promise<{ entry: BatchEntry; usage: LlmUsage }> {
  const id = caseIdFor(raw, index);

  // Per-case validation: one bad case is one failed result, not a rejected file.
  const parsed = batchCaseSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');

    return {
      entry: failedEntry(id, 'VALIDATION_FAILED', `The case is not valid: ${detail}`),
      usage: NO_USAGE,
    };
  }

  const kitCase = parsed.data;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    deps.caseTimeoutMs ?? DEFAULT_CASE_TIMEOUT_MS,
  );

  try {
    const outcome = await runKitPipeline(
      { jobDescription: kitCase.jd, companyUrl: kitCase.company_url, days: kitCase.days },
      {
        // Cancellation reaches the provider, so a timed-out case stops spending
        // tokens the remaining cases still need.
        provider: withAbortSignal(deps.provider, controller.signal),
        ...(deps.crawler ? { crawler: deps.crawler } : {}),
        ...(deps.searchProviders ? { searchProviders: deps.searchProviders } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      },
    );

    // The pipeline treats most stage failures as recoverable, so an aborted run
    // would otherwise return a hollow kit. A deadline is a failure, and is
    // reported as one.
    if (controller.signal.aborted) {
      return {
        entry: failedEntry(id, 'GENERATION_FAILED', 'The case exceeded its time limit.'),
        usage: 'usage' in outcome ? outcome.usage : NO_USAGE,
      };
    }

    if (outcome.status === 'failed') {
      return {
        entry: failedEntry(id, FAILURE_CODES[outcome.error.code], outcome.error.message),
        usage: outcome.usage,
      };
    }

    // `ok` and `incomplete` both produced a kit.
    //
    // An incomplete kit is written out as `ok`: the FAQ reserves `failed` for a
    // case no kit could be produced for at all, and says a partially researched
    // case is still ok "with the gaps recorded honestly in the kit". The gap is
    // already named in coverage.uncovered_requirement_ids, so nothing is hidden
    // and a mostly-useful kit is not discarded.
    return { entry: okEntry(id, outcome.kit), usage: outcome.usage };
  } catch (error) {
    // Nothing a single case does may end the run.
    return {
      entry: failedEntry(id, 'GENERATION_FAILED', describe(error)),
      usage: NO_USAGE,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runBatch(
  cases: readonly unknown[],
  deps: RunBatchDeps,
): Promise<RunBatchResult> {
  const now = deps.now ?? (() => new Date());
  const entries: BatchEntry[] = [];
  let totalTokens = 0;

  // Sequential on purpose: one shared limiter serialises the model calls
  // anyway, so concurrency would only overlap crawling while making failure
  // reporting and progress harder to follow.
  for (const [index, raw] of cases.entries()) {
    const id = caseIdFor(raw, index);
    deps.onCaseStart?.(index, cases.length, id);

    const startedAt = Date.now();
    const { entry, usage } = await runOneCase(raw, index, deps);
    totalTokens += usage.totalTokens;

    entries.push(entry);
    deps.onCaseFinish?.(entry, Date.now() - startedAt, usage);
  }

  return {
    output: {
      version: BATCH_OUTPUT_VERSION,
      generated_at: batchTimestamp(now()),
      kits: entries,
    },
    okCount: entries.filter((entry) => entry.status === 'ok').length,
    failedCount: entries.filter((entry) => entry.status === 'failed').length,
    totalTokens,
  };
}
