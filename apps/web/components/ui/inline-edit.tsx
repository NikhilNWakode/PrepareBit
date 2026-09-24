'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Edit in place: local state while typing, an explicit save, and keyboard
 * shortcuts people already expect.
 *
 * Deliberately not autosaved on every keystroke. Each save revalidates the
 * whole kit against the contract and produces a new version, so it should be a
 * moment the user chose rather than something that happens while they think.
 *
 * Nothing opens a dialog. A dialog for a one-line edit takes the surrounding
 * text away at exactly the moment it is most needed.
 */

export interface EditableFieldProps {
  label: string;
  value: string;
  /** Multi-line by default; a one-line control for titles and fronts. */
  multiline?: boolean;
  placeholder?: string;
  pending?: boolean;
  onSave: (value: string) => void | Promise<unknown>;
  onCancel: () => void;
}

export function EditableField({
  label,
  value,
  multiline = true,
  placeholder,
  pending = false,
  onSave,
  onCancel,
}: EditableFieldProps) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const dirty = draft !== value;

  // Focus follows the edit, so a keyboard user is already in the field.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function keyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void onSave(draft);
    }
  }

  const shared = {
    value: draft,
    placeholder,
    onKeyDown: keyDown,
    disabled: pending,
    'aria-label': label,
    className:
      'w-full rounded border border-border bg-surface px-2.5 py-2 text-sm leading-relaxed outline-none transition-colors focus:border-accent',
  };

  return (
    <div className="flex flex-col gap-2">
      {multiline ? (
        <textarea
          {...shared}
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <input
          {...shared}
          ref={ref as React.RefObject<HTMLInputElement>}
          className={`${shared.className} h-9 py-0`}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void onSave(draft)} pending={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        {/*
          Says whether there is anything to lose. Cancelling an untouched
          editor is free; cancelling a changed one is not, and the difference
          should not have to be remembered.
        */}
        <span className="text-xs text-muted">
          {dirty ? 'Unsaved changes · ' : ''}Esc to cancel, Ctrl+Enter to save
        </span>
      </div>
    </div>
  );
}

/**
 * The read view with an edit affordance.
 *
 * A real button rather than a click handler on a div, so it is reachable by
 * keyboard and announced as a control — and always present rather than
 * revealed on hover, since a control that only exists on hover does not exist
 * on a touch screen.
 */
export function Editable({
  editing,
  onEdit,
  label,
  children,
  editor,
}: {
  editing: boolean;
  onEdit: () => void;
  label: string;
  children: ReactNode;
  editor: ReactNode;
}) {
  if (editing) return <>{editor}</>;

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">{children}</div>
      <Button variant="ghost" size="sm" onClick={onEdit}>
        Edit<span className="sr-only"> {label}</span>
      </Button>
    </div>
  );
}
