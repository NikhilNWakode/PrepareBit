import type { Kit, QuestionCategory } from '@prep/shared';

import { createConfiguredProvider } from '../ai/groq-provider.js';
import type { LlmProvider } from '../ai/llm-provider.js';
import { withAbortSignal } from '../ai/with-abort-signal.js';
import { AppError } from '../domain/errors.js';
import * as edit from '../domain/kit/edit-kit.js';
import { logger } from '../logger.js';
import { emptyDigest, type ResearchDigest } from '../pipeline/research-digest.js';
import { generateCompanyBrief } from '../pipeline/stages/generate-company-brief.js';
import { generateQuestions } from '../pipeline/stages/generate-questions.js';
import type { RoleBreakdown } from '../pipeline/stages/generate-role.js';
import type { StoredKit } from '../repositories/kit.repository.js';
import { kitService } from './kit.service.js';
import { mutate } from './kit-edit.service.js';

/**
 * Regeneration, scoped.
 *
 * The brief is specific: regenerating technical questions must not regenerate
 * the company brief, must not touch the flashcards, and must not destroy the
 * behavioural questions. Each of these calls exactly one stage and rewrites
 * exactly one part of the kit, so the scoping is a property of the code rather
 * than a promise in a comment.
 *
 * Synchronous, unlike generation. Generation is nine stages and about a minute,
 * which is why it returns 202 and is polled; one stage is a few seconds, and
 * putting a state machine around it would be machinery the problem does not
 * have. The deadline below is what keeps that honest.
 */

/**
 * Long enough for one call plus a wait for the per-minute token budget, short
 * enough that a wedged request does not hold a connection open indefinitely.
 */
const REGENERATION_TIMEOUT_MS = 45_000;

export interface RegenerationResult {
  kit: StoredKit;
  /** Surfaced to the user: what the regeneration could and could not draw on. */
  notes: string[];
}

export interface RegenerationOptions {
  /** Injected by tests; production builds one per request. */
  provider?: LlmProvider;
}

/**
 * The role, reconstructed from the kit rather than stored alongside it.
 *
 * Every field of a `RoleBreakdown` is already in the contract object, so there
 * is nothing to persist and nothing that can drift — and a user who corrects
 * the role title gets a regeneration that honours the correction.
 */
function roleFromKit(kit: Kit): RoleBreakdown {
  return {
    title: kit.role.title,
    seniority: kit.role.seniority,
    location: kit.source.location,
    responsibilities: kit.role.responsibilities,
  };
}

/**
 * The digest the original run produced, or an honest empty one.
 *
 * A kit generated before the digest was persisted can still be regenerated; it
 * simply has less to work from, and is told so. Reconstructing facts from the
 * generated brief would be inventing sources, which is the one thing the whole
 * pipeline refuses to do.
 */
function digestFor(stored: StoredKit, kit: Kit): { digest: ResearchDigest; notes: string[] } {
  const stashed = stored.context?.digest;
  if (stashed) return { digest: stashed, notes: [] };

  return {
    digest: { ...emptyDigest(), sources: kit.source.pages_used },
    notes: [
      'This kit was built before its company research was kept, so the regeneration had none to draw on.',
    ],
  };
}

async function withDeadline<T>(
  options: RegenerationOptions,
  run: (provider: LlmProvider) => Promise<T>,
): Promise<T> {
  const provider = options.provider ?? createConfiguredProvider();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGENERATION_TIMEOUT_MS);

  try {
    return await run(withAbortSignal(provider, controller.signal));
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AppError(
        'GENERATION_FAILED',
        'Regenerating took too long and was stopped. Nothing was changed — try again.',
        504,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const regenerationService = {
  /** What would be kept and what would be replaced, so the user can be asked first. */
  async planQuestions(
    userId: string,
    kitId: string,
    category: QuestionCategory,
  ): Promise<edit.CategoryRegenerationPlan> {
    const stored = await kitService.getOwned(userId, kitId);
    if (!stored.kit) {
      throw new AppError('CONFLICT', 'This kit is still being built.', 409);
    }

    return edit.planCategoryRegeneration(
      { kit: stored.kit, provenance: stored.provenance, counters: stored.idCounters },
      category,
    );
  },

  /**
   * Rewrites one question category, keeping everything the user has a claim on.
   *
   * The model call happens inside the transform, so the complete new state is
   * assembled in memory and validated before a single write is issued. A model
   * that fails, times out or returns nothing leaves the stored kit exactly as
   * it was.
   */
  async questions(
    userId: string,
    kitId: string,
    version: Date,
    category: QuestionCategory,
    options: RegenerationOptions = {},
  ): Promise<RegenerationResult> {
    const stored = await kitService.getOwned(userId, kitId);
    if (!stored.kit) throw new AppError('CONFLICT', 'This kit is still being built.', 409);

    const { digest, notes } = digestFor(stored, stored.kit);
    const role = roleFromKit(stored.kit);
    const collected = [...notes];

    const kit = await mutate(userId, kitId, version, async (state) => {
      const result = await withDeadline(options, (provider) =>
        generateQuestions(
          category,
          state.kit.role.requirements,
          digest,
          role,
          provider,
          state.counters,
        ),
      );

      // Nothing came back. Emptying the category to replace it with nothing
      // would be a destructive answer to a request to improve it, so the kit is
      // left alone and the user is told why.
      if (result.questions.length === 0) {
        throw new AppError(
          'LLM_INVALID_RESPONSE',
          `No new ${category} questions could be written, so the existing ones were kept. ${result.notes.join(' ')}`.trim(),
          422,
        );
      }

      collected.push(...result.notes);

      return edit.applyRegeneratedQuestions(
        state,
        category,
        result.questions,
        result.counters,
        new Date(),
      );
    });

    logger.info('regeneration: questions', { kitId, category });
    return { kit, notes: collected };
  },

  /**
   * Rewrites the company brief and nothing else.
   *
   * This one does overwrite an edited brief, and the interface says so before
   * asking. The preservation rule protects items from being caught up in a
   * regeneration aimed at their neighbours; it does not override an instruction
   * pointed directly at the thing itself.
   */
  async brief(
    userId: string,
    kitId: string,
    version: Date,
    options: RegenerationOptions = {},
  ): Promise<RegenerationResult> {
    const stored = await kitService.getOwned(userId, kitId);
    if (!stored.kit) throw new AppError('CONFLICT', 'This kit is still being built.', 409);

    const { digest, notes } = digestFor(stored, stored.kit);

    const kit = await mutate(userId, kitId, version, async (state) => {
      const result = await withDeadline(options, (provider) =>
        generateCompanyBrief(digest, provider),
      );

      // `sources` stays what research actually reached; the model never adds to it.
      return edit.replaceCompanyBrief(
        state,
        { ...result.brief, sources: digest.sources },
        new Date(),
      );
    });

    logger.info('regeneration: brief', { kitId });
    return { kit, notes };
  },
};
