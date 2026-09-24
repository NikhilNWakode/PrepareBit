'use client';

import {
  REQUIREMENT_KINDS,
  REQUIREMENT_PRIORITIES,
  type Kit,
  type KitRequirement,
  type RequirementKind,
  type RequirementPriority,
} from '@prep/shared';
import { useState } from 'react';

import { EditButton, ProvenanceBadge } from '@/components/kit/item-controls';
import { Button } from '@/components/ui/button';
import { Section, SectionHeader } from '@/components/ui/section';
import { Dot } from '@/components/ui/typography';
import { editRequirement } from '@/lib/kits';
import type { KitEditor } from '@/lib/use-kit-editor';

/**
 * What the posting asked for.
 *
 * Requirements are editable but cannot be added or deleted: the honest
 * operation is correcting one the extraction got wrong, not inventing one the
 * employer never stated, which would quietly turn the coverage figure into
 * fiction.
 *
 * `must` is the only thing marked here. Marking `nice` as well would put a
 * badge on every row and distinguish nothing.
 */

interface Draft {
  text: string;
  kind: RequirementKind;
  priority: RequirementPriority;
}

function RequirementRow({
  editor,
  requirement,
  coveredBy,
}: {
  editor: KitEditor;
  requirement: KitRequirement;
  /** How many questions assess it — the per-row half of the coverage figure. */
  coveredBy: number;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);

  const key = `requirement:${requirement.id}`;
  const pending = editor.isBusy(key);
  const entry = editor.kit.provenance[requirement.id];

  async function save(): Promise<void> {
    if (!draft) return;

    const saved = await editor.run(key, (version) =>
      editRequirement(editor.kit.id, requirement.id, version, {
        text: draft.text,
        kind: draft.kind,
        priority: draft.priority,
      }),
    );

    if (saved) setDraft(null);
  }

  if (draft) {
    return (
      <li className="flex flex-col gap-3 border-b border-border py-3 last:border-b-0">
        <textarea
          value={draft.text}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          rows={2}
          disabled={pending}
          aria-label="Requirement text"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDraft(null);
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void save();
          }}
          className="w-full rounded border border-border bg-surface px-2.5 py-2 text-sm leading-relaxed outline-none focus:border-accent"
        />

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Priority
            <select
              value={draft.priority}
              onChange={(event) =>
                setDraft({ ...draft, priority: event.target.value as RequirementPriority })
              }
              disabled={pending}
              className="h-7 rounded border border-border bg-surface px-1.5 text-xs text-ink outline-none focus:border-accent"
            >
              {REQUIREMENT_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-xs text-muted">
            Kind
            <select
              value={draft.kind}
              onChange={(event) =>
                setDraft({ ...draft, kind: event.target.value as RequirementKind })
              }
              disabled={pending}
              className="h-7 rounded border border-border bg-surface px-1.5 text-xs text-ink outline-none focus:border-accent"
            >
              {REQUIREMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>

          <Button size="sm" onClick={() => void save()} pending={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 w-6 shrink-0 font-mono text-xs text-muted">{requirement.id}</span>
        <div className="min-w-0">
          <p className="max-w-[70ch] text-sm leading-relaxed">{requirement.text}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <span>{requirement.kind}</span>
            <Dot />
            <span className={requirement.priority === 'must' ? 'text-accent' : undefined}>
              {requirement.priority === 'must' ? 'Must-have' : 'Nice to have'}
            </span>
            <Dot />
            {/*
              The gap is worth naming on the row itself: a must-have with no
              question is the one thing in this list that needs acting on.
            */}
            <span
              className={
                coveredBy === 0 && requirement.priority === 'must' ? 'text-danger' : undefined
              }
            >
              {coveredBy === 0
                ? 'No question yet'
                : `Covered by ${coveredBy} question${coveredBy === 1 ? '' : 's'}`}
            </span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <ProvenanceBadge entry={entry} />
        <EditButton
          disabled={editor.busy !== null}
          label="this requirement"
          onClick={() =>
            setDraft({
              text: requirement.text,
              kind: requirement.kind,
              priority: requirement.priority,
            })
          }
        />
      </div>
    </li>
  );
}

export function RoleSection({ editor }: { editor: KitEditor }) {
  const kit = editor.kit.kit as Kit;
  const musts = kit.role.requirements.filter((r) => r.priority === 'must').length;

  // Counted from the questions themselves, so the row and the coverage figure
  // can never disagree.
  const coverageCounts = new Map<string, number>();
  for (const question of kit.questions) {
    for (const id of question.requirement_ids) {
      coverageCounts.set(id, (coverageCounts.get(id) ?? 0) + 1);
    }
  }

  return (
    <Section id="requirements">
      <SectionHeader
        title="Role and requirements"
        count={kit.role.requirements.length}
        description={`${musts} must-have. Editing a requirement changes what coverage is measured against.`}
      />

      <div className="mt-5 flex flex-col gap-6">
        {kit.role.responsibilities.length > 0 ? (
          <div>
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
              Responsibilities
            </h3>
            <ul className="mt-2 flex flex-col gap-1.5">
              {kit.role.responsibilities.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm leading-relaxed">
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1 shrink-0 rounded-full bg-border-strong"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Requirements</h3>
          <ul className="mt-1 flex flex-col">
            {kit.role.requirements.map((requirement) => (
              <RequirementRow
                key={requirement.id}
                editor={editor}
                requirement={requirement}
                coveredBy={coverageCounts.get(requirement.id) ?? 0}
              />
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
