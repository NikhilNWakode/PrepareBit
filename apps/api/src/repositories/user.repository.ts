import { UserModel } from './models/user.model.js';

/**
 * MongoDB's duplicate-key error. The `existsByEmail` check ahead of an insert
 * handles the ordinary case; this catches the race where two registrations for
 * the same address pass that check at the same moment. The unique index is the
 * real guarantee, so the error it raises has to be translated rather than
 * escaping as a 500.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export interface StoredUser {
  id: string;
  email: string;
}

interface StoredUserWithHash extends StoredUser {
  passwordHash: string;
}

export const userRepository = {
  async create(email: string, passwordHash: string): Promise<StoredUser> {
    const created = await UserModel.create({ email, passwordHash });
    return { id: created.id as string, email: created.email };
  },

  async findById(id: string): Promise<StoredUser | null> {
    const found = await UserModel.findById(id).lean().exec();
    return found ? { id: found._id.toString(), email: found.email } : null;
  },

  /** The only path that pulls the hash, since the field is `select: false`. */
  async findByEmailWithHash(email: string): Promise<StoredUserWithHash | null> {
    const found = await UserModel.findOne({ email }).select('+passwordHash').lean().exec();
    if (!found) return null;
    return {
      id: found._id.toString(),
      email: found.email,
      passwordHash: found.passwordHash,
    };
  },

  async existsByEmail(email: string): Promise<boolean> {
    return (await UserModel.exists({ email })) !== null;
  },
};
