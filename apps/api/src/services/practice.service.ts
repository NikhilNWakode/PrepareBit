import type { Kit, KitFlashcard } from '@prep/shared';

import { AppError } from '../domain/errors.js';
import { buildBriefing, type Briefing } from '../domain/practice/interview-day.js';
import { orderQueue } from '../domain/practice/order-queue.js';
import {
  confidenceSpread,
  practiceProgress,
  recordRating,
  type Confidence,
  type PracticeProgress,
} from '../domain/practice/practice-state.js';
import { kitRepository } from '../repositories/kit.repository.js';
import { kitService } from './kit.service.js';

/**
 * Practice, and the briefing built from the same data.
 *
 * Both are reads over a kit that already exists plus, in one case, a single
 * targeted write. Neither goes near the generation pipeline and neither calls a
 * model: everything here is composed from what the kit already holds.
 */

export interface PracticeCard extends KitFlashcard {
  /** Null until the card has been rated at least once. */
  confidence: Confidence | null;
  timesReviewed: number;
}

export interface PracticeSession {
  /** In queue order. The client keeps this order for the run. */
  cards: PracticeCard[];
  progress: PracticeProgress;
  spread: Record<Confidence, number>;
}

function requireBuiltKit(stored: { kit: Kit | null; status: string }): Kit {
  if (!stored.kit || stored.status !== 'completed') {
    throw new AppError('CONFLICT', 'This kit is still being built.', 409);
  }
  return stored.kit;
}

export const practiceService = {
  /**
   * The queue for one run.
   *
   * Ordered once, here, and then held by the client for the whole session.
   * Re-sorting after every rating would move a card the user just answered out
   * from under them — the queue is meant to reflect what they knew when they
   * sat down, not to chase each answer.
   */
  async session(userId: string, kitId: string): Promise<PracticeSession> {
    const stored = await kitService.getOwned(userId, kitId);
    const kit = requireBuiltKit(stored);

    const ordered = orderQueue(kit.flashcards, stored.practice);

    return {
      cards: ordered.map((flashcard) => {
        const entry = stored.practice[flashcard.id];
        return {
          ...flashcard,
          confidence: entry?.confidence ?? null,
          timesReviewed: entry?.timesReviewed ?? 0,
        };
      }),
      progress: practiceProgress(kit.flashcards, stored.practice),
      spread: confidenceSpread(kit.flashcards, stored.practice),
    };
  },

  /**
   * Records one rating.
   *
   * The card must belong to this kit — a rating against an id the kit has never
   * heard of would sit in the sidecar forever, counted by nothing and cleaned
   * up by nothing.
   */
  async rate(
    userId: string,
    kitId: string,
    cardId: string,
    confidence: Confidence,
    now: Date = new Date(),
  ): Promise<PracticeProgress> {
    const stored = await kitService.getOwned(userId, kitId);
    const kit = requireBuiltKit(stored);

    if (!kit.flashcards.some((flashcard) => flashcard.id === cardId)) {
      throw new AppError('NOT_FOUND', `This kit has no flashcard "${cardId}".`, 404);
    }

    const next = recordRating(stored.practice, cardId, confidence, now);
    const entry = next[cardId];
    if (!entry) throw new AppError('INTERNAL_ERROR', 'The rating could not be recorded.', 500);

    const written = await kitRepository.recordPractice(userId, kitId, cardId, entry);
    if (!written) throw new AppError('KIT_NOT_FOUND', 'That kit does not exist.', 404);

    return practiceProgress(kit.flashcards, next);
  },

  /** The final briefing: deterministic, from stored data, with no model call. */
  async briefing(userId: string, kitId: string): Promise<{ briefing: Briefing; days: number }> {
    const stored = await kitService.getOwned(userId, kitId);
    const kit = requireBuiltKit(stored);

    return {
      briefing: buildBriefing(kit, stored.context?.digest ?? null),
      days: stored.input.days,
    };
  },
};
