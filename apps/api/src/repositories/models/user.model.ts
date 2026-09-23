import { model, Schema, type InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    /**
     * `select: false` keeps the hash out of every query that does not ask for
     * it by name, so it cannot reach a response through a careless `findById`.
     */
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type UserDocument = InferSchemaType<typeof userSchema>;

export const UserModel = model('User', userSchema);
