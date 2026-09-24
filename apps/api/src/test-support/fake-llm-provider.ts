import type { ZodType } from 'zod';

import type {
  GenerateOptions,
  LlmMessage,
  LlmProvider,
  LlmStructuredResult,
  LlmTextResult,
} from '../ai/llm-provider.js';

/**
 * A provider that returns whatever a test tells it to, and records what it was
 * asked.
 *
 * Stages are tested against this rather than against Groq: what matters here is
 * that each stage sends the right context with the right instructions and
 * handles the result correctly, none of which needs a network — and a live
 * model could not be made to return a specific shape on demand anyway. The real
 * provider has its own suite.
 */

export interface RecordedCall {
  messages: LlmMessage[];
  schemaName: string;
  options: GenerateOptions;
  /** Everything sent, for asserting on what a prompt did and did not include. */
  prompt: string;
}

export interface FakeLlmProvider extends LlmProvider {
  readonly calls: RecordedCall[];
  /** The single prompt for a stage that made exactly one call. */
  lastPrompt(): string;
}

/**
 * May return a promise, so a test can make a stage genuinely slow and observe
 * how the pipeline interleaves it with work that does not depend on it.
 */
type Responder = (call: RecordedCall) => unknown | Promise<unknown>;

export function createFakeProvider(responses: unknown[] | Responder): FakeLlmProvider {
  const calls: RecordedCall[] = [];
  const queue = Array.isArray(responses) ? [...responses] : null;

  function nextValue(call: RecordedCall): unknown | Promise<unknown> {
    if (queue) {
      if (queue.length === 0) {
        throw new Error(`Fake provider ran out of responses at call ${calls.length}`);
      }
      return queue.shift();
    }
    return (responses as Responder)(call);
  }

  function record(
    messages: LlmMessage[],
    schemaName: string,
    options: GenerateOptions,
  ): RecordedCall {
    const call: RecordedCall = {
      messages,
      schemaName,
      options,
      prompt: messages.map((message) => message.content).join('\n'),
    };
    calls.push(call);
    return call;
  }

  const usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };

  return {
    name: 'fake',
    calls,

    lastPrompt(): string {
      const last = calls.at(-1);
      if (!last) throw new Error('The fake provider was never called');
      return last.prompt;
    },

    async generateText(messages, options): Promise<LlmTextResult> {
      const call = record(messages, 'text', options);
      return {
        text: String(await nextValue(call)),
        usage,
        model: 'fake-model',
        latencyMs: 1,
      };
    },

    async generateStructured<T>(
      messages: LlmMessage[],
      schema: ZodType<T>,
      schemaName: string,
      options: GenerateOptions,
    ): Promise<LlmStructuredResult<T>> {
      const call = record(messages, schemaName, options);
      const value = await nextValue(call);

      // Validated here too, so a test fixture that does not match the stage's
      // schema fails loudly instead of silently flowing through.
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new Error(
          `Fake response for "${schemaName}" does not match its schema: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
        );
      }

      return {
        value: parsed.data,
        usage,
        model: 'fake-model',
        latencyMs: 1,
        repaired: false,
      };
    },
  };
}
