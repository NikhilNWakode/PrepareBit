import type { ReactNode } from 'react';

/**
 * The type scale, in one place.
 *
 * Four sizes do the whole product: a page title, a section title, a body, and
 * metadata. Hierarchy comes from these steps and from the space around them,
 * which is why nothing here is heavier than 600 — everything bold is the same
 * as nothing bold.
 */

/** 28px. One per screen. */
export function PageTitle({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h1 className={`text-[1.75rem] font-semibold leading-tight tracking-tight ${className}`}>
      {children}
    </h1>
  );
}

/** 18px. The landmarks a reader scans for. */
export function SectionTitle({
  children,
  as: Tag = 'h2',
  className = '',
}: {
  children: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
}) {
  return (
    <Tag className={`text-lg font-semibold leading-snug tracking-tight ${className}`}>
      {children}
    </Tag>
  );
}

/** 15px. A question, a card front, a requirement — the thing itself. */
export function ItemTitle({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={`text-[0.9375rem] font-medium leading-relaxed ${className}`}>{children}</p>;
}

/** 13px muted. Counts, dates, categories, relationships. */
export function Meta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`text-[0.8125rem] text-muted ${className}`}>{children}</span>;
}

/**
 * Identifiers and counts.
 *
 * Monospace is reserved for things that are literally technical — `r3`, `q17`,
 * a day number, a duration — so that seeing it means something rather than
 * being a texture.
 */
export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`font-mono text-[0.75rem] tracking-tight text-muted ${className}`}>
      {children}
    </span>
  );
}

/**
 * The dot that separates metadata. A single component so the spacing around it
 * never drifts between one list and the next.
 */
export function Dot() {
  return (
    <span aria-hidden="true" className="text-border-strong">
      ·
    </span>
  );
}
