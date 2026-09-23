import { describe, expect, it, vi } from 'vitest';

import { LlmError } from './llm-error.js';
import { isRetryable, nextDelayMs, withRetry } from './retry.js';

describe('nextDelayMs', () => {
  it('prefers the provider’s own retry-after over any local guess', () => {
    const error = new LlmError('RATE_LIMITED', 'slow down', { retryAfterMs: 2500 });

    expect(nextDelayMs(1, error, () => 0.5)).toBe(2500);
  });

  it('caps an absurd retry-after', () => {
    const error = new LlmError('RATE_LIMITED', 'slow down', { retryAfterMs: 10 * 60 * 1000 });

    expect(nextDelayMs(1, error, () => 1)).toBeLessThanOrEqual(20_000);
  });

  it('backs off exponentially across attempts', () => {
    const error = new LlmError('TRANSIENT_PROVIDER_ERROR', 'boom');
    const full = (attempt: number) => nextDelayMs(attempt, error, () => 0.999);

    expect(full(2)).toBeGreaterThan(full(1));
    expect(full(3)).toBeGreaterThan(full(2));
  });

  /** Fixed backoff makes parallel stages wake together and collide again. */
  it('applies full jitter, so two waiters do not wake in lockstep', () => {
    const error = new LlmError('TRANSIENT_PROVIDER_ERROR', 'boom');

    expect(nextDelayMs(3, error, () => 0)).toBe(0);
    expect(nextDelayMs(3, error, () => 0.99)).toBeGreaterThan(0);
  });
});

describe('isRetryable', () => {
  it('is false for anything that is not an LlmError', () => {
    expect(isRetryable(new Error('ordinary'))).toBe(false);
    expect(isRetryable('a string')).toBe(false);
  });
});

describe('withRetry', () => {
  const noSleep = () => Promise.resolve();

  it('returns immediately on success', async () => {
    const operation = vi.fn(() => Promise.resolve('done'));

    await expect(withRetry(operation, { sleep: noSleep })).resolves.toBe('done');
    expect(operation).toHaveBeenCalledOnce();
  });

  it('retries a transient failure and then succeeds', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new LlmError('TRANSIENT_PROVIDER_ERROR', 'boom'))
      .mockResolvedValue('recovered');

    await expect(withRetry(operation, { sleep: noSleep })).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt limit', async () => {
    const operation = vi.fn(() => Promise.reject(new LlmError('TIMEOUT', 'slow')));

    await expect(withRetry(operation, { sleep: noSleep })).rejects.toThrow('slow');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('does not retry a bad key, which would only burn quota', async () => {
    const operation = vi.fn(() => Promise.reject(new LlmError('PROVIDER_UNAVAILABLE', 'bad key')));

    await expect(withRetry(operation, { sleep: noSleep })).rejects.toThrow('bad key');
    expect(operation).toHaveBeenCalledOnce();
  });

  it('does not retry an ordinary error', async () => {
    const operation = vi.fn(() => Promise.reject(new Error('programming mistake')));

    await expect(withRetry(operation, { sleep: noSleep })).rejects.toThrow('programming mistake');
    expect(operation).toHaveBeenCalledOnce();
  });

  it('reports each retry so a slow stage is visible in the log', async () => {
    const onRetry = vi.fn();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new LlmError('RATE_LIMITED', 'slow down', { retryAfterMs: 10 }))
      .mockResolvedValue('ok');

    await withRetry(operation, { sleep: noSleep, onRetry });

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry.mock.calls[0]?.[1]).toBe(10);
  });

  /** One stalled stage must not consume the fifteen-minute batch budget. */
  it('stops waiting once the total wait ceiling is reached', async () => {
    const operation = vi.fn(() =>
      Promise.reject(new LlmError('RATE_LIMITED', 'slow', { retryAfterMs: 20_000 })),
    );

    await expect(withRetry(operation, { sleep: noSleep, maxAttempts: 10 })).rejects.toThrow('slow');

    expect(operation.mock.calls.length).toBeLessThan(10);
  });
});
