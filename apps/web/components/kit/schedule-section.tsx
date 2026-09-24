'use client';

import type { Kit, KitScheduleDay } from '@prep/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Panel, Section, SectionHeader } from '@/components/ui/section';
import { Editable, EditableField } from '@/components/ui/inline-edit';
import { duration } from '@/lib/format';
import { editScheduleDay, rebuildSchedule, unscheduledQuestionIds } from '@/lib/kits';
import type { KitEditor } from '@/lib/use-kit-editor';

/**
 * The study plan as a plan, not as the JSON it is stored in.
 *
 * Each day names what it is for, how long it takes and which questions it
 * covers — spelled out rather than left as a row of ids, because the point of
 * a plan is to be followed without cross-referencing anything.
 *
 * Editing a question never silently reshuffles the plan; someone may be
 * reading from it. Added questions sit outside it until it is rebuilt, and the
 * notice says so. Rebuilding costs nothing: the schedule is arithmetic over the
 * questions, the same function generation used, with no model involved.
 */
function DayRow({
  day,
  kit,
  pending,
  editing,
  onEdit,
  onSave,
  onCancel,
}: {
  day: KitScheduleDay;
  kit: Kit;
  pending: boolean;
  editing: boolean;
  onEdit: () => void;
  onSave: (focus: string) => void;
  onCancel: () => void;
}) {
  const byId = new Map(kit.questions.map((question) => [question.id, question]));
  const questions = day.question_ids
    .map((id) => byId.get(id))
    .filter((question): question is NonNullable<typeof question> => question !== undefined);

  return (
    <li className="grid gap-x-6 gap-y-2 border-b border-border py-5 last:border-b-0 sm:grid-cols-[6rem_1fr]">
      <div>
        <p className="font-mono text-xs tracking-wide text-muted uppercase">
          Day {String(day.day).padStart(2, '0')}
        </p>
        <p className="mt-0.5 font-mono text-xs text-muted">{duration(day.minutes)}</p>
      </div>

      <div className="min-w-0">
        <Editable
          editing={editing}
          onEdit={onEdit}
          label={`the focus for day ${day.day}`}
          editor={
            <EditableField
              label={`Focus for day ${day.day}`}
              value={day.focus}
              multiline={false}
              pending={pending}
              onSave={onSave}
              onCancel={onCancel}
            />
          }
        >
          <p className="text-[0.9375rem] font-medium leading-snug">
            {day.focus || <span className="text-muted">No focus set</span>}
          </p>
        </Editable>

        {questions.length > 0 ? (
          <>
            {/* The day's workload, answerable at a glance. */}
            <p className="mt-1 text-[0.8125rem] text-muted">
              {questions.length} question{questions.length === 1 ? '' : 's'}
            </p>

            <ul className="mt-2 flex flex-col gap-1.5">
              {questions.map((question) => (
                <li key={question.id} className="flex gap-2.5 text-[0.8125rem] text-muted">
                  <span className="shrink-0 font-mono text-xs">{question.id}</span>
                  <span className="line-clamp-1">{question.prompt}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-[0.8125rem] text-muted">
            Nothing scheduled. Rebuild the plan to spread the questions across the days again.
          </p>
        )}
      </div>
    </li>
  );
}

export function ScheduleSection({ editor }: { editor: KitEditor }) {
  const kit = editor.kit.kit as Kit;
  const [editingDay, setEditingDay] = useState<number | null>(null);

  const unscheduled = unscheduledQuestionIds(kit);
  const key = 'schedule';
  const pending = editor.isBusy(key);
  const totalMinutes = kit.schedule.days.reduce((sum, day) => sum + day.minutes, 0);

  async function saveFocus(day: number, focus: string): Promise<void> {
    const saved = await editor.run(key, (version) =>
      editScheduleDay(editor.kit.id, version, day, focus),
    );
    if (saved) setEditingDay(null);
  }

  return (
    <Section id="plan">
      <SectionHeader
        title="Study plan"
        count={kit.schedule.days_available}
        description={`${duration(totalMinutes)} of study, front-loaded across the days before the interview.`}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              void editor.run(key, (version) => rebuildSchedule(editor.kit.id, version))
            }
            pending={pending}
            disabled={editor.busy !== null && !pending}
          >
            {pending ? 'Rebuilding…' : 'Rebuild plan'}
          </Button>
        }
      />

      {unscheduled.length > 0 ? (
        <Panel className="mt-5">
          <p className="text-sm">
            <span className="font-mono text-xs">{unscheduled.length}</span> question
            {unscheduled.length === 1 ? ' is' : 's are'} not in the plan yet.{' '}
            <span className="text-muted">
              Rebuilding spreads everything across the {kit.schedule.days_available} days again.
            </span>
          </p>
        </Panel>
      ) : null}

      <ul className="mt-2">
        {kit.schedule.days.map((day) => (
          <DayRow
            key={day.day}
            day={day}
            kit={kit}
            pending={pending}
            editing={editingDay === day.day}
            onEdit={() => setEditingDay(day.day)}
            onSave={(focus) => void saveFocus(day.day, focus)}
            onCancel={() => setEditingDay(null)}
          />
        ))}
      </ul>
    </Section>
  );
}
