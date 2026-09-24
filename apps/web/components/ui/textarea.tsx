'use client';

import { useId, type TextareaHTMLAttributes } from 'react';

interface TextareaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  error?: string | undefined;
  hint?: string;
}

/**
 * The textarea counterpart to `Field`: the same label, hint and error wiring,
 * so accessibility is structural rather than remembered per form.
 */
export function TextareaField({
  label,
  error,
  hint,
  className = '',
  ...props
}: TextareaFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>

      <textarea
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        className={`min-h-48 rounded border bg-surface px-2.5 py-2 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted/70 ${
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
