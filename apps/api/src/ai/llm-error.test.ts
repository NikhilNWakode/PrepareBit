import { describe, expect, it } from 'vitest';

import { classifyStatus, LlmError, parseRetryAfter } from './llm-error.js';

describe('classifyStatus', () => {
  it.each([
    [429, 'RATE_LIMITED'],
    [408, 'TIMEOUT'],
    [500, 'TRANSIENT_PROVIDER_ERROR'],
    [502, 'TRANSIENT_PROVIDER_ERROR'],
    [503, 'TRANSIENT_PROVIDER_ERROR'],
    [401, 'PROVIDER_UNAVAILABLE'],
    [403, 'PROVIDER_UNAVAILABLE'],
    [400, 'INVALID_REQUEST'],
    [404, 'INVALID_REQUEST'],
    [422, 'INVALID_REQUEST'],
  ])('maps %i to %s', (status, kind) => {
    expect(classifyStatus(status)).toBe(kind);
  });
});

describe('LlmError.retryable', () => {
  it('retries what a second attempt could fix', () => {
    for (const kind of ['RATE_LIMITED', 'TRANSIENT_PROVIDER_ERROR', 'TIMEOUT'] as const) {
      expect(new LlmError(kind, 'x').retryable).toBe(true);
    }
  });

  /**
   * How long these models think before answering varies by more than 2x on
   * identical input, and that thinking is charged to the completion budget.
   * A generation that came back unusable is therefore a dice roll, not a
   * property of the request, so it is worth one more throw.
   */
  it('retries a model response that came back unusable', () => {
    expect(new LlmError('INVALID_MODEL_RESPONSE', 'x').retryable).toBe(true);
  });

  /** Each pointless retry spends one of 1,000 requests a day. */
  it('does not retry what a second attempt cannot fix', () => {
    for (const kind of [
      'INVALID_REQUEST',
      'PROVIDER_UNAVAILABLE',
      'UNSUPPORTED_CAPABILITY',
    ] as const) {
      expect(new LlmError(kind, 'x').retryable).toBe(false);
    }
  });
});

describe('parseRetryAfter', () => {
  it('reads a delay given in seconds', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('0.5')).toBe(500);
  });

  it('reads a delay given as an HTTP date', () => {
    const now = Date.parse('2026-09-24T10:00:00Z');
    const later = new Date(now + 4000).toUTCString();

    expect(parseRetryAfter(later, now)).toBeGreaterThanOrEqual(3000);
  });

  it('never returns a negative wait for a date already past', () => {
    const now = Date.parse('2026-09-24T10:00:00Z');
    const earlier = new Date(now - 10_000).toUTCString();

    expect(parseRetryAfter(earlier, now)).toBe(0);
  });

  it('ignores a missing or unintelligible header', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon please')).toBeUndefined();
  });
});
