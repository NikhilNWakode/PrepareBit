'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/section';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageTitle } from '@/components/ui/typography';
import { ApiError } from '@/lib/api-client';
import { countdown, formatShortDate, interviewDate } from '@/lib/format';
import { isTerminal, listKits, type KitSummary } from '@/lib/kits';

type LoadState =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; kits: KitSummary[] };

/** Kits still generating are polled from here too, so the list stays live. */
const REFRESH_MS = 5_000;

/**
 * One kit per row, in columns.
 *
 * A list of kits is a table of four facts — who, what role, when the interview
 * is, whether it is ready — so it is laid out as columns that line up rather
 * than as cards that each have to be read separately. The headings sit above
 * on wide screens and are dropped on narrow ones, where the row stacks.
 */
function KitRow({ kit }: { kit: KitSummary }) {
  // Company and role are empty until generation fills them in, so the input URL
  // stands in rather than a blank row.
  const title = kit.company || new URL(kit.company_url).hostname;
  const role = kit.role || 'Working out the role…';
  const interview = interviewDate(kit.createdAt, kit.days);

  return (
    <li>
      <Link
        href={`/kits/${kit.id}`}
        className="grid items-baseline gap-x-4 gap-y-1 border-b border-border px-2 py-3.5 transition-colors hover:bg-subtle sm:grid-cols-[1.2fr_1.5fr_8rem_6rem]"
      >
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="truncate text-sm text-muted">{role}</span>

        <span className="text-[0.8125rem] text-muted">
          <span className="sm:hidden">Interview </span>
          {formatShortDate(interview)}
          <span className="ml-1.5 font-mono text-xs">{kit.days}d</span>
        </span>

        <span className="justify-self-start sm:justify-self-end">
          <StatusBadge status={kit.status} />
        </span>
      </Link>
    </li>
  );
}

export default function DashboardPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(async () => {
    try {
      const { kits } = await listKits();
      setState({ kind: 'ready', kits });
      return kits;
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Could not load your kits.',
      });
      return [];
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;

    const tick = async () => {
      const kits = await load();
      if (!active) return;

      // Only keep polling while something is actually being generated.
      if (kits.some((kit) => !isTerminal(kit.status))) {
        timer = setTimeout(() => void tick(), REFRESH_MS);
      }
    };

    void tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  const next =
    state.kind === 'ready'
      ? state.kits.find((kit) => kit.status === 'completed' || kit.status === 'failed')
      : undefined;

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle>Interview kits</PageTitle>
          {next ? (
            <p className="mt-1 text-sm text-muted">
              {countdown(next.createdAt, next.days)} for{' '}
              {next.company || next.role || 'your next kit'}.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">
              Built from a job description and a company website.
            </p>
          )}
        </div>

        <Link href="/kits/new">
          <Button>New kit</Button>
        </Link>
      </div>

      <div className="mt-8">
        {state.kind === 'loading' ? (
          <p className="text-sm text-muted" role="status">
            Loading your kits…
          </p>
        ) : null}

        {state.kind === 'error' ? (
          <div className="flex max-w-xl flex-col items-start gap-4">
            <Panel tone="danger">
              <p role="alert" className="text-sm text-danger">
                {state.message}
              </p>
            </Panel>
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}

        {state.kind === 'ready' && state.kits.length === 0 ? (
          <div className="max-w-md border-t border-border-strong pt-8">
            <h2 className="text-base font-semibold">No interview kits yet</h2>
            <p className="mt-1.5 text-sm text-muted">
              Paste a job description and the company&apos;s website, and say how many days you have
              before the interview.
            </p>
            <Link href="/kits/new" className="mt-5 inline-block">
              <Button>Create your first kit</Button>
            </Link>
          </div>
        ) : null}

        {state.kind === 'ready' && state.kits.length > 0 ? (
          <div>
            <div className="hidden grid-cols-[1.2fr_1.5fr_8rem_6rem] gap-x-4 border-b border-border-strong px-2 pb-2 text-xs font-medium tracking-wide text-muted uppercase sm:grid">
              <span>Company</span>
              <span>Role</span>
              <span>Interview</span>
              <span className="justify-self-end">Status</span>
            </div>

            <ul>
              {state.kits.map((kit) => (
                <KitRow key={kit.id} kit={kit} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
