import { AppError } from '../domain/errors.js';
import { fingerprintKitInput } from '../domain/kit/fingerprint.js';
import { logger } from '../logger.js';
import { isDuplicateKeyError } from '../repositories/user.repository.js';
import {
  kitRepository,
  type KitInput,
  type KitSummary,
  type StoredKit,
} from '../repositories/kit.repository.js';
import { startGeneration, type StartGenerationOptions } from './generation-runner.js';

/**
 * A kit that is missing and a kit that belongs to someone else are the same
 * answer on purpose. A 403 would confirm the id exists, which hands an attacker
 * a way to enumerate other people's kits; a 404 tells them nothing.
 */
function notFound(): AppError {
  return new AppError('KIT_NOT_FOUND', 'That kit does not exist.', 404);
}

/** Generation is already running or finished for this fingerprint. */
function isAlreadyRunning(kit: StoredKit): boolean {
  return kit.status !== 'failed';
}

export interface CreateKitResult {
  kit: StoredKit;
  /** True when an existing kit was returned rather than a new one created. */
  reused: boolean;
}

export const kitService = {
  list(userId: string): Promise<KitSummary[]> {
    return kitRepository.listByOwner(userId);
  },

  async getOwned(userId: string, kitId: string): Promise<StoredKit> {
    const kit = await kitRepository.findOwned(userId, kitId);
    if (!kit) throw notFound();
    return kit;
  },

  /**
   * Creates a kit and starts generating it, or hands back the one that already
   * exists for this input.
   *
   * The brief lists "the same description and company are submitted twice" as a
   * case to handle. Two things make that safe:
   *
   *  - a read first, which covers the ordinary case cheaply;
   *  - the unique (userId, fingerprint) index, which covers the race the read
   *    cannot. Two simultaneous requests can both see nothing and both try to
   *    insert; the database picks a winner and the loser returns that kit
   *    instead of starting a second minute-long generation.
   *
   * `days` is part of the fingerprint, so the same posting for a different
   * number of days is genuinely a different kit.
   */
  async create(
    userId: string,
    input: KitInput,
    options: StartGenerationOptions = {},
  ): Promise<CreateKitResult> {
    const fingerprint = fingerprintKitInput(input.jd, input.company_url, input.days);

    const existing = await kitRepository.findByFingerprint(userId, fingerprint);
    if (existing && isAlreadyRunning(existing)) {
      logger.info('kit: reusing an existing kit for the same input', { kitId: existing.id });
      return { kit: existing, reused: true };
    }

    // A previous attempt failed: retry it rather than refusing, since the
    // unique index would otherwise make the input permanently unusable.
    if (existing) {
      await kitRepository.reopenForRetry(existing.id);
      startGeneration(existing.id, input, options);
      return { kit: existing, reused: false };
    }

    let created: StoredKit;
    try {
      created = await kitRepository.create(userId, input, fingerprint);
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;

      // Lost the race. The winner is already generating, so return it and
      // start nothing.
      const winner = await kitRepository.findByFingerprint(userId, fingerprint);
      if (!winner) throw error;

      logger.info('kit: lost a create race, returning the existing kit', { kitId: winner.id });
      return { kit: winner, reused: true };
    }

    await kitRepository.reopenForRetry(created.id);

    // Deliberately not awaited: the request returns 202 while this runs.
    startGeneration(created.id, input, options);

    return { kit: created, reused: false };
  },
};
