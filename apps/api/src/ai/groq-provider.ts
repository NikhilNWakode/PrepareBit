import { z, type ZodType } from 'zod';

import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { classifyStatus, LlmError, parseRetryAfter } from './llm-error.js';
import type {
  GenerateOptions,
  LlmMessage,
  LlmProvider,
  LlmStructuredResult,
  LlmTextResult,
  LlmUsage,
  ModelTier,
} from './llm-provider.js';
import { extractJsonObject } from './parse-json-response.js';
import { createResponseCache, type ResponseCache } from './response-cache.js';
import { createLlmScheduler, type LlmScheduler } from './llm-scheduler.js';
import { withRetry } from './retry.js';
import { estimateMessagesTokens } from './token-budget.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 60_000;

/** Free-tier limits for the gpt-oss models, applied per model. */
const TOKENS_PER_MINUTE = 8_000;
const REQUESTS_PER_MINUTE = 30;

const DEFAULT_MAX_TOKENS = 2_000;

/**
 * The gpt-oss models are reasoning models: they spend hidden reasoning tokens
 * out of the same completion budget before emitting anything.
 *
 * Measured against the live API — asking which language "hola" is, a two-word
 * answer, consumed 133 completion tokens of which 111 were reasoning. A cap of
 * 100 produced an empty generation and a `json_validate_failed` 400; 400
 * succeeded.
 *
 * So a caller's budget is floored rather than taken literally. A too-small cap
 * does not truncate the answer, it erases it, and the resulting error points at
 * the schema rather than at the real cause.
 */
const MIN_COMPLETION_TOKENS = 512;

/**
 * Headroom added on top of whatever a stage asks for.
 *
 * A stage can reason about how much *output* it needs — roughly 650 tokens of
 * JSON for a requirement list. It cannot reason about how long the model will
 * think first, and on these models that thinking is charged to the same
 * budget and is not proportional to anything the caller can see.
 *
 * Measured on one real 1,725-character posting, same prompt, same temperature:
 *
 *   gpt-oss-20b    2,890 reasoning + 633 json
 *   gpt-oss-20b    1,757 reasoning + 685 json   (a longer posting — less thinking)
 *   gpt-oss-120b   1,260 reasoning + 683 json
 *
 * So reasoning varies by more than 2x run to run and does not grow with the
 * input. A cap sized for the typical case fails intermittently on the same
 * input, which is the worst kind of failure to diagnose.
 *
 * This is a ceiling, not a spend: the budget is charged on tokens actually
 * used, so generous headroom costs nothing on an easy call and is the
 * difference between a kit and an error on a hard one.
 */
const REASONING_HEADROOM_TOKENS = 4_000;

/** Keeps a single call inside one minute of the free tier's per-model budget. */
const MAX_COMPLETION_TOKENS = 7_000;

/**
 * Turns a stage's output budget into a completion cap the model can actually
 * work within.
 */
export function completionCapFor(requested: number | undefined): number {
  const output = Math.max(requested ?? DEFAULT_MAX_TOKENS, MIN_COMPLETION_TOKENS);
  return Math.min(output + REASONING_HEADROOM_TOKENS, MAX_COMPLETION_TOKENS);
}

interface GroqChoice {
  message?: { content?: string };
  finish_reason?: string;
}

interface GroqResponse {
  choices?: GroqChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function usageFrom(response: GroqResponse, fallbackPromptTokens: number): LlmUsage {
  return {
    promptTokens: response.usage?.prompt_tokens ?? fallbackPromptTokens,
    completionTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? fallbackPromptTokens,
  };
}

/**
 * Groq reports remaining budget on every response. Reading it keeps the local
 * window from drifting away from the server's view over a long batch run, where
 * a small per-call estimation error would otherwise accumulate.
 *
 * Reset values look like "7.66s" or "2m59.56s".
 */
export function parseResetHeader(value: string | null): number | undefined {
  if (!value) return undefined;

  const match = /^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(value.trim());
  if (!match) return undefined;

  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2] ?? 0);
  if (minutes === 0 && seconds === 0) return undefined;

  return Math.round((minutes * 60 + seconds) * 1000);
}

/**
 * Strict structured output, not loose JSON mode: the schema constrains
 * generation rather than merely asking for valid JSON.
 *
 * Derived from the caller's Zod schema so the shape is defined exactly once.
 */
