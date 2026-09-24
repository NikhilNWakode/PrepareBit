import type { Kit } from '@prep/shared';
import { isValidObjectId } from 'mongoose';

import type { IdCounters } from '../domain/kit/ids.js';
import type { Confidence, PracticeMap } from '../domain/practice/practice-state.js';
import type { ProvenanceMap } from '../domain/kit/provenance.js';
import type { ResearchDigest } from '../pipeline/research-digest.js';
import { KitModel, type KitStatus } from './models/kit.model.js';

/**
 * Every method takes the owner's id and scopes its query by it. There is
 * deliberately no unscoped `findById`, so there is no call site at which
 * ownership can be forgotten: the data layer's shape enforces it rather than a
 * check someone has to remember to write.
 */

export interface KitInput {
  jd: string;
  company_url: string;
  days: number;
}

/** Kept for regeneration; absent on kits generated before it was recorded. */
export interface KitContext {
  digest: ResearchDigest;
}

export interface StoredKit {
  id: string;
  status: KitStatus;
  input: KitInput;
  kit: Kit | null;
  provenance: ProvenanceMap;
  practice: PracticeMap;
  idCounters: IdCounters;
  context: KitContext | null;
  research: {
    pagesUsed: string[];
    pagesFailed: { url: string; reason: string }[];
    searchUsed: string;
    notes: string[];
  };
  progress: { step: string; completedSteps: number; totalSteps: number };
  error: { code: string; message: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A refused write says which of the two things went wrong, because the caller
 * owes the user different answers: a kit that is not theirs is a 404, and a kit
 * that moved on under them is a 409 they can recover from by reloading.
 */
export type ReplaceResult =
  { ok: true; kit: StoredKit } | { ok: false; reason: 'not-found' | 'stale' };

/** The list view needs headline facts, not a whole kit body. */
export interface KitSummary {
  id: string;
  status: KitStatus;
  company: string;
  role: string;
  company_url: string;
  days: number;
  createdAt: Date;
  updatedAt: Date;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- lean() returns a loosely typed document; the shape is pinned by StoredKit below.
function toStoredKit(document: any): StoredKit {
  return {
    id: document._id.toString(),
    status: document.status,
    input: document.input,
    kit: document.kit ?? null,
    provenance: document.provenance ?? {},
    practice: document.practice ?? {},
    idCounters: document.idCounters,
    context: document.context ?? null,
    research: document.research,
    progress: document.progress,
    error: document.error ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export const kitRepository = {
  async create(userId: string, input: KitInput, fingerprint: string): Promise<StoredKit> {
    const created = await KitModel.create({ userId, input, fingerprint, status: 'draft' });
    return toStoredKit(created.toObject());
  },

  async listByOwner(userId: string): Promise<KitSummary[]> {
    const documents = await KitModel.find({ userId })
      .sort({ createdAt: -1 })
      .select('status input kit.source.company kit.source.role createdAt updatedAt')
      .lean()
      .exec();

    return documents.map((document) => ({
      id: document._id.toString(),
      status: document.status as KitStatus,
      // Absent until generation fills it in; never invented.
      company: document.kit?.source?.company ?? '',
      role: document.kit?.source?.role ?? '',
      // `input` is required by the schema and is in the projection above; the
      // fallbacks exist because a projected lean document is typed as partial.
      company_url: document.input?.company_url ?? '',
      days: document.input?.days ?? 0,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }));
  },

  async findOwned(userId: string, kitId: string): Promise<StoredKit | null> {
    // A malformed id is a miss, not a CastError bubbling up as a 500.
    if (!isValidObjectId(kitId)) return null;

    const document = await KitModel.findOne({ _id: kitId, userId }).lean().exec();
    return document ? toStoredKit(document) : null;
  },

  /**
   * Replaces the contract object and the state that travels with it, but only
   * if the caller was working from the version it says it was.
   *
   * `updatedAt` is the version. Putting it in the filter makes the whole thing
   * one atomic compare-and-set: two tabs editing the same kit cannot silently
   * overwrite each other, because the second write matches nothing and is
   * reported as stale instead of quietly winning.
   *
   * Whole fields are `$set` rather than mutated on a loaded document, so the
   * `markModified` trap that Mixed fields carry does not apply here.
   */
  async replaceKitContent(
    userId: string,
    kitId: string,
    expectedVersion: Date,
    content: { kit: Kit; provenance: ProvenanceMap; idCounters: IdCounters },
  ): Promise<ReplaceResult> {
    if (!isValidObjectId(kitId)) return { ok: false, reason: 'not-found' };
    if (Number.isNaN(expectedVersion.getTime())) return { ok: false, reason: 'stale' };

    const updated = await KitModel.findOneAndUpdate(
      { _id: kitId, userId, updatedAt: expectedVersion },
      {
        $set: {
          kit: content.kit,
          provenance: content.provenance,
          idCounters: content.idCounters,
        },
      },
      { returnDocument: 'after' },
    )
      .lean()
      .exec();

    if (updated) return { ok: true, kit: toStoredKit(updated) };

    // Nothing matched: either the kit is not the caller's, or it moved on.
    const exists = await KitModel.exists({ _id: kitId, userId }).exec();
    return { ok: false, reason: exists ? 'stale' : 'not-found' };
  },

  /**
   * Records one practice rating, and deliberately almost nothing else.
   *
   * Every other write in this repository goes through `replaceKitContent`,
   * which revalidates the whole contract object against a version. A rating
   * does neither, on purpose:
   *
   *  - it does not change the kit, so revalidating the entire Appendix A
   *    object to store one number would be work with no question to answer;
   *  - it carries no version, because a rating cannot conflict with an edit —
   *    they touch different fields;
   *  - `timestamps: false` keeps `updatedAt` where it was, which is the point.
   *    Bumping it would invalidate the version an editor is holding in another
   *    tab, and the builder would start refusing saves because the user had
   *    been practising. A false conflict is worse than no conflict detection.
   *
   * One key, set atomically.
   */
  async recordPractice(
    userId: string,
    kitId: string,
    cardId: string,
    entry: { confidence: Confidence; reviewedAt: Date; timesReviewed: number },
  ): Promise<boolean> {
    if (!isValidObjectId(kitId)) return false;

    const result = await KitModel.updateOne(
      { _id: kitId, userId },
      { $set: { [`practice.${cardId}`]: entry } },
      { timestamps: false },
    ).exec();

    return result.matchedCount > 0;
  },

  /**
   * Backs the duplicate-submission rule. The `(userId, fingerprint)` index from
   * Phase 3 exists for exactly this lookup.
   */
  async findByFingerprint(userId: string, fingerprint: string): Promise<StoredKit | null> {
    const document = await KitModel.findOne({ userId, fingerprint })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return document ? toStoredKit(document) : null;
  },

  /**
   * Written by the generation runner as the pipeline advances. Not owner-scoped
   * because the runner already holds a kit it created for a known owner, and
   * there is no request in scope to derive a user from.
   *
   * **It will not move a kit out of a terminal state.** Progress writes are
   * fire-and-forget, so the last one can land after the run has already
   * finished; without this filter that late write would drag a completed kit
   * back to `validating`, where the interface would poll it forever. Making it
   * a condition of the query means the ordering cannot matter.
   */
  async updateProgress(
    kitId: string,
    status: KitStatus,
    progress: { step: string; completedSteps: number; totalSteps: number },
  ): Promise<void> {
    await KitModel.updateOne(
      { _id: kitId, status: { $nin: ['completed', 'failed'] } },
      { $set: { status, progress } },
    ).exec();
  },

  /**
   * Deliberately reopens a finished kit, which `updateProgress` refuses to do.
   * Used when a failed kit is retried, so the guard above cannot make a failed
   * input permanently unusable.
   */
  async reopenForRetry(kitId: string): Promise<void> {
    await KitModel.updateOne(
      { _id: kitId },
      {
        $set: {
          status: 'queued',
          error: null,
          progress: { step: 'Queued', completedSteps: 0, totalSteps: 9 },
        },
      },
    ).exec();
  },

  async completeKit(
    kitId: string,
    content: {
      kit: Kit;
      provenance: ProvenanceMap;
      idCounters: IdCounters;
      context: KitContext;
      research: StoredKit['research'];
    },
  ): Promise<void> {
    const document = await KitModel.findById(kitId).exec();
    if (!document) return;

    document.set('kit', content.kit);
    document.set('provenance', content.provenance);
    document.set('idCounters', content.idCounters);
    document.set('context', content.context);
    document.set('research', content.research);
    document.set('status', 'completed');
    document.set('error', null);
    // Mixed fields again: without this the kit is silently not written.
    document.markModified('kit');
    document.markModified('provenance');
    document.markModified('context');

    await document.save();
  },

  async failKit(kitId: string, error: { code: string; message: string }): Promise<void> {
    await KitModel.updateOne({ _id: kitId }, { $set: { status: 'failed', error } }).exec();
  },

  /**
   * Kits left mid-generation by a process that died.
   *
   * The in-process runner cannot survive a restart, so without this a kit sits
   * in `researching` forever and the UI polls it forever. Marking them failed is
   * honest and lets the user retry.
   */
  async failStaleGenerations(olderThan: Date): Promise<number> {
    const result = await KitModel.updateMany(
      {
        status: { $in: ['queued', 'researching', 'generating', 'validating'] },
        updatedAt: { $lt: olderThan },
      },
      {
        $set: {
          status: 'failed',
          error: {
            code: 'GENERATION_FAILED',
            message: 'Generation was interrupted before it finished. Try again.',
          },
        },
      },
    ).exec();

    return result.modifiedCount;
  },
};
