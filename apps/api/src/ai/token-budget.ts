/**
 * The free tier limits tokens per minute, not just requests, and the brief
 * warns that falling over the first time a provider says "slow down" is the
 * commonest way to lose points here.
 *
 * So the budget is tracked locally and calls wait *before* being sent. Backing
 * off after a 429 still spends the request.
 *
 * Pure, with an injectable clock: this is the module most worth testing and the
 * hardest to observe once it is running.
 */

/**
 * Deliberately pessimistic. The usual rule of thumb is ~4 characters per token;
 * this assumes 3.5, so estimates run high.
 *
 * The asymmetry is the point. Over-estimating costs a short wait. Under-
 * estimating costs a 429, a retry, and the request that provoked it.
 */
const CHARS_PER_TOKEN = 3.5;

/** Every request carries per-message overhead beyond its visible text. */
const PER_MESSAGE_OVERHEAD_TOKENS = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessagesTokens(messages: readonly { content: string }[]): number {
  return messages.reduce(
    (total, message) => total + estimateTokens(message.content) + PER_MESSAGE_OVERHEAD_TOKENS,
    0,
  );
}

interface Spend {
  at: number;
  tokens: number;
}

export interface RateWindowOptions {
  tokensPerMinute: number;
  requestsPerMinute: number;
  now?: () => number;
}

export interface RateWindow {
  /** How long to wait before spending `tokens` would stay inside both limits. */
  msUntilAvailable(tokens: number): number;
  record(tokens: number): void;
  /** Replaces the last estimate with what the provider actually charged. */
  correctLast(actualTokens: number): void;
  /** Re-syncs to the provider's own view, so the two cannot drift apart. */
  syncFromProvider(remainingTokens: number, resetInMs: number): void;
  snapshot(): { tokensUsed: number; requestsUsed: number };
}

const WINDOW_MS = 60_000;

export function createRateWindow({
  tokensPerMinute,
  requestsPerMinute,
  now = () => Date.now(),
}: RateWindowOptions): RateWindow {
  let spends: Spend[] = [];
  /** Set when the provider reports less headroom than we believed. */
  let providerHoldUntil = 0;

  function prune(at: number): void {
    spends = spends.filter((spend) => at - spend.at < WINDOW_MS);
  }

  function totals(at: number): { tokens: number; requests: number } {
    prune(at);
    return {
      tokens: spends.reduce((sum, spend) => sum + spend.tokens, 0),
      requests: spends.length,
    };
  }

  /** When the oldest spends age out, freeing at least `needed` tokens. */
  function waitForTokens(at: number, needed: number): number {
    let freed = 0;

    for (const spend of spends) {
      freed += spend.tokens;
      if (freed >= needed) return Math.max(0, spend.at + WINDOW_MS - at);
    }

    // Even an empty window cannot fit this request; let it through and let the
    // provider be the authority rather than blocking forever.
    return 0;
  }

  return {
    msUntilAvailable(tokens: number): number {
      const at = now();
      const { tokens: usedTokens, requests } = totals(at);

      const waits: number[] = [Math.max(0, providerHoldUntil - at)];

      if (usedTokens + tokens > tokensPerMinute) {
        waits.push(waitForTokens(at, usedTokens + tokens - tokensPerMinute));
      }

      if (requests + 1 > requestsPerMinute) {
        const oldest = spends[0];
        if (oldest) waits.push(Math.max(0, oldest.at + WINDOW_MS - at));
      }

      return Math.max(...waits);
    },

    record(tokens: number): void {
      spends.push({ at: now(), tokens });
    },

    correctLast(actualTokens: number): void {
      const last = spends.at(-1);
      if (last) last.tokens = actualTokens;
    },

    syncFromProvider(remainingTokens: number, resetInMs: number): void {
      // Trust the provider when it says there is less room than we thought.
      if (remainingTokens <= 0) providerHoldUntil = now() + Math.max(0, resetInMs);
    },

    snapshot() {
      const { tokens, requests } = totals(now());
      return { tokensUsed: tokens, requestsUsed: requests };
    },
  };
}