function toStrictJsonSchema(schema: ZodType<unknown>, name: string): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  // The provider rejects a schema carrying the $schema key.
  delete jsonSchema['$schema'];

  return { name, schema: jsonSchema, strict: true };
}

export interface GroqProviderOptions {
  apiKey: string;
  primaryModel: string;
  fastModel: string;
  scheduler?: LlmScheduler;
  cache?: ResponseCache;
  fetchImpl?: typeof fetch;
}

export function createGroqProvider({
  apiKey,
  primaryModel,
  fastModel,
  scheduler = createLlmScheduler({
    tokensPerMinute: TOKENS_PER_MINUTE,
    requestsPerMinute: REQUESTS_PER_MINUTE,
  }),
  cache = createResponseCache(),
  fetchImpl = fetch,
}: GroqProviderOptions): LlmProvider {
  function modelFor(tier: ModelTier = 'fast'): string {
    return tier === 'primary' ? primaryModel : fastModel;
  }

  /** One HTTP round trip. Never retries; `withRetry` owns that decision. */
  async function callOnce(
    model: string,
    messages: LlmMessage[],
    options: GenerateOptions,
    responseFormat?: Record<string, unknown>,
  ): Promise<{ text: string; usage: LlmUsage; latencyMs: number }> {
    const startedAt = Date.now();
    const estimated = estimateMessagesTokens(messages);

    return scheduler.run(model, estimated, async () => {
      let response: Response;

      try {
        response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            // The key lives only in this header. It is never logged, never
            // placed in an error message, and never part of a cache key.
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: options.temperature ?? 0.2,
            max_completion_tokens: completionCapFor(options.maxTokens),
            ...(responseFormat ? { response_format: responseFormat } : {}),
          }),
          signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const aborted = error instanceof Error && /abort|timeout/i.test(error.name + error.message);
        throw new LlmError(
          aborted ? 'TIMEOUT' : 'TRANSIENT_PROVIDER_ERROR',
          aborted ? 'The model did not respond in time.' : 'Could not reach the model provider.',
        );
      }

      const remaining = Number(response.headers.get('x-ratelimit-remaining-tokens'));
      const resetMs = parseResetHeader(response.headers.get('x-ratelimit-reset-tokens'));
      if (Number.isFinite(remaining) && resetMs !== undefined) {
        scheduler.syncFromProvider(model, remaining, resetMs);
      }

      if (!response.ok) {
        const kind = classifyStatus(response.status);
        const body = await response.text().catch(() => '');

        // The model was asked for a schema it could not satisfy. That is the
        // model failing, not our request being malformed, and saying so points
        // at the real problem.
        if (/json_validate_failed/i.test(body)) {
          throw new LlmError(
            'INVALID_MODEL_RESPONSE',
            `Model "${model}" could not produce output matching the requested schema.`,
            { status: response.status },
          );
        }

        // A model that cannot honour strict structured output at all must fail
        // loudly rather than quietly degrading into an unvalidated free-text
        // call, which would let unchecked content reach a kit.
        if (kind === 'INVALID_REQUEST' && /json_schema|response_format/i.test(body)) {
          throw new LlmError(
            'UNSUPPORTED_CAPABILITY',
            `Model "${model}" rejected strict structured output. Configure a model that supports it.`,
            { status: response.status },
          );
        }

        const retryAfterMs =
          kind === 'RATE_LIMITED'
            ? parseRetryAfter(response.headers.get('retry-after'))
            : undefined;

        throw new LlmError(kind, `The model provider returned ${response.status}.`, {
          status: response.status,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        });
      }

      const body = (await response.json()) as GroqResponse;
      const choice = body.choices?.[0];
      const text = choice?.message?.content ?? '';
      const usage = usageFrom(body, estimated);

      /*
       * The completion ran out of room. Without this the truncated JSON would
       * surface as a parse error, which points at the model's grammar rather
       * than at the budget that cut it off — and the two need opposite fixes.
       */
      if (choice?.finish_reason === 'length') {
        scheduler.settle(model, usage.totalTokens);
        throw new LlmError(
          'INVALID_MODEL_RESPONSE',
          `Model "${model}" ran out of completion budget before finishing its answer.`,
        );
      }

      // Replace the estimate with what was actually charged.
      scheduler.settle(model, usage.totalTokens);

      const latencyMs = Date.now() - startedAt;
      logger.info('llm: call complete', {
        stage: options.stage,
        model,
        latency: `${latencyMs}ms`,
        tokens: usage.totalTokens,
      });

      return { text, usage, latencyMs };
    });
  }

  async function callWithCache(
    model: string,
    messages: LlmMessage[],
    options: GenerateOptions,
    responseFormat?: Record<string, unknown>,
  ): Promise<{ text: string; usage: LlmUsage; latencyMs: number }> {
    const cached = await cache.get('groq', model, messages);
    if (cached !== null) {
      logger.info('llm: cache hit', { stage: options.stage, model });
      return {
        text: cached,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: 0,
      };
    }

    const result = await withRetry(() => callOnce(model, messages, options, responseFormat), {
      onRetry: (attempt, delayMs, error) =>
        logger.warn('llm: retrying', {
          stage: options.stage,
          model,
          attempt,
          delayMs,
          kind: error instanceof LlmError ? error.kind : 'unknown',
        }),
    });

    await cache.set('groq', model, messages, result.text);
    return result;
  }

  return {
    name: 'groq',

    async generateText(messages, options): Promise<LlmTextResult> {
      const model = modelFor(options.tier);
      const result = await callWithCache(model, messages, options);
      return { ...result, model };
    },

    async generateStructured<T>(
      messages: LlmMessage[],
      schema: ZodType<T>,
      schemaName: string,
      options: GenerateOptions,
    ): Promise<LlmStructuredResult<T>> {
      const model = modelFor(options.tier);
      const responseFormat = {
        type: 'json_schema',
        json_schema: toStrictJsonSchema(schema as ZodType<unknown>, schemaName),
      };

      const first = await callWithCache(model, messages, options, responseFormat);
      const firstAttempt = validate(schema, first.text);

      if (firstAttempt.ok) {
        return {
          value: firstAttempt.value,
          usage: first.usage,
          model,
          latencyMs: first.latencyMs,
          repaired: false,
        };
      }

      // Exactly one repair, quoting what was wrong. Anything more spends a
      // constrained budget on a model that has already shown it cannot comply.
      logger.warn('llm: invalid structured response, attempting one repair', {
        stage: options.stage,
        model,
        reason: firstAttempt.reason,
      });

      const repairMessages: LlmMessage[] = [
        ...messages,
        { role: 'assistant', content: first.text },
        {
          role: 'user',
          content: `That response was rejected: ${firstAttempt.reason}\nReturn only corrected JSON matching the schema. No prose, no code fences.`,
        },
      ];

      const second = await callWithCache(model, repairMessages, options, responseFormat);
      const secondAttempt = validate(schema, second.text);

      if (!secondAttempt.ok) {
        throw new LlmError(
          'INVALID_MODEL_RESPONSE',
          `The model did not return data matching the ${schemaName} schema: ${secondAttempt.reason}`,
        );
      }

      const usage: LlmUsage = {
        promptTokens: first.usage.promptTokens + second.usage.promptTokens,
        completionTokens: first.usage.completionTokens + second.usage.completionTokens,
        totalTokens: first.usage.totalTokens + second.usage.totalTokens,
      };

      return {
        value: secondAttempt.value,
        usage,
        model,
        latencyMs: first.latencyMs + second.latencyMs,
        repaired: true,
      };
    },
  };
}

type Validation<T> = { ok: true; value: T } | { ok: false; reason: string };

/** The Zod schema is the authority on shape, never the model's word for it. */
function validate<T>(schema: ZodType<T>, raw: string): Validation<T> {
  const extracted = extractJsonObject(raw);
  if (!extracted.ok) return { ok: false, reason: extracted.reason };

  const parsed = schema.safeParse(extracted.value);
  if (parsed.success) return { ok: true, value: parsed.data };

  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

  return { ok: false, reason: issues };
}

/** Reads provider and model choice from configuration; no model id is hard-coded. */
export function createConfiguredProvider(): LlmProvider {
  if (!env.GROQ_API_KEY) {
    throw new LlmError('PROVIDER_UNAVAILABLE', 'GROQ_API_KEY is not configured.');
  }

  if (env.LLM_PROVIDER !== 'groq') {
    throw new LlmError('PROVIDER_UNAVAILABLE', `Unsupported LLM_PROVIDER "${env.LLM_PROVIDER}".`);
  }

  return createGroqProvider({
    apiKey: env.GROQ_API_KEY,
    primaryModel: env.GROQ_PRIMARY_MODEL,
    fastModel: env.GROQ_FAST_MODEL,
  });
}
