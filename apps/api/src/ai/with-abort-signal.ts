import type { LlmProvider } from './llm-provider.js';

/**
 * Binds an abort signal to every call a provider makes.
 *
 * A per-case deadline has to actually cancel work, not merely stop waiting for
 * it. Racing a promise against a timer leaves the original request in flight,
 * still holding a socket and — worse here — still spending tokens from a shared
 * per-minute budget that the remaining cases need.
 *
 * Done as a decorator so no pipeline stage has to thread a signal through its
 * signature: the stages keep describing what they want, and cancellation is
 * arranged at the edge.
 */
export function withAbortSignal(provider: LlmProvider, signal: AbortSignal): LlmProvider {
  return {
    name: provider.name,

    generateText: (messages, options) => provider.generateText(messages, { ...options, signal }),

    generateStructured: (messages, schema, schemaName, options) =>
      provider.generateStructured(messages, schema, schemaName, { ...options, signal }),
  };
}
