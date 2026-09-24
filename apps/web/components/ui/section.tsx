import type { ReactNode } from 'react';

import { Meta, SectionTitle } from '@/components/ui/typography';

/**
 * A document section, not a card.
 *
 * The kit is something a person reads for half an hour, so it is built like a
 * document: headings, a rule beneath them, and generous space between one
 * concept and the next. Wrapping each part in a bordered panel would add seven
 * boxes and no information.
 */
export function Section({
  id,
  children,
  className = '',
}: {
  /** Anchors the section navigation. */
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-20 ${className}`}>
      {children}
    </section>
  );
}

export function SectionHeader({
  title,
  count,
  description,
  actions,
}: {
  title: string;
  /** Shown beside the title in mono: how many of the thing there are. */
  count?: number;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="border-b border-border-strong pb-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2">
          <SectionTitle>{title}</SectionTitle>
          {count === undefined ? null : (
            <span className="font-mono text-xs text-muted">{count}</span>
          )}
        </div>

        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>

      {description ? <Meta className="mt-1 block max-w-2xl">{description}</Meta> : null}
    </div>
  );
}

/** A heading inside a section — the four question categories use this. */
export function SubsectionHeader({
  title,
  count,
  id,
  actions,
}: {
  title: string;
  count?: number;
  id?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      id={id}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-2"
    >
      <div className="flex items-baseline gap-2">
        <h3 className="text-[0.9375rem] font-semibold tracking-tight">{title}</h3>
        {count === undefined ? null : <span className="font-mono text-xs text-muted">{count}</span>}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * A quiet panel for something that needs to be set apart from the prose around
 * it: an empty state, a notice, a form. Used sparingly and never nested.
 */
export function Panel({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'danger';
  className?: string;
}) {
  const tones = {
    neutral: 'border-border bg-subtle',
    accent: 'border-accent/25 bg-accent/[0.04]',
    danger: 'border-danger/30 bg-danger/[0.04]',
  } as const;

  return (
    <div className={`rounded-md border px-4 py-3 ${tones[tone]} ${className}`}>{children}</div>
  );
}
