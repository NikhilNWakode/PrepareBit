import { AppError } from '../domain/errors.js';
import { kitRepository, type KitSummary, type StoredKit } from '../repositories/kit.repository.js';

/**
 * A kit that is missing and a kit that belongs to someone else are the same
 * answer on purpose. A 403 would confirm the id exists, which hands an attacker
 * a way to enumerate other people's kits; a 404 tells them nothing.
 */
function notFound(): AppError {
  return new AppError('KIT_NOT_FOUND', 'That kit does not exist.', 404);
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
};
