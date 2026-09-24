import { ERROR_CODES, kitSchema, type ErrorCode, type Kit } from '@prep/shared';
import { z } from 'zod';

/**
 * Appendix B: the exact shape the batch command reads and writes.
 *
 * Contractual, like Appendix A — the assessment runs this command over job
 * descriptions we never see and reads the file it produces, so the field names
 * and the `ok`/`failed` vocabulary are not open to improvement.
 *
 * It lives here rather than in `packages/shared` because only the API uses it;
 * the bar for that package is being genuinely needed by both sides.
 */

/**
 * One case. Validated per case rather than across the array, so a single
 * malformed entry becomes one `failed` result instead of rejecting the file and
 * losing the other four.
 */
export const batchCaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string(),
  company_url: z.string().min(1),
  days: z.number().int().positive(),
});

export type BatchCase = z.infer<typeof batchCaseSchema>;

/**
 * Array-level only. Whether the file is a JSON array at all is a usage error —
 * there is nothing to run and nothing to report per case.
 */
export const batchInputShapeSchema = z.array(z.unknown());

/**
 * A case with no usable id still needs one in the output, since every input
 * case gets exactly one entry. Derived from position so it is stable across
 * runs and points at the offending entry.
 */
export function fallbackCaseId(index: number): string {
  return `input-index-${index}`;
}

const batchErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
});

/**
 * `ok` must carry a kit and no error; `failed` must carry an error and no kit.
 * Enforced rather than assumed, so a malformed entry cannot reach the file.
 */
const batchEntrySchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(['ok', 'failed']),
    kit: z.union([kitSchema, z.null()]),
    error: z.union([batchErrorSchema, z.null()]),
  })
  .superRefine((entry, ctx) => {
    if (entry.status === 'ok' && entry.kit === null) {
      ctx.addIssue({ code: 'custom', message: `Case "${entry.id}" is ok but has no kit.` });
    }
    if (entry.status === 'failed' && entry.kit !== null) {
      ctx.addIssue({ code: 'custom', message: `Case "${entry.id}" failed but carries a kit.` });
    }
    if (entry.status === 'failed' && entry.error === null) {
      ctx.addIssue({ code: 'custom', message: `Case "${entry.id}" failed but has no error.` });
    }
  });

export const batchOutputSchema = z.object({
  version: z.literal('1.0'),
  generated_at: z.string(),
  kits: z.array(batchEntrySchema),
});

export type BatchOutput = z.infer<typeof batchOutputSchema>;
export type BatchEntry = BatchOutput['kits'][number];

export const BATCH_OUTPUT_VERSION = '1.0';

/**
 * Appendix B's own example is `2026-09-01T09:12:44Z` — no milliseconds.
 * Matching it exactly costs nothing and avoids relying on a lenient reader.
 */
export function batchTimestamp(at: Date): string {
  return `${at.toISOString().split('.')[0]}Z`;
}

export function okEntry(id: string, kit: Kit): BatchEntry {
  return { id, status: 'ok', kit, error: null };
}

export function failedEntry(id: string, code: ErrorCode, message: string): BatchEntry {
  return { id, status: 'failed', kit: null, error: { code, message } };
}
