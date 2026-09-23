import { model, Schema } from 'mongoose';

/**
 * The lifecycle of a generation run. Persisted so a refresh does not lose
 * progress and a user can reopen a kit later; `draft` and `queued` exist ahead
 * of the pipeline that drives them in Phase 6.
 */
export const KIT_STATUSES = [
  'draft',
  'queued',
  'researching',
  'generating',
  'validating',
  'completed',
  'failed',
] as const;

export type KitStatus = (typeof KIT_STATUSES)[number];

const kitSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    /** sha256 of the normalised input; used to spot a duplicate submission. */
    fingerprint: { type: String, required: true },

    status: { type: String, enum: KIT_STATUSES, required: true, default: 'draft' },

    progress: {
      step: { type: String, default: '' },
      completedSteps: { type: Number, default: 0 },
      totalSteps: { type: Number, default: 0 },
    },

    input: {
      jd: { type: String, required: true },
      company_url: { type: String, required: true },
      days: { type: Number, required: true },
    },

    /**
     * The Appendix A object, stored as Mixed.
     *
     * Mirroring the contract in a Mongoose sub-schema would write it down a
     * second time and invite the two copies to drift — and the contract is the
     * thing being graded. Zod owns it (see packages/shared/src/kit.schema.ts);
     * Mongo just holds the document.
     *
     * The cost: Mongoose cannot see mutations inside a Mixed field, so writes
     * must go through the repository, which calls markModified. There is a test
     * for exactly that trap.
     */
    kit: { type: Schema.Types.Mixed, default: null },

    /** Generated/edited/pinned state, keyed by item id. Outside the contract object. */
    provenance: { type: Schema.Types.Mixed, default: () => ({}) },

    /**
     * Monotonic id counters, also outside the contract object. Never decremented
     * on delete, so an id is never reissued.
     */
    idCounters: {
      requirement: { type: Number, default: 0 },
      question: { type: Number, default: 0 },
      flashcard: { type: Number, default: 0 },
    },

    /** What retrieval managed and failed to reach, reported honestly rather than hidden. */
    research: {
      pagesUsed: { type: [String], default: [] },
      pagesFailed: {
        type: [{ _id: false, url: String, reason: String }],
        default: [],
      },
      searchUsed: { type: String, default: '' },
      notes: { type: [String], default: [] },
    },

    error: {
      type: { code: String, message: String },
      default: null,
    },
  },
  { timestamps: true },
);

// The dashboard list: a user's kits, newest first.
kitSchema.index({ userId: 1, createdAt: -1 });
// The duplicate-submission check in Phase 6.
kitSchema.index({ userId: 1, fingerprint: 1 });

export const KitModel = model('Kit', kitSchema);
