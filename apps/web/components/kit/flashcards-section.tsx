'use client';

import type { Kit, KitFlashcard } from '@prep/shared';
import { useState } from 'react';

import {
  DeleteButton,
  EditButton,
  MoveControls,
  PinButton,
  ProvenanceBadge,
} from '@/components/kit/item-controls';
import { Button } from '@/components/ui/button';
import { Section, SectionHeader } from '@/components/ui/section';
import { addFlashcard, deleteFlashcard, editFlashcard, reorderFlashcards } from '@/lib/kits';
import type { KitEditor } from '@/lib/use-kit-editor';

/**
 * Flashcards, laid out as cards rather than as a list.
 *
 * Two columns and a tighter rhythm makes them read as something different from
 * the questions above — small, repeatable, meant for drilling — without any
 * change of colour or decoration. Stacking ten full-width blocks would just be
 * the question list again with different words in it.
 */

interface Draft {
  front: string;
  back: string;
}

const FIELD =
  'w-full rounded border border-border bg-surface px-2.5 py-2 text-sm leading-relaxed text-ink outline-none transition-colors focus:border-accent';

function FlashcardForm({
  draft,
  pending,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: Draft;
  pending: boolean;
  submitLabel: string;
  onChange: (draft: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-3"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) onSubmit();
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Front</span>
        <input
          value={draft.front}
          onChange={(event) => onChange({ ...draft, front: event.target.value })}
          disabled={pending}
          className={`${FIELD} h-9 py-0`}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Back</span>
        <textarea
          value={draft.back}
          onChange={(event) => onChange({ ...draft, back: event.target.value })}
          rows={2}
          disabled={pending}
          className={FIELD}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={onSubmit}
          pending={pending}
          disabled={draft.front.trim().length === 0}
        >
          {pending ? 'Saving…' : submitLabel}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <span className="text-xs text-muted">Esc to cancel, Ctrl+Enter to save</span>
      </div>
    </div>
  );
}

function FlashcardItem({
  editor,
  flashcard,
  index,
  total,
  onMove,
}: {
  editor: KitEditor;
  flashcard: KitFlashcard;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const key = `flashcard:${flashcard.id}`;
  const pending = editor.isBusy(key);
  const locked = editor.busy !== null && !pending;
  const entry = editor.kit.provenance[flashcard.id];

  async function save(): Promise<void> {
    if (!draft) return;

    const saved = await editor.run(key, (version) =>
      editFlashcard(editor.kit.id, flashcard.id, version, {
        front: draft.front,
        back: draft.back,
      }),
    );

    if (saved) setDraft(null);
  }

  if (draft) {
    return (
      <li className="rounded-md border border-border bg-surface p-3 sm:col-span-2">
        <FlashcardForm
          draft={draft}
          pending={pending}
          submitLabel="Save"
          onChange={setDraft}
          onSubmit={() => void save()}
          onCancel={() => setDraft(null)}
        />
      </li>
    );
  }

  return (
    <li
      className={`flex flex-col rounded-md border border-border bg-surface p-3 ${
        editor.justSaved(key) ? 'animate-settle' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{flashcard.front}</p>
        <ProvenanceBadge entry={entry} />
      </div>

      {/*
        The answer is hidden until asked for. A flashcard whose back is already
        on screen is not a flashcard, it is a sentence — and the one thing this
        section is for is testing whether you know it.
      */}
      <div className="mt-2 flex-1">
        {revealed ? (
          <p className="text-[0.8125rem] leading-relaxed text-muted">
            {flashcard.back || <span className="italic">This card has no answer written.</span>}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="text-[0.8125rem] text-muted underline decoration-border-strong underline-offset-4 hover:text-ink"
          >
            Show answer<span className="sr-only"> for {flashcard.front}</span>
          </button>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-border pt-2">
        <MoveControls
          index={index}
          total={total}
          label="this flashcard"
          disabled={locked || pending}
          onMove={(to) => onMove(index, to)}
        />
        <EditButton
          disabled={locked || pending}
          label="this flashcard"
          onClick={() => setDraft({ front: flashcard.front, back: flashcard.back })}
        />
        <PinButton
          pinned={entry?.pinned ?? false}
          disabled={locked || pending}
          label="this flashcard"
          onToggle={(next) =>
            void editor.run(key, (version) =>
              editFlashcard(editor.kit.id, flashcard.id, version, { pinned: next }),
            )
          }
        />
        <DeleteButton
          confirming={confirming}
          disabled={locked || pending}
          label="this flashcard"
          onAsk={() => setConfirming(true)}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            void editor
              .run(key, (version) => deleteFlashcard(editor.kit.id, flashcard.id, version))
              .finally(() => setConfirming(false))
          }
        />
      </div>
    </li>
  );
}

export function FlashcardsSection({ editor }: { editor: KitEditor }) {
  const kit = editor.kit.kit as Kit;
  const [adding, setAdding] = useState<Draft | null>(null);
  const [announcement, setAnnouncement] = useState('');

  async function move(from: number, to: number): Promise<void> {
    const ids = kit.flashcards.map((flashcard) => flashcard.id);
    const moved = ids[from];
    if (!moved || to < 0 || to >= ids.length) return;

    ids.splice(from, 1);
    ids.splice(to, 0, moved);

    const done = await editor.run('reorder:flashcards', (version) =>
      reorderFlashcards(editor.kit.id, version, ids),
    );

    if (done) setAnnouncement(`Moved to position ${to + 1} of ${ids.length}.`);
  }

  async function add(): Promise<void> {
    if (!adding) return;

    const saved = await editor.run('add:flashcard', (version) =>
      addFlashcard(editor.kit.id, version, { ...adding, requirement_ids: [] }),
    );

    if (saved) setAdding(null);
  }

  return (
    <Section id="flashcards">
      <SectionHeader
        title="Flashcards"
        count={kit.flashcards.length}
        description="Short recall prompts for the facts worth having ready."
      />

      {kit.flashcards.length > 0 ? (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {kit.flashcards.map((flashcard, index) => (
            <FlashcardItem
              key={flashcard.id}
              editor={editor}
              flashcard={flashcard}
              index={index}
              total={kit.flashcards.length}
              onMove={(from, to) => void move(from, to)}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-muted">No flashcards yet.</p>
      )}

      <div className="mt-4">
        {adding ? (
          <div className="rounded-md border border-border bg-surface p-3">
            <FlashcardForm
              draft={adding}
              pending={editor.isBusy('add:flashcard')}
              submitLabel="Add flashcard"
              onChange={setAdding}
              onSubmit={() => void add()}
              onCancel={() => setAdding(null)}
            />
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAdding({ front: '', back: '' })}
            disabled={editor.busy !== null}
          >
            + Add a flashcard
          </Button>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Section>
  );
}
