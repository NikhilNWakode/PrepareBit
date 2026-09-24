'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { KitProgressView } from '@/components/kit-progress';
import { KitView } from '@/components/kit-view';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/section';
import { ApiError } from '@/lib/api-client';
import {
  createKit,
  getKit,
  getKitProgress,
  isTerminal,
  type KitProgress,
  type StoredKit,
} from '@/lib/kits';

/**
 * Polling that backs off and then stops.
 *
 * Generation takes about a minute, so the first checks are frequent and the
 * interval grows. It stops on a terminal status and the timer is cleared on
 * unmount, so a forgotten tab cannot sit hammering the API forever.
 */
const FIRST_INTERVAL_MS = 1_500;
const MAX_INTERVAL_MS = 8_000;
const BACKOFF = 1.4;

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'working'; progress: KitProgress; kit: StoredKit | null }
  | { kind: 'ready'; kit: StoredKit };

/** A back link for the states that have no kit header of their own yet. */
function BackLink() {
  return (
    <Link
      href="/dashboard"
      className="inline-flex min-h-6 items-center gap-1 text-[0.8125rem] text-muted hover:text-ink"
    >
      <span aria-hidden="true">←</span> All kits
    </Link>
  );
}

export default function KitPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const kitId = params.id;
  const reused = searchParams.get('reused') === '1';

  const [view, setView] = useState<View>({ kind: 'loading' });
  const [retrying, setRetrying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadFullKit = useCallback(async () => {
    try {
      const { kit } = await getKit(kitId);
      setView({ kind: 'ready', kit });
    } catch (error) {
      setView({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Could not load this kit.',
      });
    }
  }, [kitId]);

  useEffect(() => {
    let active = true;
    let interval = FIRST_INTERVAL_MS;
    let stored: StoredKit | null = null;

    const poll = async () => {
      try {
        const progress = await getKitProgress(kitId);
        if (!active) return;

        // Fetched once so the progress screen can show elapsed time from when
        // the kit was actually created, not from when this tab opened.
        if (!stored) {
          stored = (await getKit(kitId)).kit;
          if (!active) return;
        }

        if (isTerminal(progress.status)) {
          if (progress.status === 'failed') {
            setView({ kind: 'working', progress, kit: stored });
          } else {
            await loadFullKit();
          }
          return;
        }

        setView({ kind: 'working', progress, kit: stored });

        interval = Math.min(interval * BACKOFF, MAX_INTERVAL_MS);
        timer.current = setTimeout(() => void poll(), interval);
      } catch (error) {
        if (!active) return;
        setView({
          kind: 'error',
          message: error instanceof ApiError ? error.message : 'Could not load this kit.',
        });
      }
    };

    void poll();

    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [kitId, loadFullKit, retrying]);

  async function retry() {
    if (view.kind !== 'working' || retrying) return;

    setRetrying(true);
    try {
      const { kit } = await getKit(kitId);
      await createKit({
        jd: kit.input.jd,
        company_url: kit.input.company_url,
        days: kit.input.days,
      });
      // Flipping this restarts the polling effect.
      setView({ kind: 'loading' });
    } catch (error) {
      setView({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Could not retry this kit.',
      });
    } finally {
      setRetrying(false);
    }
  }

  const failed = view.kind === 'working' && view.progress.status === 'failed';

  return (
    <AppShell>
      {view.kind === 'loading' ? (
        <div>
          <BackLink />
          <p className="mt-6 text-sm text-muted" role="status">
            Loading this kit…
          </p>
        </div>
      ) : null}

      {view.kind === 'error' ? (
        <div>
          <BackLink />
          <div className="mt-6 flex max-w-xl flex-col items-start gap-4">
            <Panel tone="danger">
              <p role="alert" className="text-sm text-danger">
                {view.message}
              </p>
            </Panel>
            <Link href="/dashboard">
              <Button variant="secondary">Back to your kits</Button>
            </Link>
          </div>
        </div>
      ) : null}

      {failed && view.kind === 'working' ? (
        <div>
          <BackLink />
          <div className="mt-6 max-w-xl">
            <h1 className="text-[1.75rem] font-semibold tracking-tight">
              This kit could not be built
            </h1>
            {/* The message the pipeline recorded — never a stack trace. */}
            <p className="mt-2 text-sm text-muted">
              {view.progress.error?.message ?? 'Something went wrong while generating this kit.'}
            </p>
            <div className="mt-5">
              <Button onClick={() => void retry()} pending={retrying}>
                {retrying ? 'Retrying…' : 'Try again'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {view.kind === 'working' && !failed ? (
        <div>
          <BackLink />
          <div className="mt-6">
            <KitProgressView
              progress={view.progress}
              startedAt={view.kit?.createdAt ?? new Date().toISOString()}
            />
          </div>
        </div>
      ) : null}

      {view.kind === 'ready' ? (
        <>
          {reused ? (
            <Panel className="mb-6">
              <p className="text-sm">
                You have already made a kit for this posting, so this is the existing one rather
                than a new copy.
              </p>
            </Panel>
          ) : null}
          <KitView stored={view.kit} />
        </>
      ) : null}
    </AppShell>
  );
}
