import type { ZodType } from 'zod';

/**
 * The boundary between the generation pipeline and whichever model is behind
 * it. Pipeline stages describe *what kind of call* they are making; they never
 * name a model or know that Groq exists, so changing provider is a config edit.
 */

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

/**
 * Which bucket a call should spend from.
 *
 * Not a cosmetic distinction: the free-tier rate limit is applied per model, so
 * routing heavy-context work to one model and the many small calls to another
 * roughly doubles the usable tokens per minute.
 */
export type ModelTier = 'primary' | 'fast';

export interface GenerateOptions {
  /** Named for logging and for the development cache key. */
  stage: string;
  tier?: ModelTier;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmTextResult {
  text: string;
  usage: LlmUsage;
  model: string;
  latencyMs: number;
}

export interface LlmStructuredResult<T> {
  value: T;
  usage: LlmUsage;
  model: string;
  latencyMs: number;
  /** True when a first response failed validation and one repair was made. */
  repaired: boolean;
}

export interface LlmProvider {
  readonly name: string;

  generateText(messages: LlmMessage[], options: GenerateOptions): Promise<LlmTextResult>;

  /**
   * Constrains generation with a strict JSON Schema derived from `schema`, then
   * validates the result against that same Zod schema. The schema is the
   * authority on shape, never the model.
   */
  generateStructured<T>(
    messages: LlmMessage[],
    schema: ZodType<T>,
    schemaName: string,
    options: GenerateOptions,
  ): Promise<LlmStructuredResult<T>>;
}
