'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { ApiError } from '@/lib/api-client';
import { isTerminal, listKits, type KitSummary } from '@/lib/kits';

type LoadState =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; kits: KitSummary[] };

/** Kits still generating are polled from here too, so the list stays live. */
const REFRESH_MS = 5_000;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function KitRow({ kit }: { kit: KitSummary }) {
  // Company and role are empty until generation fills them in, so the input URL
  // stands in rather than a blank row.
  const title = kit.company || new URL(kit.company_url).hostname;
  const subtitle = kit.role || 'Working out the role…';

  return (
    <li>
      <Link
        href={`/kits/${kit.id}`}
        className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-canvas"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-muted">{subtitle}</span>
        </span>

        <span className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-muted">
            {kit.days} day{kit.days === 1 ? '' : 's'}
          </span>
          <span className="hidden text-xs text-muted sm:inline">{formatDate(kit.createdAt)}</span>
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

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight">Your kits</h1>
          <p className="mt-0.5 text-sm text-muted">
            Interview preparation built from a job description and a company website.
          </p>
        </div>

        <Link href="/kits/new">
          <Button>New kit</Button>
        </Link>
      </div>

      <div className="mt-6">
        {state.kind === 'loading' ? (
          <p className="text-sm text-muted" role="status">
            Loading your kits…
          </p>
        ) : null}

        {state.kind === 'error' ? (
          <div className="flex flex-col items-start gap-3">
            <Alert>{state.message}</Alert>
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}

        {state.kind === 'ready' && state.kits.length === 0 ? (
          <Card className="px-6 py-12 text-center">
            <h2 className="text-sm font-medium">No interview kits yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
              Paste a job description and the company&apos;s website, and say how many days you have
              before the interview.
            </p>
            <Link href="/kits/new" className="mt-5 inline-block">
              <Button>Create your first kit</Button>
            </Link>
          </Card>
        ) : null}

        {state.kind === 'ready' && state.kits.length > 0 ? (
          <Card>
            <ul>
              {state.kits.map((kit) => (
                <KitRow key={kit.id} kit={kit} />
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
