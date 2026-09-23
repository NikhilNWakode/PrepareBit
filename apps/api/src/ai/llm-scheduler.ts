import { logger } from '../logger.js';
import { createRateWindow, type RateWindow } from './token-budget.js';

/**
 * Serialises model calls and holds them until the token budget allows.
 *
 * MAX_LLM_CONCURRENCY is 1 on purpose. Against an 8,000 tokens-per-minute
 * ceiling, parallel calls mostly produce 429s; predictable completion is worth
 * more here than theoretical throughput, and the batch entry point is judged on
 * finishing, not on speed.
 */
export const MAX_LLM_CONCURRENCY = 1;

export interface SchedulerLimits {
  tokensPerMinute: number;
  requestsPerMinute: number;
}

export interface LlmScheduler {
  /** Waits for room in `model`'s budget, then runs `call` alone. */
  run<T>(model: string, estimatedTokens: number, call: () => Promise<T>): Promise<T>;
  /** Replaces the estimate with what the provider actually charged. */
  settle(model: string, actualTokens: number): void;
  syncFromProvider(model: string, remainingTokens: number, resetInMs: number): void;
}

export interface SchedulerOptions extends SchedulerLimits {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createLlmScheduler({
  tokensPerMinute,
  requestsPerMinute,
  now = () => Date.now(),
  sleep = defaultSleep,
}: SchedulerOptions): LlmScheduler {
  // One window per model: the provider buckets its limits that way, which is
  // what makes routing stages across two models worth doing.
  const windows = new Map<string, RateWindow>();

  // A promise chain is the whole mutex. Nothing here needs a queue library.
  let tail: Promise<unknown> = Promise.resolve();

  function windowFor(model: string): RateWindow {
    const existing = windows.get(model);
    if (existing) return existing;

    const created = createRateWindow({ tokensPerMinute, requestsPerMinute, now });
    windows.set(model, created);
    return created;
  }

  return {
    run<T>(model: string, estimatedTokens: number, call: () => Promise<T>): Promise<T> {
      const result = tail.then(async () => {
        const window = windowFor(model);
        const waitMs = window.msUntilAvailable(estimatedTokens);

        if (waitMs > 0) {
          // Waiting here is the point: a 429 would cost the request as well.
          logger.info('llm: waiting for token budget', { model, waitMs });
          await sleep(waitMs);
        }

        window.record(estimatedTokens);
        return call();
      });

      // The chain must continue even when a call rejects, or one failure
      // deadlocks every later stage.
      tail = result.catch(() => undefined);
      return result;
    },

    settle(model: string, actualTokens: number): void {
      windowFor(model).correctLast(actualTokens);
    },

    syncFromProvider(model: string, remainingTokens: number, resetInMs: number): void {
      windowFor(model).syncFromProvider(remainingTokens, resetInMs);
    },
  };
}
