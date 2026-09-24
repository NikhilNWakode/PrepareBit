'use client';

import type { Kit } from '@prep/shared';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Dot } from '@/components/ui/typography';
import { countdown, formatDate, interviewDate, timeAgo } from '@/lib/format';
import type { StoredKit } from '@/lib/kits';

/**
 * Who this kit is for and how long is left.
 *
 * The three questions someone opening a kit is actually asking — which role is
 * this, how long have I got, and is it finished — answered before anything
 * else on the page. The countdown is derived from the day count the user gave
 * when they created it, so it is the same number the schedule was built from.
 */
export function KitHeader({ stored }: { stored: StoredKit }) {
  const kit = stored.kit as Kit;
  const company = kit.source.company || new URL(stored.input.company_url).hostname;
  const interview = interviewDate(stored.createdAt, stored.input.days);

  return (
    <header className="border-b border-border-strong pb-5">
      <Link
        href="/dashboard"
        className="inline-flex min-h-6 items-center gap-1 text-[0.8125rem] text-muted hover:text-ink"
      >
        <span aria-hidden="true">←</span> All kits
      </Link>

      {/*
        A grid rather than a wrapping flex row: when the two halves wrap, the
        right-hand block would otherwise align itself against its own width and
        sit oddly indented.
      */}
      <div className="mt-3 grid gap-x-6 gap-y-3 md:grid-cols-[1fr_auto] md:items-end">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">
            {kit.role.title || 'Untitled role'}
          </h1>

          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="text-ink">{company}</span>
            {kit.role.seniority ? (
              <>
                <Dot />
                <span>{kit.role.seniority}</span>
              </>
            ) : null}
            {kit.source.location ? (
              <>
                <Dot />
                <span>{kit.source.location}</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-col items-start gap-1 md:items-end">
          <p className="text-sm font-medium">{countdown(stored.createdAt, stored.input.days)}</p>
          <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted">
            <span>{formatDate(interview)}</span>
            <Dot />
            <StatusBadge status={stored.status} />
            <Dot />
            {/* Confirms a save landed even when the change was off-screen. */}
            <span>Updated {timeAgo(stored.updatedAt)}</span>
          </p>

          {/* One quiet way in, not a banner on every section. */}
          <div className="mt-2 flex items-center gap-2">
            <Link href={`/kits/${stored.id}/interview-day`}>
              <Button variant="secondary" size="sm">
                Interview day
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
