'use client';

import {
  QUESTION_CATEGORIES,
  type Kit,
  type KitQuestion,
  type QuestionCategory,
} from '@prep/shared';
import { useState } from 'react';

import {
  DeleteButton,
  EditButton,
  MoveControls,
  PinButton,
  ProvenanceBadge,
} from '@/components/kit/item-controls';
import { Button } from '@/components/ui/button';
import { Panel, Section, SectionHeader, SubsectionHeader } from '@/components/ui/section';
import { Dot } from '@/components/ui/typography';
import {
  addQuestion,
  deleteQuestion,
  editQuestion,
  getRegenerationPlan,
  regenerateQuestions,
  reorderQuestions,
  type RegenerationPlan,
} from '@/lib/kits';
import type { KitEditor } from '@/lib/use-kit-editor';

const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  'system-design': 'System design',
  'company-fit': 'Company fit',
};

const DIFFICULTY_LABELS: Record<number, string> = { 1: 'Easier', 2: 'Moderate', 3: 'Harder' };

interface Draft {
  prompt: string;
  answer_outline: string;
  difficulty: number;
  requirement_ids: string[];
}

function draftFrom(question: KitQuestion): Draft {
  return {
    prompt: question.prompt,
    answer_outline: question.answer_outline,
    difficulty: question.difficulty,
    requirement_ids: [...question.requirement_ids],
  };
}

const EMPTY_DRAFT: Draft = { prompt: '', answer_outline: '', difficulty: 2, requirement_ids: [] };

const FIELD =
  'w-full rounded border border-border bg-surface px-2.5 py-2 text-sm leading-relaxed text-ink outline-none transition-colors focus:border-accent';

/**
 * The editor for one question, used both for changing an existing one and for
 * writing a new one — the fields are the same, so the form should be too.
 *
 * `requirement_ids` is editable because it is what coverage is computed from:
 * someone who deletes a question needs a way to say which requirement now
 * carries that weight.
 */
