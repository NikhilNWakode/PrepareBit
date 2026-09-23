import { LlmError } from './llm-error.js';

/**
 * Bounded retries with full jitter.
 *
 * Kept as a pure function so the curve can be asserted rather than observed:
 * backoff bugs are invisible until a provider is already struggling.
 */

export const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 20_000;

/** One stage must not be able to eat the fifteen-minute batch budget. */
export const MAX_TOTAL_WAIT_MS = 45_000;

/**
 * `attempt` is 1-based and counts the attempt that just failed.
 *
 * Full jitter — a random point in [0, exponential] — rather than a fixed curve,
 * because several stages backing off in lockstep re-collide on every wake-up.
 */
export function nextDelayMs(
  attempt: number,
  error: unknown,
  random: () => number = Math.random,
): number {
  // The provider knows better than any local guess.
  if (error instanceof LlmError && error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, MAX_DELAY_MS);
  }

  const exponential = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return Math.floor(random() * exponential);
}

export function isRetryable(error: unknown): boolean {
  return error instanceof LlmError && error.retryable;
}

export interface RetryOptions {
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = MAX_ATTEMPTS,
    sleep = defaultSleep,
    random = Math.random,
    onRetry,
  } = options;

  let spentMs = 0;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) throw error;

      const delay = nextDelayMs(attempt, error, random);

      // Better to surface the original failure than to keep waiting on it.
      if (spentMs + delay > MAX_TOTAL_WAIT_MS) throw error;
      spentMs += delay;

      onRetry?.(attempt, delay, error);
      await sleep(delay);
    }
  }
}
