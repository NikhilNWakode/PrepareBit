'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/section';
import { ApiError } from '@/lib/api-client';
import {
  getPracticeSession,
  ratePracticeCard,
  CONFIDENCE_LABELS,
  type Confidence,
  type PracticeCard,
  type PracticeSession,
} from '@/lib/kits';

/**
 * Practice: one card at a time.
 *
 * The queue arrives ordered and is then held for the whole run. Re-sorting
 * after every rating would move a card the user had just answered out from
 * under them — the order is meant to reflect what they knew when they sat
 * down. Leaving and coming back builds a fresh queue from the latest ratings,
 * which is where the confidence weighting actually pays off.
 *
 * Deliberately unlike the workspace: narrow, centred, and with almost nothing
 * on screen but the card.
 */

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'running'; session: PracticeSession; index: number; revealed: boolean }
  | { kind: 'done'; reviewed: number; spread: Record<Confidence, number> };

const CONFIDENCE_HINTS: Record<Confidence, string> = {
  1: 'Did not know it',
  2: 'Roughly knew it',
  3: 'Knew it cold',
};

export default function PracticePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const kitId = params.id;

  const [view, setView] = useState<View>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  /** Counts only this run, so the summary reports the session honestly. */
  const runSpread = useRef<Record<Confidence, number>>({ 1: 0, 2: 0, 3: 0 });
  /*
   * A second guard, set synchronously.
   *
   * `saving` is React state, so two keypresses arriving in the same tick both
   * read it as false and both send a rating — which double-counts the card and
   * skips the next one. A ref closes the window the moment the first one
   * starts, before any re-render has to happen.
   */
  const rating = useRef(false);

  const load = useCallback(async () => {
    setView({ kind: 'loading' });
    runSpread.current = { 1: 0, 2: 0, 3: 0 };

    try {
      const session = await getPracticeSession(kitId);
      setView(
        session.cards.length === 0
          ? { kind: 'empty' }
          : { kind: 'running', session, index: 0, revealed: false },
      );
    } catch (error) {
      setView({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Could not load practice.',
      });
    }
  }, [kitId]);

  useEffect(() => {
    void load();
  }, [load]);

  const reveal = useCallback(() => {
    setView((current) =>
      current.kind === 'running' && !current.revealed ? { ...current, revealed: true } : current,
    );
  }, []);

  const rate = useCallback(
    async (confidence: Confidence) => {
      if (view.kind !== 'running' || !view.revealed || saving || rating.current) return;

      const card = view.session.cards[view.index];
      if (!card) return;

      rating.current = true;
      setSaving(true);
      try {
        await ratePracticeCard(kitId, card.id, confidence);
        runSpread.current[confidence] += 1;

        const next = view.index + 1;
        // The queue is not re-sorted mid-run: the next card is simply the next
        // one in the order this session started with.
        setView(
          next >= view.session.cards.length
            ? { kind: 'done', reviewed: view.session.cards.length, spread: runSpread.current }
            : { ...view, index: next, revealed: false },
        );
      } catch (error) {
        setView({
          kind: 'error',
          message: error instanceof ApiError ? error.message : 'Could not save that rating.',
        });
      } finally {
        rating.current = false;
        setSaving(false);
      }
    },
    [view, saving, kitId],
  );

  // Keyboard first: space reveals, 1/2/3 rate, Esc leaves.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      // Never steal a keystroke from something the user is typing into.
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        router.push(`/kits/${kitId}`);
        return;
      }

      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        reveal();
        return;
      }

      if (event.key === '1' || event.key === '2' || event.key === '3') {
        event.preventDefault();
        void rate(Number(event.key) as Confidence);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reveal, rate, router, kitId]);

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between gap-4">
          <Link
            href={`/kits/${kitId}`}
            className="inline-flex min-h-6 items-center gap-1 text-[0.8125rem] text-muted hover:text-ink"
          >
            <span aria-hidden="true">←</span> Back to kit
          </Link>

          {view.kind === 'running' ? (
            <p className="font-mono text-xs text-muted">
              {view.index + 1} / {view.session.cards.length}
            </p>
          ) : null}
        </div>

        {view.kind === 'loading' ? (
          <p className="mt-16 text-center text-sm text-muted" role="status">
            Loading practice…
          </p>
        ) : null}

        {view.kind === 'error' ? (
          <div className="mt-10 flex flex-col items-start gap-4">
            <Panel tone="danger">
              <p role="alert" className="text-sm text-danger">
                {view.message}
              </p>
            </Panel>
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}

        {view.kind === 'empty' ? (
          <div className="mt-16 text-center">
            <h1 className="text-lg font-semibold tracking-tight">Nothing to practise</h1>
            <p className="mt-1.5 text-sm text-muted">
              This kit has no flashcards. Add one from the kit and it will appear here.
            </p>
            <Link href={`/kits/${kitId}`} className="mt-5 inline-block">
              <Button variant="secondary">Back to kit</Button>
            </Link>
          </div>
        ) : null}

        {view.kind === 'running' ? (
          <RunningCard
            card={view.session.cards[view.index] as PracticeCard}
            reviewed={view.session.progress.reviewed}
            total={view.session.progress.total}
            revealed={view.revealed}
            saving={saving}
            onReveal={reveal}
            onRate={(confidence) => void rate(confidence)}
          />
        ) : null}

        {view.kind === 'done' ? (
          <Summary
            kitId={kitId}
            reviewed={view.reviewed}
            spread={view.spread}
            onAgain={() => void load()}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

function RunningCard({
  card,
  reviewed,
  total,
  revealed,
  saving,
  onReveal,
  onRate,
}: {
  card: PracticeCard;
  reviewed: number;
  total: number;
  revealed: boolean;
  saving: boolean;
  onReveal: () => void;
  onRate: (confidence: Confidence) => void;
}) {
  return (
    <div className="mt-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Practice</h1>
        <p className="text-[0.8125rem] text-muted">
          <span className="font-mono">
            {reviewed} / {total}
          </span>{' '}
          reviewed overall
        </p>
      </div>

      <div className="mt-5 rounded-md border border-border bg-surface px-6 py-10 sm:px-10 sm:py-14">
        <p className="text-center text-lg leading-relaxed font-medium text-balance">{card.front}</p>

        {revealed ? (
          <div className="mt-8 border-t border-border pt-6">
            <p className="text-center text-[0.9375rem] leading-relaxed text-muted text-balance">
              {card.back || 'This card has no answer written.'}
            </p>
          </div>
        ) : (
          <div className="mt-8 flex justify-center">
            <Button onClick={onReveal}>Show answer</Button>
          </div>
        )}
      </div>

      {/* Confidence is not offerable before the answer: rating it first would
          be rating a guess. */}
      {revealed ? (
        <div className="mt-6">
          <p className="text-center text-sm text-muted">How confident were you?</p>
          <div className="mt-3 flex justify-center gap-2">
            {([1, 2, 3] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => onRate(level)}
                disabled={saving}
                className="flex min-w-24 flex-col items-center gap-0.5 rounded-md border border-border bg-surface px-4 py-2.5 transition-colors hover:border-border-strong hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-sm font-medium">
                  <span className="font-mono text-xs text-muted">{level}</span>{' '}
                  {CONFIDENCE_LABELS[level]}
                </span>
                <span className="text-xs text-muted">{CONFIDENCE_HINTS[level]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <p className="mt-8 text-center text-xs text-muted">
        {revealed ? '1, 2 or 3 to rate' : 'Space to reveal'} · Esc to leave
      </p>

      {/* Announced so a screen reader follows the run without re-reading the card. */}
      <p aria-live="polite" className="sr-only">
        {revealed ? 'Answer revealed. Rate your confidence from 1 to 3.' : card.front}
      </p>
    </div>
  );
}

function Summary({
  kitId,
  reviewed,
  spread,
  onAgain,
}: {
  kitId: string;
  reviewed: number;
  spread: Record<Confidence, number>;
  onAgain: () => void;
}) {
  return (
    <div className="mt-12">
      <h1 className="text-lg font-semibold tracking-tight">Practice complete</h1>
      <p className="mt-1 text-sm text-muted">
        <span className="font-mono">{reviewed}</span> card{reviewed === 1 ? '' : 's'} reviewed.
      </p>

      <div className="mt-6 border-t border-border-strong pt-4">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Confidence</h2>
        <dl className="mt-3 flex flex-col gap-2">
          {([1, 2, 3] as const).map((level) => (
            <div key={level} className="flex items-baseline gap-3">
              <dt className="w-20 text-sm">{CONFIDENCE_LABELS[level]}</dt>
              <dd className="font-mono text-sm">{spread[level]}</dd>
            </div>
          ))}
        </dl>
      </div>

      {spread[1] > 0 ? (
        <p className="mt-5 max-w-[60ch] text-[0.8125rem] text-muted">
          The {spread[1]} card{spread[1] === 1 ? '' : 's'} you rated low will come first next time.
        </p>
      ) : null}

      <div className="mt-7 flex flex-wrap items-center gap-2">
        <Button onClick={onAgain}>Practice again</Button>
        <Link href={`/kits/${kitId}`}>
          <Button variant="secondary">Back to kit</Button>
        </Link>
      </div>
    </div>
  );
}
