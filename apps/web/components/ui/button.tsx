import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * One button, four intents, two sizes.
 *
 * Before this existed as a real hierarchy the interface had three idioms —
 * this component, and two different hand-rolled `<button className="rounded
 * border …">` strings copied between files. Every control now says how
 * important it is through its variant, which is what stops a page of twelve
 * equally-weighted buttons.
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Renders the button busy and non-interactive without changing its width. */
  pending?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'border border-accent bg-accent text-white hover:bg-accent/90 disabled:bg-accent/40 disabled:border-transparent',
  secondary:
    'border border-border bg-surface text-ink hover:border-border-strong hover:bg-subtle disabled:text-muted disabled:hover:bg-surface',
  // For row-level actions, which should be legible without competing with the
  // content they act on.
  ghost:
    'border border-transparent text-muted hover:border-border hover:bg-subtle hover:text-ink disabled:hover:border-transparent disabled:hover:bg-transparent',
  danger: 'border border-danger/40 bg-surface text-danger hover:bg-danger/5',
};

/** `sm` stays at 28px, comfortably above the 24px minimum touch target. */
const SIZES: Record<Size, string> = {
  sm: 'h-7 gap-1 px-2 text-xs',
  md: 'h-9 gap-1.5 px-3.5 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  pending = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled === true || pending}
      aria-busy={pending || undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A square icon-only control, for the two actions that repeat on every row and
 * would otherwise spend a lot of horizontal space saying "Move up".
 *
 * The label is required and rendered for screen readers, so an icon button is
 * never a nameless control.
 */
export function IconButton({
  label,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      {...props}
      type="button"
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-transparent text-muted transition-colors hover:border-border hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-transparent disabled:hover:bg-transparent ${className}`}
    >
      <span aria-hidden="true">{children}</span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
