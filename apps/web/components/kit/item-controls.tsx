'use client';

import { ChevronDown, ChevronUp, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';

import { Button, IconButton } from '@/components/ui/button';
import type { ProvenanceEntry } from '@/lib/kits';
import { protectionOf } from '@/lib/kits';

/**
 * The controls that repeat on every editable row.
 *
 * Reordering is Move up / Move down rather than drag and drop. Dragging would
 * need a dependency and a keyboard fallback to be usable at all; two buttons
 * are operable by keyboard and on a phone by construction, and the move is
 * announced rather than only seen.
 *
 * Icons carry the actions that repeat on every row and would otherwise spend a
 * lot of horizontal space; the words stay on the actions that are rarer or
 * consequential, where being unmistakable matters more than being compact.
 */

const PROTECTION_LABELS = {
  yours: { text: 'yours', title: 'You wrote this, so regenerating cannot replace it' },
  edited: { text: 'edited', title: 'You edited this, so regenerating cannot replace it' },
  pinned: { text: 'pinned', title: 'Pinned, so regenerating cannot replace it' },
} as const;

/**
 * Provenance, said quietly.
 *
 * It matters — it is the promise that regeneration will not take your work —
 * but on a page of thirty questions it is a footnote, not a headline. So it is
 * a small muted word. Only `pinned` carries any weight, because that is the one
 * state the user set deliberately and may want to find again.
 */
export function ProvenanceBadge({ entry }: { entry: ProvenanceEntry | undefined }) {
  const protection = protectionOf(entry);
  if (!protection) return null;

  const label = PROTECTION_LABELS[protection];
  const pinned = protection === 'pinned';

  return (
    <span
      title={label.title}
      className={`inline-flex shrink-0 items-center gap-1 text-xs ${
        pinned ? 'font-medium text-accent' : 'text-muted'
      }`}
    >
      {pinned ? <Pin aria-hidden="true" className="size-3" /> : null}
      {label.text}
    </span>
  );
}

export function MoveControls({
  index,
  total,
  label,
  disabled,
  onMove,
}: {
  index: number;
  total: number;
  /** Named in the button so "Move up" is not the only thing announced. */
  label: string;
  disabled: boolean;
  onMove: (to: number) => void;
}) {
  return (
    <div className="flex items-center">
      <IconButton
        onClick={() => onMove(index - 1)}
        disabled={disabled || index === 0}
        label={`Move ${label} up, currently ${index + 1} of ${total}`}
      >
        <ChevronUp className="size-4" />
      </IconButton>
      <IconButton
        onClick={() => onMove(index + 1)}
        disabled={disabled || index === total - 1}
        label={`Move ${label} down, currently ${index + 1} of ${total}`}
      >
        <ChevronDown className="size-4" />
      </IconButton>
    </div>
  );
}

/** Editing is frequent and unambiguous, so it earns an icon-only control. */
export function EditButton({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <IconButton onClick={onClick} disabled={disabled} label={`Edit ${label}`}>
      <Pencil className="size-3.5" />
    </IconButton>
  );
}

export function PinButton({
  pinned,
  disabled,
  label,
  onToggle,
}: {
  pinned: boolean;
  disabled: boolean;
  label: string;
  onToggle: (next: boolean) => void;
}) {
  return (
    <IconButton
      onClick={() => onToggle(!pinned)}
      disabled={disabled}
      aria-pressed={pinned}
      label={pinned ? `Unpin ${label}` : `Pin ${label}, so regenerating cannot replace it`}
      className={pinned ? 'border-border text-accent hover:text-accent' : ''}
    >
      {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
    </IconButton>
  );
}

/**
 * Deleting asks first, in place rather than in a modal: a confirmation that
 * appears where the action was taken is harder to dismiss by reflex, and it
 * does not move the page out from under the person reading it.
 *
 * Destructive styling appears only on the confirm — the control that opens the
 * question is not itself dangerous.
 */
export function DeleteButton({
  confirming,
  disabled,
  label,
  onAsk,
  onCancel,
  onConfirm,
}: {
  confirming: boolean;
  disabled: boolean;
  label: string;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!confirming) {
    return (
      <IconButton onClick={onAsk} disabled={disabled} label={`Delete ${label}`}>
        <Trash2 className="size-3.5" />
      </IconButton>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs text-muted">Delete?</span>
      <Button variant="danger" size="sm" onClick={onConfirm} disabled={disabled}>
        Yes<span className="sr-only">, delete {label}</span>
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel} disabled={disabled}>
        No<span className="sr-only">, keep {label}</span>
      </Button>
    </span>
  );
}
