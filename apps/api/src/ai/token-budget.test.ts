import { describe, expect, it } from 'vitest';

import { createRateWindow, estimateMessagesTokens, estimateTokens } from './token-budget.js';

/** A controllable clock, so the sliding window can be tested without waiting. */
function clock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

describe('estimateTokens', () => {
  it('grows with the length of the text', () => {
    expect(estimateTokens('a'.repeat(100))).toBeGreaterThan(estimateTokens('a'.repeat(10)));
  });

  it('returns zero for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  /**
   * The asymmetry that matters: over-estimating costs a short wait, while
   * under-estimating costs a 429 plus the request that provoked it.
   */
  it('errs high against the usual 4-chars-per-token rule', () => {
    const text = 'x'.repeat(4000);

    expect(estimateTokens(text)).toBeGreaterThan(1000);
  });

  it('adds per-message overhead', () => {
    const single = estimateMessagesTokens([{ content: 'hello' }]);
    const split = estimateMessagesTokens([{ content: 'hel' }, { content: 'lo' }]);

    expect(split).toBeGreaterThan(single);
  });
});

describe('createRateWindow', () => {
  it('allows a request that fits the budget', () => {
    const window = createRateWindow({ tokensPerMinute: 8000, requestsPerMinute: 30 });

    expect(window.msUntilAvailable(1000)).toBe(0);
  });

  it('makes a request wait once the token budget is spent', () => {
    const time = clock();
    const window = createRateWindow({
      tokensPerMinute: 8000,
      requestsPerMinute: 30,
      now: time.now,
    });

    window.record(7500);

    expect(window.msUntilAvailable(1000)).toBeGreaterThan(0);
  });

  it('frees budget as the window slides', () => {
    const time = clock();
    const window = createRateWindow({
      tokensPerMinute: 8000,
      requestsPerMinute: 30,
      now: time.now,
    });

    window.record(8000);
    expect(window.msUntilAvailable(1000)).toBeGreaterThan(0);

    time.advance(60_001);
    expect(window.msUntilAvailable(1000)).toBe(0);
  });

  it('waits only as long as it takes for enough budget to age out', () => {
    const time = clock();
    const window = createRateWindow({
      tokensPerMinute: 8000,
      requestsPerMinute: 30,
      now: time.now,
    });

    window.record(4000);
    time.advance(10_000);
    window.record(4000);

    // The first spend ages out 50s from now, which is enough on its own.
    expect(window.msUntilAvailable(3000)).toBe(50_000);
  });

  it('enforces the request limit even when tokens are plentiful', () => {
    const time = clock();
    const window = createRateWindow({ tokensPerMinute: 8000, requestsPerMinute: 2, now: time.now });

    window.record(1);
    window.record(1);

    expect(window.msUntilAvailable(1)).toBeGreaterThan(0);
  });

  it('replaces an estimate with the provider’s actual charge', () => {
    const window = createRateWindow({ tokensPerMinute: 8000, requestsPerMinute: 30 });

    window.record(3000);
    window.correctLast(500);

    expect(window.snapshot().tokensUsed).toBe(500);
  });

  it('holds off when the provider reports no headroom left', () => {
    const time = clock();
    const window = createRateWindow({
      tokensPerMinute: 8000,
      requestsPerMinute: 30,
      now: time.now,
    });

    window.syncFromProvider(0, 5_000);

    expect(window.msUntilAvailable(10)).toBe(5_000);

    time.advance(5_001);
    expect(window.msUntilAvailable(10)).toBe(0);
  });

  it('lets an oversized request through rather than blocking forever', () => {
    const window = createRateWindow({ tokensPerMinute: 8000, requestsPerMinute: 30 });

    // Bigger than the whole per-minute budget: waiting cannot help, so the
    // provider is left to be the authority.
    expect(window.msUntilAvailable(20_000)).toBe(0);
  });
});
