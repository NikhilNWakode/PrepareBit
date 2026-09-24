import { Card, CardBody, CardHeader } from '@/components/ui/card';
import type { KitProgress } from '@/lib/kits';

/**
 * A stepped timeline rather than a spinner.
 *
 * Generation takes about a minute, which is long enough that "Generating…" tells
 * someone nothing and looks indistinguishable from being stuck. The steps come
 * from the pipeline itself, so what is shown is what is genuinely happening —
 * no invented percentage.
 */
const STEPS = [
  'Reading the job description',
  'Researching the company',
  'Summarising what was found',
  'Writing the company brief',
  'Breaking down the role',
  'Writing interview questions',
  'Checking every requirement is covered',
  'Building flashcards',
  'Planning the schedule',
] as const;

type StepState = 'done' | 'active' | 'pending';

function stateFor(index: number, completed: number): StepState {
  if (index < completed) return 'done';
  if (index === completed) return 'active';
  return 'pending';
}

function Marker({ state }: { state: StepState }) {
  if (state === 'done') {
    return (
      <span aria-hidden="true" className="text-accent">
        ✓
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span
        aria-hidden="true"
        className="inline-block size-2 animate-pulse rounded-full bg-accent"
      />
    );
  }
  return (
    <span aria-hidden="true" className="inline-block size-2 rounded-full border border-border" />
  );
}

export function KitProgressView({ progress }: { progress: KitProgress }) {
  const completed = Math.min(progress.completedSteps, STEPS.length);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Building your kit</h2>
          <p className="text-xs text-muted">
            {completed} of {STEPS.length}
          </p>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          This usually takes about a minute. You can leave this page and come back.
        </p>
      </CardHeader>

      <CardBody>
        {/* A list, so a screen reader can read the steps in order. */}
        <ol className="flex flex-col gap-2">
          {STEPS.map((step, index) => {
            const state = stateFor(index, completed);

            return (
              <li
                key={step}
                className={`flex items-center gap-2.5 text-sm ${
                  state === 'pending' ? 'text-muted' : 'text-ink'
                }`}
              >
                <span className="flex w-4 justify-center">
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
      </CardBody>
    </Card>
  );
}
