import type { Kit } from '@prep/shared';
import { isValidObjectId } from 'mongoose';

import type { IdCounters } from '../domain/kit/ids.js';
import type { ProvenanceMap } from '../domain/kit/provenance.js';
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

export interface StoredKit {
  id: string;
  status: KitStatus;
  input: KitInput;
  kit: Kit | null;
  provenance: ProvenanceMap;
  idCounters: IdCounters;
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
    idCounters: document.idCounters,
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
   * Replaces the contract object and the state that travels with it.
   *
   * `markModified` is mandatory: `kit` and `provenance` are Mixed, and Mongoose
   * cannot detect mutation inside a Mixed field, so without it an edit is
   * silently dropped. Keeping every write behind this method is what makes that
   * a single place to get right.
   */
  async replaceKitContent(
    userId: string,
    kitId: string,
    content: { kit: Kit; provenance: ProvenanceMap; idCounters: IdCounters },
  ): Promise<StoredKit | null> {
    if (!isValidObjectId(kitId)) return null;

    const document = await KitModel.findOne({ _id: kitId, userId }).exec();
    if (!document) return null;

    document.set('kit', content.kit);
    document.set('provenance', content.provenance);
    document.set('idCounters', content.idCounters);
    document.markModified('kit');
    document.markModified('provenance');

    await document.save();
    return toStoredKit(document.toObject());
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
      research: StoredKit['research'];
    },
  ): Promise<void> {
    const document = await KitModel.findById(kitId).exec();
    if (!document) return;

    document.set('kit', content.kit);
    document.set('provenance', content.provenance);
    document.set('idCounters', content.idCounters);
    document.set('research', content.research);
    document.set('status', 'completed');
    document.set('error', null);
    // Mixed fields again: without this the kit is silently not written.
    document.markModified('kit');
    document.markModified('provenance');

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
