import type { ReactNode } from 'react';

/** A plain bordered surface. Hairline border, restrained radius, no shadow. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded border border-border bg-surface ${className}`}>{children}</div>;
}

export function CardHeader({ children }: { children: ReactNode }) {
  return <div className="border-b border-border px-4 py-3">{children}</div>;
}

export function CardBody({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}

/** A section heading inside a workspace column. */
export function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="flex items-baseline gap-2 text-sm font-medium tracking-tight">
      {children}
      {count !== undefined ? <span className="text-xs text-muted">{count}</span> : null}
    </h2>
  );
}
