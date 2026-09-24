'use client';

import type { Kit } from '@prep/shared';
import { useState } from 'react';

import { CoverageSummary } from '@/components/kit/coverage-summary';
import { ProvenanceBadge } from '@/components/kit/item-controls';
import { Button } from '@/components/ui/button';
import { Editable, EditableField } from '@/components/ui/inline-edit';
import { Panel, Section, SectionHeader } from '@/components/ui/section';
import { duration } from '@/lib/format';
import { editBrief, regenerateBrief } from '@/lib/kits';
import type { KitEditor } from '@/lib/use-kit-editor';

const BRIEF_KEY = 'company_brief';

/**
 * The answer to "what do I need to know about this interview?".
 *
 * Coverage first, because it is the one thing that can be wrong; then the size
 * of the kit; then what the company is. Everything here is either counted or
 * taken from the posting — none of it is a metric invented to fill a panel.
 */
function Summary({ kit }: { kit: Kit }) {
  const totalMinutes = kit.schedule.days.reduce((sum, day) => sum + day.minutes, 0);

  const facts = [
    { label: 'Requirements', value: String(kit.role.requirements.length) },
    { label: 'Questions', value: String(kit.questions.length) },
    { label: 'Flashcards', value: String(kit.flashcards.length) },
    {
      label: 'Study plan',
      value: `${kit.schedule.days_available} ${kit.schedule.days_available === 1 ? 'day' : 'days'}`,
      note: duration(totalMinutes),
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">{fact.label}</dt>
          <dd className="mt-1 font-mono text-2xl leading-none">{fact.value}</dd>
          {fact.note ? <dd className="mt-1 text-xs text-muted">{fact.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/**
 * Regenerating the brief does overwrite an edit, and says so first. The
 * preservation rule stops an edit being caught up in a regeneration aimed at
 * its neighbours; it does not override an instruction pointed at the thing
 * itself.
 */
export function BriefSection({
  editor,
  onNotes,
}: {
  editor: KitEditor;
  onNotes: (notes: string[], summary: string) => void;
}) {
  const kit = editor.kit.kit as Kit;
  const entry = editor.kit.provenance[BRIEF_KEY];

  const [editing, setEditing] = useState<'summary' | 'what_they_do' | null>(null);
  const [confirming, setConfirming] = useState(false);

  const pending = editor.isBusy(BRIEF_KEY);

  // Retrieval found nothing at all — distinct from finding little.
  const empty =
    kit.company_brief.what_they_do.trim().length === 0 && kit.company_brief.sources.length === 0;

  async function save(field: 'summary' | 'what_they_do', value: string): Promise<void> {
    const saved = await editor.run(BRIEF_KEY, (version) =>
      editBrief(editor.kit.id, version, { [field]: value }),
    );
    if (saved) setEditing(null);
  }

  async function regenerate(): Promise<void> {
    const result = await editor.run(BRIEF_KEY, (version) =>
      regenerateBrief(editor.kit.id, version),
    );
    setConfirming(false);
    if (result) {
      onNotes(result.notes, 'Company brief rewritten from the research already gathered.');
    }
  }

  return (
    <Section id="overview">
      <SectionHeader title="Overview" />

      <div className="mt-6 flex flex-col gap-8">
        <Summary kit={kit} />

        <CoverageSummary kit={kit} />

        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
                Company brief
              </h3>
              <ProvenanceBadge entry={entry} />
            </div>

            {confirming ? null : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(true)}
                disabled={editor.busy !== null}
              >
                Regenerate
              </Button>
            )}
          </div>

          {confirming ? (
            <Panel className="mt-3">
              <p className="text-sm font-medium">Regenerate the company brief</p>
              <p className="mt-1 max-w-[70ch] text-[0.8125rem] text-muted">
                {entry?.edited
                  ? 'This replaces the wording you wrote. Nothing else in the kit changes.'
                  : 'This rewrites the brief from the research already gathered. Nothing else in the kit changes.'}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" onClick={() => void regenerate()} pending={pending}>
                  {pending ? 'Rewriting…' : 'Regenerate'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
              </div>
            </Panel>
          ) : null}

          {/*
            Nothing was retrieved. An intentional empty state, rather than two
            greyed-out paragraphs apologising in place — and the way out of it
            is the action that might fix it.
          */}
          {empty && !confirming ? (
            <div className="mt-3 max-w-[60ch]">
              <p className="text-sm">No company information was retrieved.</p>
              <p className="mt-1 text-[0.8125rem] text-muted">
                The site could not be reached, or it publishes nothing about itself. The rest of the
                kit is built from the job description alone.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => setConfirming(true)}
                disabled={editor.busy !== null}
              >
                Regenerate brief
              </Button>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-5">
              <div>
                <p className="text-xs font-medium tracking-wide text-muted uppercase">
                  What they do
                </p>
                <Editable
                  editing={editing === 'what_they_do'}
                  onEdit={() => setEditing('what_they_do')}
                  label="what they do"
                  editor={
                    <EditableField
                      label="What they do"
                      value={kit.company_brief.what_they_do}
                      pending={pending}
                      onSave={(value) => void save('what_they_do', value)}
                      onCancel={() => setEditing(null)}
                    />
                  }
                >
                  <p className="mt-1.5 max-w-[70ch] text-[0.9375rem] leading-relaxed">
                    {kit.company_brief.what_they_do || (
                      <span className="text-muted">
                        No description of what they build was found.
                      </span>
                    )}
                  </p>
                </Editable>
              </div>

              <div>
                <p className="text-xs font-medium tracking-wide text-muted uppercase">Summary</p>
                <Editable
                  editing={editing === 'summary'}
                  onEdit={() => setEditing('summary')}
                  label="the company summary"
                  editor={
                    <EditableField
                      label="Company summary"
                      value={kit.company_brief.summary}
                      pending={pending}
                      onSave={(value) => void save('summary', value)}
                      onCancel={() => setEditing(null)}
                    />
                  }
                >
                  <p className="mt-1.5 max-w-[70ch] text-sm leading-relaxed text-muted">
                    {kit.company_brief.summary || 'Nothing was found to summarise.'}
                  </p>
                </Editable>
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
