import { createConfiguredProvider } from '../ai/groq-provider.js';
import type { LlmProvider } from '../ai/llm-provider.js';
import { logger } from '../logger.js';
import { runKitPipeline } from '../pipeline/run-pipeline.js';
import type { KitStatus } from '../repositories/models/kit.model.js';
import type { CompanyCrawler } from '../retrieval/company-crawler.js';
import { kitRepository, type KitInput } from '../repositories/kit.repository.js';

/**
 * Runs generation in the background and keeps the stored kit honest about where
 * it has got to.
 *
 * In-process on purpose. A generation takes about a minute, and a persisted
 * state machine driven by a controlled async service is the right size for
 * this: a queue and a worker would be more infrastructure than the problem has.
 * The cost is that a restart mid-run orphans a kit, which `failStaleGenerations`
 * cleans up on boot. Recorded in the README rather than hidden, and the
 * interfaces are shaped so moving to a real queue later is a small change.
 */

/**
 * Maps the pipeline's own step ordering onto the coarse statuses the model
 * stores, so the dashboard can say something useful without the UI needing to
 * know the pipeline's internals.
 */
function statusForStep(completed: number, total: number): KitStatus {
  if (completed <= 2) return 'researching';
  if (completed >= total) return 'validating';
  return 'generating';
}

export interface StartGenerationOptions {
  /** Injected by tests; production builds one provider per run. */
  provider?: LlmProvider;
  /** Injected by tests; production lets the pipeline build the real crawler. */
  crawler?: CompanyCrawler;
}

/**
 * Drives one kit to a terminal state.
 *
 * Every path through this function ends in `completed` or `failed`. That is the
 * whole contract: a kit left in `generating` forever is worse than a kit that
 * failed, because the interface keeps polling it and the user is never told.
 */
export async function generateKit(
  kitId: string,
  input: KitInput,
  options: StartGenerationOptions = {},
): Promise<void> {
  const startedAt = Date.now();

  try {
    const provider = options.provider ?? createConfiguredProvider();

    await kitRepository.updateProgress(kitId, 'researching', {
      step: 'Starting',
      completedSteps: 0,
      totalSteps: 9,
    });

    const outcome = await runKitPipeline(
      { jobDescription: input.jd, companyUrl: input.company_url, days: input.days },
      {
        provider,
        ...(options.crawler ? { crawler: options.crawler } : {}),
        onProgress: (step, completed, total) => {
          // Fire-and-forget: a progress write that fails must not abort a
          // generation that is otherwise going fine.
          void kitRepository
            .updateProgress(kitId, statusForStep(completed, total), {
              step,
              completedSteps: completed,
              totalSteps: total,
            })
            .catch((error: unknown) => {
              logger.warn('generation: could not persist progress', {
                kitId,
                message: error instanceof Error ? error.message : String(error),
              });
            });
        },
      },
    );

    if (outcome.status === 'failed') {
      await kitRepository.failKit(kitId, {
        code: outcome.error.code,
        message: outcome.error.message,
      });
      logger.warn('generation: failed', { kitId, code: outcome.error.code });
      return;
    }

    // `ok` and `incomplete` both produced a usable kit. An incomplete one is
    // stored as completed with its coverage gap intact, exactly as the batch
    // command treats it — the interface surfaces the gap rather than hiding it.
    await kitRepository.completeKit(kitId, {
      kit: outcome.kit,
      // Empty on purpose: the map records deviations from generated, and a
      // missing entry already means "generated, and regeneration may replace
      // it". Seeding an entry per item would store the default thirty times.
      provenance: {},
      // The pipeline's own counters, not the array lengths: an id must never be
      // reissued, and only the counters know how many were ever handed out.
      idCounters: outcome.context.counters,
      // The research digest, so regenerating one section later costs one call
      // rather than another crawl.
      context: { digest: outcome.context.digest },
      research: {
        pagesUsed: outcome.kit.source.pages_used,
        // Previously hardcoded empty, which meant an unreachable site, one
        // refused by robots.txt and one merely over the response cap all
        // reached the user as the same sentence.
        pagesFailed: outcome.research.pagesFailed,
        searchUsed: outcome.research.searchUsed,
        notes: outcome.notes,
      },
    });

    logger.info('generation: completed', {
      kitId,
      status: outcome.status,
      duration: `${Math.round((Date.now() - startedAt) / 1000)}s`,
      tokens: outcome.usage.totalTokens,
    });
  } catch (error) {
    // The safety net. Anything unexpected still lands the kit in a terminal
    // state, because the alternative is a row that polls forever.
    const message = error instanceof Error ? error.message : String(error);
    logger.error('generation: unexpected failure', { kitId, message });

    await kitRepository
      .failKit(kitId, { code: 'GENERATION_FAILED', message })
      .catch((writeError: unknown) => {
        logger.error('generation: could not record the failure', {
          kitId,
          message: writeError instanceof Error ? writeError.message : String(writeError),
        });
      });
  }
}

/**
 * Starts a generation without awaiting it, so the HTTP request can return 202
 * immediately. `generateKit` handles all of its own errors, so there is no
 * rejection here to go unhandled.
 */
export function startGeneration(
  kitId: string,
  input: KitInput,
  options: StartGenerationOptions = {},
): void {
  void generateKit(kitId, input, options);
}
