import { SessionModel } from './models/session.model.js';

export interface StoredSession {
  userId: string;
  expiresAt: Date;
}

export const sessionRepository = {
  async create(sessionHash: string, userId: string, expiresAt: Date): Promise<void> {
    await SessionModel.create({ sessionHash, userId, expiresAt });
  },

  /**
   * Filters on `expiresAt` in the query rather than relying on the TTL index,
   * which only sweeps roughly once a minute and would otherwise leave a window
   * where an expired session still authenticates.
   */
  async findActive(sessionHash: string, now: Date): Promise<StoredSession | null> {
    const found = await SessionModel.findOne({
      sessionHash,
      expiresAt: { $gt: now },
    })
      .lean()
      .exec();

    return found ? { userId: found.userId.toString(), expiresAt: found.expiresAt } : null;
  },

  async deleteByHash(sessionHash: string): Promise<void> {
    await SessionModel.deleteOne({ sessionHash }).exec();
  },
};
