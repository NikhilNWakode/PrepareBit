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
};
