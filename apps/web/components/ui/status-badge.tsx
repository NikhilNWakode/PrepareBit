import type { KitStatus } from '@/lib/kits';

/**
 * Status as a word plus a colour, never colour alone — colour alone is not
 * readable to everyone and not visible in a screen reader.
 */
const LABELS: Record<KitStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  researching: 'Researching',
  generating: 'Generating',
  validating: 'Validating',
  completed: 'Ready',
  failed: 'Failed',
};

const TONES: Record<KitStatus, string> = {
  draft: 'border-border text-muted',
  queued: 'border-border text-muted',
  researching: 'border-accent/40 text-accent',
  generating: 'border-accent/40 text-accent',
  validating: 'border-accent/40 text-accent',
  completed: 'border-accent/40 bg-accent/5 text-accent',
  failed: 'border-red-300 bg-red-50 text-red-700',
};

export function StatusBadge({ status }: { status: KitStatus }) {
  const working = !['completed', 'failed', 'draft'].includes(status);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs ${TONES[status]}`}
    >
      {working ? (
        <span
          aria-hidden="true"
          className="inline-block size-1.5 animate-pulse rounded-full bg-current"
        />
      ) : null}
      {LABELS[status]}
    </span>
  );
}