function QuestionForm({
  kit,
  draft,
  pending,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: {
  kit: Kit;
  draft: Draft;
  pending: boolean;
  submitLabel: string;
  onChange: (draft: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  function toggleRequirement(id: string): void {
    onChange({
      ...draft,
      requirement_ids: draft.requirement_ids.includes(id)
        ? draft.requirement_ids.filter((current) => current !== id)
        : [...draft.requirement_ids, id],
    });
  }

  return (
    <div
      className="flex flex-col gap-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) onSubmit();
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Question</span>
        <textarea
          value={draft.prompt}
          onChange={(event) => onChange({ ...draft, prompt: event.target.value })}
          rows={2}
          disabled={pending}
          className={FIELD}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">What a strong answer covers</span>
        <textarea
          value={draft.answer_outline}
          onChange={(event) => onChange({ ...draft, answer_outline: event.target.value })}
          rows={3}
          disabled={pending}
          className={FIELD}
        />
      </label>

      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Difficulty</span>
          <select
            value={draft.difficulty}
            onChange={(event) => onChange({ ...draft, difficulty: Number(event.target.value) })}
            disabled={pending}
            className="h-9 w-40 rounded border border-border bg-surface px-2 text-sm outline-none focus:border-accent"
          >
            <option value={1}>1 — Easier</option>
            <option value={2}>2 — Moderate</option>
            <option value={3}>3 — Harder</option>
          </select>
        </label>

        <fieldset className="flex min-w-64 flex-1 flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium text-muted">
            Requirements this assesses
          </legend>
          {kit.role.requirements.map((requirement) => (
            <label key={requirement.id} className="flex items-start gap-2 text-[0.8125rem]">
              <input
                type="checkbox"
                checked={draft.requirement_ids.includes(requirement.id)}
                onChange={() => toggleRequirement(requirement.id)}
                disabled={pending}
                className="mt-1 accent-accent"
              />
              <span className="font-mono text-xs text-muted">{requirement.id}</span>
              <span>{requirement.text}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSubmit} pending={pending} disabled={draft.prompt.trim().length === 0}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <span className="text-xs text-muted">Esc to cancel, Ctrl+Enter to save</span>
      </div>
    </div>
  );
}

/**
 * Regeneration, with what it will keep stated before it runs.
 *
 * The preservation rule is the point of the whole builder, and a rule nobody
 * can see being applied is indistinguishable from one that is not there. It is
 * not dressed as a warning: keeping protected work is the normal, safe case.
 */
function RegeneratePanel({
  editor,
  category,
  plan,
  onCancel,
  onDone,
}: {
  editor: KitEditor;
  category: QuestionCategory;
  plan: RegenerationPlan;
  onCancel: () => void;
  onDone: (notes: string[], summary: string) => void;
}) {
  const key = `regenerate:${category}`;
  const kept = plan.protectedIds.length;
  const replaced = plan.replaceableIds.length;
  const nothingToDo = replaced === 0;

  async function confirm(): Promise<void> {
    const result = await editor.run(key, (version) =>
      regenerateQuestions(editor.kit.id, version, category),
    );

    onCancel();
    if (result) {
      onDone(
        result.notes,
        `${CATEGORY_LABELS[category]} questions regenerated. ${kept} kept, ${replaced} replaced.`,
      );
    }
  }

  return (
    <Panel className="mt-4">
      <p className="text-sm font-medium">
        Regenerate {CATEGORY_LABELS[category].toLowerCase()} questions
      </p>

      <ul className="mt-2 flex flex-col gap-0.5 text-[0.8125rem] text-muted">
        {kept > 0 ? (
          <li>
            <span className="font-mono text-xs text-ink">{kept}</span> edited, written or pinned
            {kept === 1 ? ' question' : ' questions'} will be kept.
          </li>
        ) : null}
        <li>
          {nothingToDo ? (
            'Nothing here can be replaced — every question is protected.'
          ) : (
            <>
              <span className="font-mono text-xs text-ink">{replaced}</span> generated
              {replaced === 1 ? ' question' : ' questions'} will be replaced.
            </>
          )}
        </li>
      </ul>

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => void confirm()}
          pending={editor.isBusy(key)}
          disabled={nothingToDo}
        >
          {editor.isBusy(key) ? 'Writing new questions…' : 'Regenerate'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={editor.isBusy(key)}>
          Cancel
        </Button>
      </div>
    </Panel>
  );
}

/**
 * One question.
 *
 * The prompt is the only thing at full size; position, difficulty, which
 * requirements it covers and where it came from all sit on one muted line
 * beneath it. That is what makes a thirty-question kit scannable — thirty
 * prompts, rather than thirty boxes of mixed-weight text.
 */
function QuestionRow({
  editor,
  question,
  index,
  total,
  onMove,
}: {
  editor: KitEditor;
  question: KitQuestion;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState(false);

  const kit = editor.kit.kit as Kit;
  const entry = editor.kit.provenance[question.id];
  const key = `question:${question.id}`;
  const pending = editor.isBusy(key);
  const locked = editor.busy !== null && !pending;

  async function save(): Promise<void> {
    if (!draft) return;

    const saved = await editor.run(key, (version) =>
      editQuestion(editor.kit.id, question.id, version, {
        prompt: draft.prompt,
        answer_outline: draft.answer_outline,
        difficulty: draft.difficulty,
        requirement_ids: draft.requirement_ids,
      }),
    );

    if (saved) setDraft(null);
  }

  if (draft) {
    return (
      <li className="border-b border-border py-4 last:border-b-0">
        <div className="sm:pl-9">
          <QuestionForm
            kit={kit}
            draft={draft}
            pending={pending}
            submitLabel="Save"
            onChange={setDraft}
            onSubmit={() => void save()}
            onCancel={() => setDraft(null)}
          />
        </div>
      </li>
    );
  }

  return (
    <li
      className={`border-b border-border py-4 last:border-b-0 ${
        editor.justSaved(key) ? 'animate-settle' : ''
      }`}
    >
      <div className="flex gap-3">
        {/* Position, so a question can be referred to out loud. */}
        <span className="mt-0.5 w-6 shrink-0 font-mono text-xs text-muted">
          {String(index + 1).padStart(2, '0')}
        </span>

        <div className="min-w-0 flex-1">
          <p className="max-w-[70ch] text-[0.9375rem] leading-relaxed">{question.prompt}</p>

          {question.answer_outline ? (
            <p className="mt-1.5 max-w-[70ch] text-sm leading-relaxed text-muted">
              {question.answer_outline}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>{DIFFICULTY_LABELS[question.difficulty] ?? question.difficulty}</span>
            <Dot />
            {question.requirement_ids.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1">
                Covers
                {question.requirement_ids.map((id) => (
                  <span key={id} className="font-mono">
                    {id}
                  </span>
                ))}
              </span>
            ) : (
              <span>Covers nothing, so it does not count towards coverage</span>
            )}
            {entry ? <Dot /> : null}
            <ProvenanceBadge entry={entry} />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1">
            <MoveControls
              index={index}
              total={total}
              label="this question"
              disabled={locked || pending}
              onMove={(to) => onMove(index, to)}
            />
            <EditButton
              disabled={locked || pending}
              label="this question"
              onClick={() => setDraft(draftFrom(question))}
            />
            <PinButton
              pinned={entry?.pinned ?? false}
              disabled={locked || pending}
              label="this question"
              onToggle={(next) =>
                void editor.run(key, (version) =>
                  editQuestion(editor.kit.id, question.id, version, { pinned: next }),
                )
              }
            />
            <DeleteButton
              confirming={confirming}
              disabled={locked || pending}
              label="this question"
              onAsk={() => setConfirming(true)}
              onCancel={() => setConfirming(false)}
              onConfirm={() =>
                void editor
                  .run(key, (version) => deleteQuestion(editor.kit.id, question.id, version))
                  .finally(() => setConfirming(false))
              }
            />
          </div>
        </div>
      </div>
    </li>
  );
}

function CategoryGroup({
  editor,
  category,
  onNotes,
}: {
  editor: KitEditor;
  category: QuestionCategory;
  onNotes: (notes: string[], summary: string) => void;
}) {
  const kit = editor.kit.kit as Kit;
  const questions = kit.questions.filter((question) => question.category === category);

  const [adding, setAdding] = useState<Draft | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [plan, setPlan] = useState<RegenerationPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const addKey = `add:${category}`;
  const regenerating = editor.isBusy(`regenerate:${category}`);

  async function askToRegenerate(): Promise<void> {
    setPlanLoading(true);
    try {
      const { plan: fetched } = await getRegenerationPlan(editor.kit.id, category);
      setPlan(fetched);
    } catch {
      // Fall back to asking without the breakdown rather than blocking on it.
      setPlan({ protectedIds: [], replaceableIds: [] });
    } finally {
      setPlanLoading(false);
    }
  }

  async function move(from: number, to: number): Promise<void> {
    const ids = questions.map((question) => question.id);
    const moved = ids[from];
    if (!moved || to < 0 || to >= ids.length) return;

    ids.splice(from, 1);
    ids.splice(to, 0, moved);

    const done = await editor.run(`reorder:${category}`, (version) =>
      reorderQuestions(editor.kit.id, version, category, ids),
    );

    // Announced, because a move a keyboard user cannot see did not happen.
    if (done) setAnnouncement(`Moved to position ${to + 1} of ${ids.length}.`);
  }

  async function add(): Promise<void> {
    if (!adding) return;

    const saved = await editor.run(addKey, (version) =>
      addQuestion(editor.kit.id, version, { category, ...adding }),
    );

    if (saved) setAdding(null);
  }

  return (
    <div id={`questions-${category}`} className="scroll-mt-20">
      <SubsectionHeader
        title={CATEGORY_LABELS[category]}
        count={questions.length}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void askToRegenerate()}
            pending={planLoading}
            disabled={editor.busy !== null || plan !== null}
          >
            Regenerate
          </Button>
        }
      />

      {/* Below the heading rather than inside it, so the heading row stays one line. */}
      {plan ? (
        <RegeneratePanel
          editor={editor}
          category={category}
          plan={plan}
          onCancel={() => setPlan(null)}
          onDone={onNotes}
        />
      ) : null}

      {questions.length > 0 ? (
        <ul className={regenerating ? 'opacity-50 transition-opacity' : undefined}>
          {questions.map((question, index) => (
            <QuestionRow
              key={question.id}
              editor={editor}
              question={question}
              index={index}
              total={questions.length}
              onMove={(from, to) => void move(from, to)}
            />
          ))}
        </ul>
      ) : (
        <p className="border-b border-border py-4 text-sm text-muted">
          No {CATEGORY_LABELS[category].toLowerCase()} questions. The posting may not state
          requirements of this kind.
        </p>
      )}

      <div className="pt-3">
        {adding ? (
          <QuestionForm
            kit={kit}
            draft={adding}
            pending={editor.isBusy(addKey)}
            submitLabel="Add question"
            onChange={setAdding}
            onSubmit={() => void add()}
            onCancel={() => setAdding(null)}
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAdding({ ...EMPTY_DRAFT })}
            disabled={editor.busy !== null}
          >
            + Add a question
          </Button>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

export function QuestionsSection({
  editor,
  onNotes,
}: {
  editor: KitEditor;
  onNotes: (notes: string[], summary: string) => void;
}) {
  const kit = editor.kit.kit as Kit;

  return (
    <Section id="questions">
      <SectionHeader
        title="Interview questions"
        count={kit.questions.length}
        description="Each question names the requirements it assesses, which is how coverage is checked. Regenerating a category keeps anything you have written, edited or pinned."
      />

      <div className="mt-8 flex flex-col gap-10">
        {QUESTION_CATEGORIES.map((category) => (
          <CategoryGroup key={category} editor={editor} category={category} onNotes={onNotes} />
        ))}
      </div>
    </Section>
  );
}
