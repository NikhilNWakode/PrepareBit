import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { env } from '../config/env.js';
import { createGroqProvider } from './groq-provider.js';

/**
 * The only test here that talks to the real provider.
 *
 * It is deliberately excluded from `npm test` (see vitest.config.ts) and run on
 * purpose with `npm run test:live`, so routine runs stay offline, deterministic
 * and free. Everything else about this layer is provider-mocked, because a live
 * provider cannot be made to return a 429 or malformed JSON on demand.
 *
 * What it exists to check is the set of assumptions the whole phase rests on,
 * and which documentation cannot confirm:
 *
 *   - the configured model id is real and currently served
 *   - strict JSON Schema structured output is actually honoured
 *   - `usage` comes back, since token accounting corrects itself from it
 *   - the rate-limit headers exist with the names the budgeting reads
 *
 * Two tiny calls at most. It never runs the interview-kit pipeline, and it
 * prints no secret.
 */

const RATE_LIMIT_HEADERS = [
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-tokens',
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
] as const;

/** A trivially small schema: the point is the mechanism, not the content. */
const SMOKE_SCHEMA = z.object({
  language: z.string(),
  confident: z.boolean(),
});

describe.skipIf(!env.GROQ_API_KEY)('groq provider (live)', () => {
  it('honours strict structured output on the configured model', async () => {
    const captured: Record<string, string> = {};

    // Wraps fetch only to observe headers; the request itself is unchanged.
    const observingFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      for (const header of RATE_LIMIT_HEADERS) {
        const value = response.headers.get(header);
        if (value !== null) captured[header] = value;
      }
      return response;
    };

    const provider = createGroqProvider({
      apiKey: env.GROQ_API_KEY as string,
      primaryModel: env.GROQ_PRIMARY_MODEL,
      fastModel: env.GROQ_FAST_MODEL,
      fetchImpl: observingFetch,
      // Never serve this from cache: the point is to reach the real API.
      cache: { enabled: false, get: () => Promise.resolve(null), set: () => Promise.resolve() },
    });

    const startedAt = Date.now();
    const result = await provider.generateStructured(
      [
        { role: 'system', content: 'Answer with the requested JSON only.' },
        { role: 'user', content: 'What language is "bonjour"? Answer in one word.' },
      ],
      SMOKE_SCHEMA,
      'smoke_check',
      { stage: 'live-smoke', tier: 'fast' },
    );
    const wallClockMs = Date.now() - startedAt;

    // 1-4: the configured model answered, and the result validated against Zod.
    expect(result.model).toBe(env.GROQ_FAST_MODEL);
    expect(typeof result.value.language).toBe('string');
    expect(result.value.language.length).toBeGreaterThan(0);
    expect(typeof result.value.confident).toBe('boolean');

    // 5: usage is reported, which is what corrects the token estimate.
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.usage.promptTokens).toBeGreaterThan(0);

    // 6: the headers the rate limiter reads are present and parseable.
    expect(Object.keys(captured)).toEqual(expect.arrayContaining([...RATE_LIMIT_HEADERS]));
    expect(Number(captured['x-ratelimit-remaining-tokens'])).not.toBeNaN();

    // Reported rather than asserted: these are observations, and a threshold
    // would make the test fail for someone on a slow connection.
    console.log('\n  live smoke check');
    console.log(`    model            : ${result.model}`);
    console.log(`    answer           : ${result.value.language}`);
    console.log(`    latency          : ${result.latencyMs}ms (wall clock ${wallClockMs}ms)`);
    console.log(
      `    tokens           : ${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion = ${result.usage.totalTokens}`,
    );
    console.log(`    repaired         : ${result.repaired}`);
    for (const header of RATE_LIMIT_HEADERS) {
      console.log(`    ${header.padEnd(17)}: ${captured[header] ?? '(absent)'}`);
    }
  }, 60_000);

  it('serves the primary model too, so both tiers are known good', async () => {
    const provider = createGroqProvider({
      apiKey: env.GROQ_API_KEY as string,
      primaryModel: env.GROQ_PRIMARY_MODEL,
      fastModel: env.GROQ_FAST_MODEL,
      cache: { enabled: false, get: () => Promise.resolve(null), set: () => Promise.resolve() },
    });

    const result = await provider.generateStructured(
      [{ role: 'user', content: 'What language is "hola"? Answer in one word.' }],
      SMOKE_SCHEMA,
      'smoke_check',
      { stage: 'live-smoke-primary', tier: 'primary' },
    );

    // A stale model id would otherwise surface mid-pipeline in Phase 6.
    expect(result.model).toBe(env.GROQ_PRIMARY_MODEL);
    expect(result.value.language.length).toBeGreaterThan(0);

    console.log(
      `\n  primary model ok : ${result.model} (${result.usage.totalTokens} tokens, ${result.latencyMs}ms)`,
    );
  }, 60_000);
});
