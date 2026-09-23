'use client';

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
}

/**
 * Label, control, hint and error as one unit, so the `htmlFor` and
 * `aria-describedby` wiring is structural rather than something each form has
 * to remember. `aria-invalid` is what a screen reader announces on failure.
 */
export function Field({ label, error, hint, className = '', ...props }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>

      <input
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        className={`h-9 rounded border bg-surface px-2.5 text-sm outline-none transition-colors placeholder:text-muted/70 ${
          error ? 'border-red-600' : 'border-border hover:border-muted/50'
        } ${className}`}
      />

      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
