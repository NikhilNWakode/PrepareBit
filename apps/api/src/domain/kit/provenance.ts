/**
 * Generated / edited / pinned state — the hardest state problem in the brief.
 *
 * It is kept as a sidecar map keyed by item id rather than as extra fields on
 * each question, so the Appendix A object stays exactly the shape the assessment
 * expects and the batch entry point can emit it untouched.
 *
 * The rule the whole builder depends on: a regeneration may replace generated,
 * untouched items and nothing else. A question the user wrote or edited, or
 * pinned, survives a regeneration of its category.
 */

export type ItemOrigin = 'generated' | 'user';

export interface ProvenanceEntry {
  origin: ItemOrigin;
  edited: boolean;
  pinned: boolean;
  updatedAt: Date;
}

/** Keyed by the stable item id (`q3`, `f1`, ...). */
export type ProvenanceMap = Record<string, ProvenanceEntry>;

export function generatedEntry(now: Date = new Date()): ProvenanceEntry {
  return { origin: 'generated', edited: false, pinned: false, updatedAt: now };
}

export function userEntry(now: Date = new Date()): ProvenanceEntry {
  return { origin: 'user', edited: false, pinned: false, updatedAt: now };
}

/**
 * The single predicate regeneration consults. An item with no provenance entry
 * is treated as generated and replaceable, so a missing entry can never cause
 * someone's work to be silently preserved *or* silently destroyed beyond what
 * the default already implies.
 */
export function isProtected(entry: ProvenanceEntry | undefined): boolean {
  if (!entry) return false;
  return entry.origin === 'user' || entry.edited || entry.pinned;
}
