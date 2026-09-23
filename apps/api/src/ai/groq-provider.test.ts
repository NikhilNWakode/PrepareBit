import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createGroqProvider, parseResetHeader } from './groq-provider.js';
import { LlmError } from './llm-error.js';
import { createLlmScheduler } from './llm-scheduler.js';
import type { LlmMessage } from './llm-provider.js';

/**
 * Provider-mocked throughout: this suite is about how the client behaves when a
 * provider misbehaves, which is precisely what a live call cannot be made to do
 * on demand.
 */

const SCHEMA = z.object({ company: z.string(), confident: z.boolean() });
const MESSAGES: LlmMessage[] = [{ role: 'user', content: 'Name the company.' }];
const OPTIONS = { stage: 'test' as const };

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function completion(content: string, totalTokens = 120): unknown {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: totalTokens },
  };
}

function errorResponse(
  status: number,
  body = '{}',
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}

/**
 * Typed as `fetch` so `mock.calls` keeps its real argument shape, and built
 * from a factory so every call gets a fresh Response — a body can only be read
 * once.
 */
function mockFetch(handler: () => Response): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(() => Promise.resolve(handler()));
}

/** No real waiting: the retry curve has its own tests. */
function provider(fetchImpl: typeof fetch) {
  return createGroqProvider({
    apiKey: 'test-key-never-logged',
    primaryModel: 'test-primary',
    fastModel: 'test-fast',
    fetchImpl,
    scheduler: createLlmScheduler({
      tokensPerMinute: 8000,
      requestsPerMinute: 30,
      sleep: () => Promise.resolve(),
    }),
    cache: { enabled: false, get: () => Promise.resolve(null), set: () => Promise.resolve() },
  });
}

describe('parseResetHeader', () => {
  it.each([
    ['7.66s', 7660],
    ['2m59.56s', 179_560],
    ['1m', 60_000],
  ])('reads %s', (header, expected) => {
    expect(parseResetHeader(header)).toBe(expected);
  });

  it('ignores a header it cannot read', () => {
    expect(parseResetHeader(null)).toBeUndefined();
    expect(parseResetHeader('soon')).toBeUndefined();
  });
});

describe('generateStructured', () => {
  it('returns a validated object on the happy path', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(completion('{"company":"Acme","confident":true}')),
    );

    const result = await provider(fetchImpl).generateStructured(
      MESSAGES,
      SCHEMA,
      'company',
      OPTIONS,
    );

    expect(result.value).toEqual({ company: 'Acme', confident: true });
    expect(result.usage.totalTokens).toBe(120);
    expect(result.repaired).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('asks for strict structured output derived from the Zod schema', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(completion('{"company":"Acme","confident":true}')),
    );

    await provider(fetchImpl).generateStructured(MESSAGES, SCHEMA, 'company', OPTIONS);

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));

    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.required).toEqual(['company', 'confident']);
    // A leftover $schema key is rejected by the provider.
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();
  });

  it('routes a tier to the configured model and hard-codes nothing', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(completion('{"company":"Acme","confident":true}')),
    );
    const groq = provider(fetchImpl);

    await groq.generateStructured(MESSAGES, SCHEMA, 'company', { ...OPTIONS, tier: 'primary' });
    await groq.generateStructured(MESSAGES, SCHEMA, 'company', { ...OPTIONS, tier: 'fast' });

    const models = fetchImpl.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).model);
    expect(models).toEqual(['test-primary', 'test-fast']);
  });

  it('repairs one invalid response and then succeeds', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(completion('not json at all')))
      .mockResolvedValueOnce(jsonResponse(completion('{"company":"Acme","confident":true}')));

    const result = await provider(fetchImpl).generateStructured(
      MESSAGES,
      SCHEMA,
      'company',
      OPTIONS,
    );

    expect(result.value.company).toBe('Acme');
    expect(result.repaired).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Usage covers both calls, so the budget is not understated.
    expect(result.usage.totalTokens).toBe(240);
  });

  it('gives up after exactly one repair rather than grinding the budget away', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(completion('{"company":123}')));

    await expect(
      provider(fetchImpl).generateStructured(MESSAGES, SCHEMA, 'company', OPTIONS),
    ).rejects.toMatchObject({ kind: 'INVALID_MODEL_RESPONSE' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('surfaces the validation problem in the error', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(completion('{"company":"Acme"}')));

    await expect(
      provider(fetchImpl).generateStructured(MESSAGES, SCHEMA, 'company', OPTIONS),
    ).rejects.toThrow(/confident/);
  });
});

