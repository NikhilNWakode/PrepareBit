import type { ReactNode } from 'react';

/**
 * Form-level failure. `role="alert"` so it is announced when it appears, which
 * matters for the case a keyboard user cannot see: submit fails and focus has
 * not moved.
 */
export function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {children}
    </p>
  );
}
