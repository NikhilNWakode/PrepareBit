'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { KitProgressView } from '@/components/kit-progress';
import { KitView } from '@/components/kit-view';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
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
  | { kind: 'working'; progress: KitProgress }
  | { kind: 'ready'; kit: StoredKit };

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

    const poll = async () => {
      try {
        const progress = await getKitProgress(kitId);
        if (!active) return;

        if (isTerminal(progress.status)) {
          // Terminal: fetch the whole kit once and stop polling entirely.
          if (progress.status === 'failed') {
            setView({ kind: 'working', progress });
          } else {
            await loadFullKit();
          }
          return;
        }

        setView({ kind: 'working', progress });

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard" className="text-xs text-muted hover:text-ink">
          ← Back to your kits
        </Link>

        {view.kind === 'ready' ? <StatusBadge status={view.kit.status} /> : null}
        {view.kind === 'working' ? <StatusBadge status={view.progress.status} /> : null}
      </div>

      {reused && view.kind === 'ready' ? (
        <Card className="mt-4 border-accent/30 bg-accent/5">
          <CardBody>
            <p className="text-sm">
              You have already made a kit for this posting, so this is the existing one rather than
              a new copy.
            </p>
          </CardBody>
        </Card>
      ) : null}

      <div className="mt-4">
        {view.kind === 'loading' ? (
          <p className="text-sm text-muted" role="status">
            Loading this kit…
          </p>
        ) : null}

        {view.kind === 'error' ? (
          <div className="flex flex-col items-start gap-3">
            <Alert>{view.message}</Alert>
            <Link href="/dashboard">
              <Button variant="secondary">Back to your kits</Button>
            </Link>
          </div>
        ) : null}

        {failed && view.kind === 'working' ? (
          <Card className="border-red-200">
            <CardBody className="flex flex-col items-start gap-3">
              <div>
                <h2 className="text-sm font-medium text-red-800">This kit could not be built</h2>
                {/* The message the pipeline recorded — never a stack trace. */}
                <p className="mt-1 text-sm text-muted">
                  {view.progress.error?.message ??
                    'Something went wrong while generating this kit.'}
                </p>
              </div>
              <Button onClick={() => void retry()} pending={retrying}>
                {retrying ? 'Retrying…' : 'Try again'}
              </Button>
            </CardBody>
          </Card>
        ) : null}

        {view.kind === 'working' && !failed ? <KitProgressView progress={view.progress} /> : null}

        {view.kind === 'ready' ? <KitView stored={view.kit} /> : null}
      </div>
    </AppShell>
  );
}
