import type { KitStatus } from '@/lib/kits';

/**
 * Status as a word, with a small mark beside it.
 *
 * Deliberately not a filled colour pill: a kit list is mostly kits that are
 * ready, and forty green pills say less than one that is quietly marked. Only
 * failure takes a colour, because only failure needs to be found by eye.
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
  draft: 'text-muted',
  queued: 'text-muted',
  researching: 'text-accent',
  generating: 'text-accent',
  validating: 'text-accent',
  completed: 'text-ink',
  failed: 'text-danger',
};

const MARKS: Record<KitStatus, string> = {
  draft: 'bg-border-strong',
  queued: 'bg-border-strong',
  researching: 'bg-accent',
  generating: 'bg-accent',
  validating: 'bg-accent',
  completed: 'bg-accent',
  failed: 'bg-danger',
};

export function StatusBadge({ status }: { status: KitStatus }) {
  const working = !['completed', 'failed', 'draft'].includes(status);

  return (
    <span className={`inline-flex items-center gap-1.5 text-[0.8125rem] ${TONES[status]}`}>
      <span
        aria-hidden="true"
        className={`inline-block size-1.5 rounded-full ${MARKS[status]} ${
          working ? 'animate-pulse' : ''
        }`}
      />
      {LABELS[status]}
    </span>
  );
}
