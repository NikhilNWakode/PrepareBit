import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { env } from '../config/env.js';
import type { LlmMessage } from './llm-provider.js';

/**
 * A development-only cache of model responses, on disk.
 *
 * The free tier allows 200K tokens per model per day, which is roughly eight
 * full five-case batch runs. Iterating on the interface in later phases would
 * otherwise spend that allowance re-asking identical questions.
 *
 * Enabled only by LLM_CACHE=true, and never in production.
 *
 * The key covers provider, model and messages. It deliberately does not include
 * the API key: a credential has no business in a cache filename.
 */
const CACHE_DIR = '.llm-cache';

function keyFor(provider: string, model: string, messages: readonly LlmMessage[]): string {
  return createHash('sha256').update(JSON.stringify({ provider, model, messages })).digest('hex');
}

export interface ResponseCache {
  readonly enabled: boolean;
  get(provider: string, model: string, messages: readonly LlmMessage[]): Promise<string | null>;
  set(
    provider: string,
    model: string,
    messages: readonly LlmMessage[],
    response: string,
  ): Promise<void>;
}

export function createResponseCache(enabled = env.llmCache && !env.isProduction): ResponseCache {
  return {
    enabled,

    async get(provider, model, messages) {
      if (!enabled) return null;

      try {
        return await readFile(join(CACHE_DIR, `${keyFor(provider, model, messages)}.txt`), 'utf8');
      } catch {
        // A miss and an unreadable file are the same thing: call the model.
        return null;
      }
    },

    async set(provider, model, messages, response) {
      if (!enabled) return;

      try {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(
          join(CACHE_DIR, `${keyFor(provider, model, messages)}.txt`),
          response,
          'utf8',
        );
      } catch {
        // A cache that cannot be written is not a reason to fail a generation.
      }
    },
  };
}
