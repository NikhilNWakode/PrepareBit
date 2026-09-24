'use client';

import { useEffect, useState } from 'react';

import type { KitProgress } from '@/lib/kits';

/**
 * A stepped list, not a spinner.
 *
 * Generation takes about a minute, which is long enough that "Generating…"
 * tells someone nothing and looks indistinguishable from being stuck. The
 * steps come from the pipeline itself, so what is shown is what is genuinely
 * happening — no invented percentage, no progress bar that fills at a rate
 * unrelated to the work.
 */
const STEPS = [
  'Read the job description',
  'Research the company',
  'Summarise what was found',
  'Write the company brief',
  'Break down the role',
  'Write interview questions',
  'Check every requirement is covered',
  'Build flashcards',
  'Plan the schedule',
] as const;

type StepState = 'done' | 'active' | 'pending';

function stateFor(index: number, completed: number): StepState {
  if (index < completed) return 'done';
  if (index === completed) return 'active';
  return 'pending';
}

/** Elapsed time, so a slow run is visibly slow rather than ambiguous. */
function useElapsed(startedAt: string): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => setSeconds(Math.max(0, Math.round((Date.now() - start) / 1000)));

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return seconds;
}

function Marker({ state }: { state: StepState }) {
  if (state === 'done') {
    return (
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        className="text-accent"
      >
        <path d="M2.5 6.5L5 9L9.5 3.5" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (state === 'active') {
    return (
      <span
        aria-hidden="true"
        className="inline-block size-1.5 animate-pulse rounded-full bg-accent"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="inline-block size-1.5 rounded-full border border-border-strong"
    />
  );
}

export function KitProgressView({
  progress,
  startedAt,
}: {
  progress: KitProgress;
  /** When the kit was created, so elapsed time survives a refresh. */
  startedAt: string;
}) {
  const completed = Math.min(progress.completedSteps, STEPS.length);
  const elapsed = useElapsed(startedAt);
  const elapsedLabel =
    elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  return (
    <div className="max-w-xl">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-strong pb-2.5">
        <h2 className="text-lg font-semibold tracking-tight">Building your kit</h2>
        <p className="font-mono text-xs text-muted">
          {completed}/{STEPS.length} · {elapsedLabel}
        </p>
      </div>

      <p className="mt-2.5 text-sm text-muted">
        This usually takes about a minute. You can leave this page and come back.
      </p>

      {/* A list, so a screen reader reads the steps in order. */}
      <ol className="mt-5 flex flex-col gap-2.5">
        {STEPS.map((step, index) => {
          const state = stateFor(index, completed);

          return (
            <li
              key={step}
              className={`flex items-center gap-3 text-sm ${
                state === 'pending' ? 'text-muted' : 'text-ink'
              }`}
            >
              <span className="flex w-3 justify-center">
                <Marker state={state} />
              </span>
              <span>{step}</span>
              {state === 'active' ? <span className="sr-only">in progress</span> : null}
              {state === 'done' ? <span className="sr-only">done</span> : null}
            </li>
          );
        })}
      </ol>

      {/* One live region, so progress is announced without re-reading the list. */}
      <p aria-live="polite" className="sr-only">
        {progress.step ? `${progress.step}. Step ${completed} of ${STEPS.length}.` : 'Starting.'}
      </p>
    </div>
  );
}
