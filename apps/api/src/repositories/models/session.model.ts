import { model, Schema, type InferSchemaType } from 'mongoose';

/**
 * Four fields and nothing else. A session is a credential, not a telemetry
 * record, so it carries no user agent, IP or device history.
 *
 * `sessionHash` is SHA-256 of the id held by the client; the raw id is never
 * stored. `expiresAt` carries a TTL index so MongoDB reaps dead sessions
 * without a cleanup job — but see `require-auth`, which checks the timestamp
 * itself rather than trusting the reaper, since the TTL monitor only runs
 * about once a minute.
 */
const sessionSchema = new Schema(
  {
    sessionHash: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type SessionDocument = InferSchemaType<typeof sessionSchema>;

export const SessionModel = model('Session', sessionSchema);
