'use client';

import type { Kit } from '@prep/shared';
import { useState } from 'react';

import { BriefSection } from '@/components/kit/brief-section';
import { FlashcardsSection } from '@/components/kit/flashcards-section';
import { KitHeader } from '@/components/kit/kit-header';
import { KitNav, type NavSection } from '@/components/kit/kit-nav';
import { QuestionsSection } from '@/components/kit/questions-section';
import { ResearchSection } from '@/components/kit/research-section';
import { RoleSection } from '@/components/kit/role-section';
import { ScheduleSection } from '@/components/kit/schedule-section';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/section';
import type { StoredKit } from '@/lib/kits';
import { useKitEditor } from '@/lib/use-kit-editor';

/**
 * The kit as a document.
 *
 * Header, section navigation, then five sections separated by space and rules
 * rather than wrapped in panels. A kit is read for half an hour; it should look
 * like something written down, not like a dashboard of widgets.
 *
 * Each section owns its own editing and pending state, so regenerating the
 * brief does not grey out the questions and an error in one place does not
 * blank the page. The editor hook above them holds the single copy of the kit
 * and the version every write is made against.
 */

export function KitView({ stored }: { stored: StoredKit }) {
  const editor = useKitEditor(stored);
  const [regenerationNotes, setRegenerationNotes] = useState<string[]>([]);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const kit = editor.kit.kit;
  if (!kit) return null;

  function recordRegeneration(notes: string[], summary: string): void {
    setRegenerationNotes(notes);
    setLastAction(summary);
  }

  const sections: NavSection[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'research', label: 'Research' },
    { id: 'requirements', label: 'Requirements', count: (kit as Kit).role.requirements.length },
    { id: 'questions', label: 'Questions', count: (kit as Kit).questions.length },
    { id: 'flashcards', label: 'Flashcards', count: (kit as Kit).flashcards.length },
    { id: 'plan', label: 'Study plan', count: (kit as Kit).schedule.days_available },
  ];

  return (
    <div>
      <KitHeader stored={editor.kit} />
      <KitNav sections={sections} />

      <div className="flex flex-col gap-4">
        {/*
          A stale page is not told to go away: the kit on screen is still
          readable, and reloading is offered rather than forced.
        */}
        {editor.stale ? (
          <Panel tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                This kit changed somewhere else since you opened it, so your last change was not
                saved.
              </p>
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                Reload
              </Button>
            </div>
          </Panel>
        ) : null}

        {editor.error && !editor.stale ? (
          <Panel tone="danger">
            <p role="alert" className="text-sm text-danger">
              {editor.error}
            </p>
          </Panel>
        ) : null}

        {/*
          One line, not a banner: the work is visible on the page already. Any
          note the regeneration returned follows it, because "there was no
          company research to draw on" explains a thin result.
        */}
        {lastAction ? (
          <div aria-live="polite" className="flex flex-col gap-1">
            <p className="text-[0.8125rem] text-muted">{lastAction}</p>
            {regenerationNotes
              .filter((note) => note.trim().length > 0)
              .map((note) => (
                <p key={note} className="max-w-[70ch] text-[0.8125rem] text-muted">
                  {note}
                </p>
              ))}
          </div>
        ) : null}
      </div>

      <div className="mt-10 flex flex-col gap-14">
        <BriefSection editor={editor} onNotes={recordRegeneration} />
        <ResearchSection stored={editor.kit} />
        <RoleSection editor={editor} />
        <QuestionsSection editor={editor} onNotes={recordRegeneration} />
        <FlashcardsSection editor={editor} />
        <ScheduleSection editor={editor} />
      </div>
    </div>
  );
}
