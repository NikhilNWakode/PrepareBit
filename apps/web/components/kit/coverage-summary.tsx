'use client';

import type { Kit } from '@prep/shared';

/**
 * Coverage: the one number the whole pipeline exists to make true.
 *
 * Every must-have requirement should have a question against it. It is a fact
 * to check rather than a dashboard to admire, so it gets a count, a plain
 * sentence, and a list only when something is actually missing.
 *
 * Recomputed by the server on every edit, so it can never describe a kit that
 * no longer exists.
 */
export function CoverageSummary({ kit }: { kit: Kit }) {
  const requirements = kit.role.requirements;
  const uncovered = new Set(kit.coverage.uncovered_requirement_ids);

  const musts = requirements.filter((requirement) => requirement.priority === 'must');
  const covered = musts.filter((requirement) => !uncovered.has(requirement.id)).length;
  const missing = requirements.filter((requirement) => uncovered.has(requirement.id));
  const missingMusts = missing.filter((requirement) => requirement.priority === 'must');

  /*
   * No must-haves at all. "0 / 0" would read as a failure when it is really a
   * statement about the posting: it asked for nothing in mandatory terms, so
   * there is nothing for coverage to be short of.
   */
  if (musts.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Coverage</h3>
        <p className="mt-1.5 max-w-[70ch] text-sm">
          {requirements.length === 0
            ? 'No requirements could be traced to this posting, so there is nothing to cover. The kit is necessarily thin.'
            : 'This posting states no must-have requirements, so there is no coverage bar to clear. Everything it asks for is a nice-to-have.'}
        </p>
      </div>
    );
  }

  const complete = missingMusts.length === 0;

  return (
    <div>
      <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Coverage</h3>

      <p className="mt-1.5 flex items-baseline gap-2">
        <span
          className={`font-mono text-2xl leading-none ${complete ? 'text-ink' : 'text-danger'}`}
        >
          {covered}/{musts.length}
        </span>
        <span className="text-sm text-muted">must-have requirements covered by a question</span>
      </p>

      {complete && missing.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted">No gaps. Every requirement has a question.</p>
      ) : null}

      {complete && missing.length > 0 ? (
        <p className="mt-1.5 max-w-[70ch] text-sm text-muted">
          Every must-have is covered. <span className="font-mono text-xs">{missing.length}</span>{' '}
          nice-to-have
          {missing.length === 1 ? ' has' : 's have'} no question, which is acceptable.
        </p>
      ) : null}

      {!complete ? (
        <div className="mt-2.5">
          <p className="text-sm text-danger">
            <span className="font-mono text-xs">{missingMusts.length}</span> must-have
            {missingMusts.length === 1 ? ' requirement needs' : ' requirements need'} a question.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {missingMusts.map((requirement) => (
              <li key={requirement.id} className="flex max-w-[70ch] gap-2.5 text-[0.8125rem]">
                <span className="shrink-0 font-mono text-xs text-muted">{requirement.id}</span>
                <span>{requirement.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.8125rem] text-muted">
            Write a question against one of these, or point an existing question at it, and this
            updates itself.
          </p>
        </div>
      ) : null}
    </div>
  );
}
