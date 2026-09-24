import type { KitFlashcard, KitQuestion, KitRequirement } from '@prep/shared';
import { z } from 'zod';

import type { LlmProvider, LlmUsage } from '../../ai/llm-provider.js';
import { allocateIds, type IdCounters } from '../../domain/kit/ids.js';
import { capText, INPUT_CAPS, SYSTEM_RULES } from '../prompts.js';

/**
 * Flashcards for practice mode.
 *
 * Built from the requirements and the questions already generated — never from
 * the company pages. By this point the material has been through extraction,
 * verification and question generation; going back to the corpus would spend
 * tokens re-reading what has already been distilled, and risk reintroducing
 * facts the traceability check discarded.
 */

const flashcardSchema = z.object({
  flashcards: z.array(
    z.object({
      requirement_ids: z.array(z.string()),
      front: z.string(),
      back: z.string(),
    }),
  ),
});

const INSTRUCTIONS = [
  'Write flashcards for recall practice against the requirements below.',
  '',
  '- front: a short prompt — a term, a concept or a direct question',
  '- back: the answer, in one or two sentences someone could actually recall',
  '- requirement_ids: the ids this card practises, at least one, from the list above',
  '',
  'A flashcard is for memory, not for discussion: prefer a definition, a trade-off or a',
  'concrete fact over an open-ended question. Cover the must-have requirements first.',
  'Do not simply restate an interview question as a card.',
].join('\n');

export interface GenerateFlashcardsResult {
  flashcards: KitFlashcard[];
  counters: IdCounters;
  notes: string[];
  usage: LlmUsage | null;
}

export async function generateFlashcards(
  requirements: readonly KitRequirement[],
  questions: readonly KitQuestion[],
  provider: LlmProvider,
  counters: IdCounters,
): Promise<GenerateFlashcardsResult> {
  if (requirements.length === 0) {
    return {
      flashcards: [],
      counters,
      notes: ['No flashcards were generated: no requirements were extracted to practise against.'],
      usage: null,
    };
  }

  const requirementList = requirements
    .map((requirement) => `- ${requirement.id} (${requirement.priority}): ${requirement.text}`)
    .join('\n');

  // Question prompts only, as context for what is already covered elsewhere —
  // the answer outlines would double the cost for little benefit here.
  const questionList = questions.map((question) => `- ${question.prompt}`).join('\n');

  const body = capText(
    [
      'Requirements:',
      requirementList,
      '',
      'Questions already written, which the cards should complement rather than repeat:',
      questionList || '(none)',
    ].join('\n'),
    INPUT_CAPS.itemList,
  );

  const response = await provider.generateStructured(
    [
      { role: 'system', content: SYSTEM_RULES },
      { role: 'user', content: [INSTRUCTIONS, '', body.text].join('\n') },
    ],
    flashcardSchema,
    'flashcards',
    { stage: 'generate-flashcards', tier: 'fast', maxTokens: 2_500 },
  );

  const known = new Set(requirements.map((requirement) => requirement.id));
  const notes: string[] = [];

  const usable = response.value.flashcards
    .map((flashcard) => ({
      ...flashcard,
      requirement_ids: [...new Set(flashcard.requirement_ids)].filter((id) => known.has(id)),
    }))
    .filter((flashcard) => {
      if (flashcard.requirement_ids.length > 0 && flashcard.front.trim().length > 0) return true;
      notes.push('A flashcard was discarded: it did not reference any requirement it practises.');
      return false;
    });

  const { ids, counters: nextCounters } = allocateIds(counters, 'flashcard', usable.length);

  const flashcards: KitFlashcard[] = usable.map((flashcard, index) => ({
    id: ids[index] as string,
    front: flashcard.front.trim(),
    back: flashcard.back.trim(),
    requirement_ids: flashcard.requirement_ids,
  }));

  return { flashcards, counters: nextCounters, notes, usage: response.usage };
}
