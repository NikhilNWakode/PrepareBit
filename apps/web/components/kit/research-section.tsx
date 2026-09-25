'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Section, SectionHeader } from '@/components/ui/section';
import type { ResearchDigest, StoredKit } from '@/lib/kits';

/**
 * What the research actually found, shown rather than summarised away.
 *
 * The pipeline already separates what a company builds from what it says about
 * hiring, because a company that publishes its interview process should produce
 * a different kit from one that says nothing. That separation is the evidence
 * behind every company-fit question, so it is worth reading — and worth
 * checking, since it is the part most likely to be thin.
 *
 * Nothing here is generated prose. These are the facts retrieval extracted,
 * with the pages they came from.
 */

interface Group {
  label: string;
  items: string[];
  /** Said out loud when a group is empty, because empty is a real finding. */
  absent: string;
}

function groupsFor(digest: ResearchDigest): Group[] {
  return [
    {
      label: 'Industry and products',
      items: [digest.industry, ...digest.products].filter((item) => item.trim().length > 0),
      absent: 'Nothing published about what they build.',
    },
    {
      label: 'The company',
      items: digest.companyFacts,
      absent: 'Nothing published about the company itself.',
    },
    {
      label: 'Engineering',
      items: digest.engineeringFacts,
      absent: 'Nothing published about how they build.',
    },
    {
      label: 'Hiring',
      items: digest.hiringFacts,
      absent: 'Nothing published about how they hire.',
    },
    {
      label: 'Interview process',
      items: digest.interviewFacts,
      absent: 'No public account of their interview process was found.',
    },
  ];
}

function GroupBlock({ group }: { group: Group }) {
  return (
    <div>
      <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{group.label}</h3>

      {group.items.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {group.items.map((item) => (
            <li key={item} className="flex max-w-[70ch] gap-2.5 text-sm leading-relaxed">
              <span
                aria-hidden="true"
                className="mt-2 size-1 shrink-0 rounded-full bg-border-strong"
              />
              {item}
            </li>
          ))}
        </ul>
      ) : (
        /* An absent fact is a finding, not a blank. */
        <p className="mt-2 text-sm text-muted">{group.absent}</p>
      )}
    </div>
  );
}

/**
 * Turns a retrieval failure into something a candidate can act on.
 *
 * The stored reason is the machine one (`too-large: > 3000000 bytes`), which is
 * right for a log and wrong for a person. Without this, a site that was blocked,
 * one that timed out and one that was merely too big all reach the reader as the
 * same shrug — and only one of those is worth retrying.
 */
function describeFailure(reason: string): string {
  const [kind, detail = ''] = [
    reason.slice(0, reason.indexOf(': ')) || reason,
    reason.slice(reason.indexOf(': ') + 2),
  ];

  switch (kind) {
    case 'too-large':
      return 'the page was larger than this app will download';
    case 'timeout':
      return 'the site did not respond in time';
    case 'network-error':
      return 'the site could not be reached';
    case 'http-error':
      return `the site returned ${detail}`;
    case 'blocked-url':
      return detail === 'private-address'
        ? 'the address is private, so it was not fetched'
        : `the address was not one this app will fetch (${detail})`;
    case 'unsupported-content-type':
      return 'the response was not a web page';
    case 'too-many-redirects':
      return 'the address redirected too many times';
    case 'invalid-url':
      return 'the address could not be read';
    default:
      return reason;
  }
}

export function ResearchSection({ stored }: { stored: StoredKit }) {
  const [expanded, setExpanded] = useState(false);

  const digest = stored.context?.digest;
  const notes = stored.research.notes.filter((note) => note.trim().length > 0);
  const failures = stored.research.pagesFailed;
  const sources = digest?.sources ?? [];

  /*
   * Where this came from, counted rather than claimed. The company's own pages
   * and public discussion are different kinds of evidence — one is what they
   * say about themselves, the other is what candidates said — and a reader
   * weighing a fact deserves to know which it is.
   */
  const pageCount = stored.research.pagesUsed.length || sources.length;
  const searchUsed = stored.research.searchUsed.trim();
  const basis = [
    pageCount > 0 ? `${pageCount} company page${pageCount === 1 ? '' : 's'}` : null,
    searchUsed ? `public discussion via ${searchUsed}` : null,
  ].filter((part): part is string => part !== null);

  const groups = digest ? groupsFor(digest) : [];
  const factCount = groups.reduce((total, group) => total + group.items.length, 0);

  // Nothing was kept for this kit: say so plainly rather than showing an
  // elaborate empty section.
  if (!digest) {
    return (
      <Section id="research">
        <SectionHeader title="Company research" />
        <p className="mt-4 max-w-[70ch] text-sm text-muted">
          This kit was built before its company research was kept, so there is nothing to show here.
          A kit made now records what the crawl found.
        </p>
        {notes.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-1.5">
            {notes.map((note) => (
              <li key={note} className="max-w-[70ch] text-[0.8125rem] leading-relaxed text-muted">
                {note}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
    );
  }

  return (
    <Section id="research">
      <SectionHeader
        title="Company research"
        count={factCount}
        description={
          basis.length > 0
            ? `Based on ${basis.join(' and ')}. Everything below was taken from those sources — nothing is inferred.`
            : 'Nothing could be retrieved for this company, so the kit is built from the job description alone.'
        }
        actions={
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : 'Show all'}
          </Button>
        }
      />

      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        {(expanded ? groups : groups.slice(0, 2)).map((group) => (
          <GroupBlock key={group.label} group={group} />
        ))}
      </div>

      {expanded ? (
        <div className="mt-6 flex flex-col gap-4">
          {notes.length > 0 ? (
            <div>
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
                What could not be found
              </h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {notes.map((note) => (
                  <li
                    key={note}
                    className="max-w-[70ch] text-[0.8125rem] leading-relaxed text-muted"
                  >
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {failures.length > 0 ? (
            <div>
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
                Pages that could not be read
              </h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {failures.map((failure) => (
                  <li
                    key={failure.url}
                    className="max-w-[70ch] text-[0.8125rem] leading-relaxed text-muted"
                  >
                    <span className="font-mono text-xs break-all">{failure.url}</span>
                    {' — '}
                    {describeFailure(failure.reason)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {sources.length > 0 ? (
            <div>
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Pages read</h3>
              <ul className="mt-2 flex flex-col gap-1">
                {sources.map((source) => (
                  <li key={source} className="truncate font-mono text-xs text-muted">
                    {source}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}
