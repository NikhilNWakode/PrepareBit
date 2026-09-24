'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/section';
import { ApiError } from '@/lib/api-client';
import { countdown, formatDate, interviewDate } from '@/lib/format';
import { getBriefing, getKit, type Briefing } from '@/lib/kits';

/**
 * Interview Day: the kit as a final briefing.
 *
 * A candidate can spend a week reading preparation material and still have no
 * way to walk into the room. This is the last five minutes before the call —
 * who they are, what the role asks, what the research actually turned up, and
 * what to ask back.
 *
 * Everything on this page is composed from data the kit already holds. Nothing
 * is fetched from the company, nothing is generated, and where the kit knows
 * nothing, the page says so rather than filling the space.
 */

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; briefing: Briefing; createdAt: string; days: number };

const BASIS_LABELS: Record<string, string> = {
  'role requirements': 'Role requirements',
  'company research': 'Company research',
  'the job description': 'The job description',
};

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-medium tracking-wide text-muted uppercase">{children}</h2>;
}

export default function InterviewDayPage() {
  const params = useParams<{ id: string }>();
  const kitId = params.id;

  const [view, setView] = useState<View>({ kind: 'loading' });

  const load = useCallback(async () => {
    try {
      // The briefing carries the day count; the kit carries when it was made,
      // and the countdown is derived from both — the same arithmetic the rest
      // of the product uses, so the two can never disagree.
      const [{ briefing, days }, { kit }] = await Promise.all([getBriefing(kitId), getKit(kitId)]);

      setView({ kind: 'ready', briefing, createdAt: kit.createdAt, days });
    } catch (error) {
      setView({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Could not load the briefing.',
      });
    }
  }, [kitId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <Link
          href={`/kits/${kitId}`}
          className="inline-flex min-h-6 items-center gap-1 text-[0.8125rem] text-muted hover:text-ink"
        >
          <span aria-hidden="true">←</span> Back to kit
        </Link>

        {view.kind === 'loading' ? (
          <p className="mt-10 text-sm text-muted" role="status">
            Loading the briefing…
          </p>
        ) : null}

        {view.kind === 'error' ? (
          <Panel tone="danger" className="mt-8">
            <p role="alert" className="text-sm text-danger">
              {view.message}
            </p>
          </Panel>
        ) : null}

        {view.kind === 'ready' ? (
          <BriefingView
            kitId={kitId}
            briefing={view.briefing}
            createdAt={view.createdAt}
            days={view.days}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

function BriefingView({
  kitId,
  briefing,
  createdAt,
  days,
}: {
  kitId: string;
  briefing: Briefing;
  createdAt: string;
  days: number;
}) {
  return (
    <div className="mt-4">
      <header className="border-b border-border-strong pb-6">
        <p className="font-mono text-xs tracking-wide text-muted uppercase">Interview day</p>

        <h1 className="mt-2 text-[1.75rem] leading-tight font-semibold tracking-tight">
          {briefing.role || 'Untitled role'}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {[briefing.company, briefing.seniority, briefing.location].filter(Boolean).join(' · ')}
        </p>

        <p className="mt-4 text-sm font-medium">{countdown(createdAt, days)}</p>
        <p className="text-[0.8125rem] text-muted">{formatDate(interviewDate(createdAt, days))}</p>
      </header>

      <div className="mt-8 flex flex-col gap-8">
        <section>
          <Heading>The company</Heading>
          {briefing.researchIsEmpty ? (
            <p className="mt-2 max-w-[70ch] text-sm text-muted">
              Nothing could be retrieved about this company, so there is nothing to brief here.
              Everything below comes from the job description.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {briefing.companyFacts.map((fact) => (
                <li key={fact} className="flex max-w-[70ch] gap-2.5 text-sm leading-relaxed">
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1 shrink-0 rounded-full bg-border-strong"
                  />
                  {fact}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <Heading>What the role asks for</Heading>
          {briefing.keyRequirements.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-2">
              {briefing.keyRequirements.map((requirement) => (
                <li key={requirement.id} className="flex max-w-[70ch] gap-3 text-sm">
                  <span className="mt-0.5 w-6 shrink-0 font-mono text-xs text-muted">
                    {requirement.id}
                  </span>
                  <span className="leading-relaxed">
                    {requirement.text}
                    {requirement.priority === 'must' ? (
                      <span className="ml-2 text-xs font-medium text-accent">must</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">
              No requirements could be traced to this posting.
            </p>
          )}
        </section>

        {briefing.reminders.length > 0 ? (
          <section>
            <Heading>Remember</Heading>
            <ul className="mt-2 flex flex-col gap-1.5">
              {briefing.reminders.map((reminder) => (
                <li key={reminder} className="flex max-w-[70ch] gap-2.5 text-sm leading-relaxed">
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1 shrink-0 rounded-full bg-border-strong"
                  />
                  {reminder}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <Heading>Questions to ask them</Heading>
          <p className="mt-1.5 max-w-[70ch] text-[0.8125rem] text-muted">
            Built from this kit — each one says what it was drawn from.
          </p>

          <ol className="mt-4 flex flex-col gap-4">
            {briefing.questionsToAsk.map((question, index) => (
              <li key={question.id} className="flex gap-3">
                <span className="mt-0.5 w-6 shrink-0 font-mono text-xs text-muted">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <p className="max-w-[70ch] text-[0.9375rem] leading-relaxed">{question.text}</p>
                  <p className="mt-1 text-xs text-muted">
                    Based on {BASIS_LABELS[question.basis]?.toLowerCase() ?? question.basis}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-2 border-t border-border pt-6">
        <Link href={`/kits/${kitId}/practice`}>
          <Button>Start practice</Button>
        </Link>
        <Link href={`/kits/${kitId}`}>
          <Button variant="secondary">Back to kit</Button>
        </Link>
      </div>
    </div>
  );
}
