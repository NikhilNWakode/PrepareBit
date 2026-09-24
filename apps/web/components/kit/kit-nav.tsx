'use client';

import { useEffect, useState } from 'react';

/**
 * Section navigation for a document that runs to several screens.
 *
 * A finished kit is long — a company brief, a dozen requirements, thirty
 * questions, ten flashcards and a schedule. Without this the only way back to
 * the study plan is to scroll, which is the difference between a tool and a
 * wall of output.
 *
 * It carries the counts as well as the names, so the bar answers "how much of
 * each is there" without needing a separate row of statistics.
 */

export interface NavSection {
  id: string;
  label: string;
  count?: number;
}

export function KitNav({ sections }: { sections: NavSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? '');

  useEffect(() => {
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => element !== null);

    if (elements.length === 0) return;

    // The section whose heading most recently crossed the top of the viewport
    // is the one being read. The bottom margin keeps a short final section
    // from never becoming active.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -65% 0px', threshold: 0 },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav
      aria-label="Kit sections"
      className="sticky top-0 z-10 -mx-4 mb-8 border-b border-border bg-canvas/85 px-4 backdrop-blur"
    >
      <ul className="-mb-px flex items-center gap-1 overflow-x-auto">
        {sections.map((section) => {
          const current = active === section.id;

          return (
            <li key={section.id} className="shrink-0">
              <a
                href={`#${section.id}`}
                aria-current={current ? 'true' : undefined}
                className={`inline-flex items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[0.8125rem] transition-colors ${
                  current
                    ? 'border-accent text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {section.label}
                {section.count === undefined ? null : (
                  <span className="font-mono text-[0.6875rem] text-muted">{section.count}</span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