describe('failure handling', () => {
  it('waits out a 429 and then succeeds', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(429, '{}', { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse(completion('{"company":"Acme","confident":true}')));

    const result = await provider(fetchImpl).generateStructured(
      MESSAGES,
      SCHEMA,
      'company',
      OPTIONS,
    );

    expect(result.value.company).toBe('Acme');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  /** Retrying a bad key cannot help and spends the daily request allowance. */
  it('never retries a 401', async () => {
    const fetchImpl = mockFetch(() => errorResponse(401));

    await expect(provider(fetchImpl).generateText(MESSAGES, OPTIONS)).rejects.toMatchObject({
      kind: 'PROVIDER_UNAVAILABLE',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('never retries a malformed request', async () => {
    const fetchImpl = mockFetch(() => errorResponse(400, '{"error":"bad param"}'));

    await expect(provider(fetchImpl).generateText(MESSAGES, OPTIONS)).rejects.toMatchObject({
      kind: 'INVALID_REQUEST',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  /**
   * Falling back to an unvalidated free-text call would let malformed content
   * reach a kit, so an unsupported model is a loud failure instead.
   */
  it('fails clearly when the model cannot do strict structured output', async () => {
    const fetchImpl = mockFetch(() =>
      errorResponse(400, '{"error":{"message":"response_format json_schema is not supported"}}'),
    );

    const error = await provider(fetchImpl)
      .generateStructured(MESSAGES, SCHEMA, 'company', OPTIONS)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('UNSUPPORTED_CAPABILITY');
    expect((error as LlmError).message).toContain('test-fast');
  });

  /**
   * Observed live: a completion budget too small for the model's hidden
   * reasoning tokens yields an empty generation and this 400. Reporting it as
   * INVALID_REQUEST would point at our request rather than at the model.
   */
  it('reports a schema the model could not satisfy as a model-response failure', async () => {
    const fetchImpl = mockFetch(() =>
      errorResponse(
        400,
        '{"error":{"message":"Failed to validate JSON.","code":"json_validate_failed","failed_generation":""}}',
      ),
    );

    const error = await provider(fetchImpl)
      .generateStructured(MESSAGES, SCHEMA, 'company', OPTIONS)
      .catch((caught: unknown) => caught);

    expect((error as LlmError).kind).toBe('INVALID_MODEL_RESPONSE');
    expect((error as LlmError).message).toContain('test-fast');
    // Not retried: the same prompt would fail the same way.
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('floors the completion budget above the model’s reasoning overhead', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(completion('{"company":"Acme","confident":true}')),
    );

    await provider(fetchImpl).generateStructured(MESSAGES, SCHEMA, 'company', {
      ...OPTIONS,
      maxTokens: 20,
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));

    // A 20-token cap is consumed entirely by reasoning, erasing the answer.
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(512);
  });

  it('treats a network failure as transient and retries it', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(jsonResponse(completion('{"company":"Acme","confident":true}')));

    await expect(provider(fetchImpl).generateText(MESSAGES, OPTIONS)).resolves.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('secret handling', () => {
  it('sends the key only as a bearer header', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(completion('{"company":"Acme","confident":true}')),
    );

    await provider(fetchImpl).generateText(MESSAGES, OPTIONS);

    const init = fetchImpl.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)['authorization']).toBe(
      'Bearer test-key-never-logged',
    );
    // And nowhere else: not in the body, not in the URL.
    expect(String(init?.body)).not.toContain('test-key-never-logged');
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('test-key-never-logged');
  });

  it('keeps the key out of the message of a provider error', async () => {
    const fetchImpl = mockFetch(() => errorResponse(500));

    const error = await provider(fetchImpl)
      .generateText(MESSAGES, OPTIONS)
      .catch((caught: unknown) => caught);

    expect(String((error as Error).message)).not.toContain('test-key-never-logged');
  });
});

describe('caching', () => {
  it('serves a cached response without calling the provider', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(completion('{"company":"Acme"}')));
    const store = new Map<string, string>();

    const groq = createGroqProvider({
      apiKey: 'k',
      primaryModel: 'test-primary',
      fastModel: 'test-fast',
      fetchImpl,
      scheduler: createLlmScheduler({
        tokensPerMinute: 8000,
        requestsPerMinute: 30,
        sleep: () => Promise.resolve(),
      }),
      cache: {
        enabled: true,
        get: (p, m, messages) =>
          Promise.resolve(store.get(JSON.stringify([p, m, messages])) ?? null),
        set: (p, m, messages, value) => {
          store.set(JSON.stringify([p, m, messages]), value);
          return Promise.resolve();
        },
      },
    });

    await groq.generateText(MESSAGES, OPTIONS);
    await groq.generateText(MESSAGES, OPTIONS);

    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
