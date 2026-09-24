import type { Kit, QuestionCategory, RequirementKind, RequirementPriority } from '@prep/shared';

import { apiFetch } from './api-client';

/**
 * The kit endpoints, typed once so no screen hand-rolls a fetch or invents a
 * response shape.
 */

export type KitStatus =
  'draft' | 'queued' | 'researching' | 'generating' | 'validating' | 'completed' | 'failed';

/** A kit is still working while its status is none of the terminal ones. */
export const TERMINAL_STATUSES: readonly KitStatus[] = ['completed', 'failed'];

export function isTerminal(status: KitStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface KitSummary {
  id: string;
  status: KitStatus;
  company: string;
  role: string;
  company_url: string;
  days: number;
  createdAt: string;
  updatedAt: string;
}

export interface KitError {
  code: string;
  message: string;
}

/** Generated / edited / pinned state, keyed by item id. */
export interface ProvenanceEntry {
  origin: 'generated' | 'user';
  edited: boolean;
  pinned: boolean;
  updatedAt: string;
}

export type Provenance = Record<string, ProvenanceEntry>;

/**
 * What the crawl and search actually found, compressed once by the pipeline and
 * kept so a regeneration does not have to repeat the work.
 *
 * Shown to the user rather than kept internal: the separation between what a
 * company says it builds and what it says about hiring is the whole reason a
 * kit for one company differs from a kit for another, and it is the evidence
 * behind every company-fit question.
 */
export interface ResearchDigest {
  industry: string;
  products: string[];
  companyFacts: string[];
  engineeringFacts: string[];
  hiringFacts: string[];
  interviewFacts: string[];
  sources: string[];
}

export interface StoredKit {
  id: string;
  status: KitStatus;
  input: { jd: string; company_url: string; days: number };
  kit: Kit | null;
  provenance: Provenance;
  /** Absent on kits generated before the digest was kept. */
  context: { digest: ResearchDigest } | null;
  research: {
    pagesUsed: string[];
    pagesFailed: { url: string; reason: string }[];
    searchUsed: string;
    /** What could and could not be found. Surfaced in the UI, not hidden. */
    notes: string[];
  };
  progress: { step: string; completedSteps: number; totalSteps: number };
  error: KitError | null;
  createdAt: string;
  updatedAt: string;
}

export interface KitProgress {
  id: string;
  status: KitStatus;
  step: string;
  completedSteps: number;
  totalSteps: number;
  error: KitError | null;
}

export interface CreateKitResponse {
  id: string;
  status: KitStatus;
  /** True when an existing kit was returned for the same posting. */
  reused: boolean;
}

export interface BatchUploadResponse {
  accepted: { index: number; id: string; kitId: string; reused: boolean }[];
  rejected: { index: number; id: string | null; reason: string }[];
}

export function listKits(): Promise<{ kits: KitSummary[] }> {
  return apiFetch('/api/kits');
}

export function getKit(id: string): Promise<{ kit: StoredKit }> {
  return apiFetch(`/api/kits/${id}`);
}

export function getKitProgress(id: string): Promise<KitProgress> {
  return apiFetch(`/api/kits/${id}/status`);
}

export function createKit(input: {
  jd: string;
  company_url: string;
  days: number;
}): Promise<CreateKitResponse> {
  return apiFetch('/api/kits', { method: 'POST', body: JSON.stringify(input) });
}

/** Takes the same case shape the batch command reads. */
export function createKitsFromFile(cases: unknown[]): Promise<BatchUploadResponse> {
  return apiFetch('/api/kits/batch', { method: 'POST', body: JSON.stringify(cases) });
}

// --- editing -----------------------------------------------------------------

/**
 * Every change carries the version it was made against and gets the whole kit
 * back. One request, one new version, one state replacement — a page can never
 * end up holding a version it is no longer allowed to write against.
 */
export interface KitResponse {
  kit: StoredKit;
}

/** What a regeneration would keep, asked for before anything is replaced. */
export interface RegenerationPlan {
  protectedIds: string[];
  replaceableIds: string[];
}

export interface RegenerationResponse extends KitResponse {
  notes: string[];
}

function send<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown): Promise<T> {
  return apiFetch(path, { method, body: JSON.stringify(body) });
}

export function editQuestion(
  kitId: string,
  questionId: string,
  version: string,
  patch: {
    prompt?: string;
    answer_outline?: string;
    difficulty?: number;
    requirement_ids?: string[];
    pinned?: boolean;
  },
): Promise<KitResponse> {
  return send(`/api/kits/${kitId}/questions/${questionId}`, 'PATCH', { version, ...patch });
}

export function addQuestion(
  kitId: string,
  version: string,
  input: {
    category: QuestionCategory;
    prompt: string;
    answer_outline: string;
    difficulty: number;
    requirement_ids: string[];
  },
): Promise<KitResponse> {
  return send(`/api/kits/${kitId}/questions`, 'POST', { version, ...input });
}

export function deleteQuestion(
  kitId: string,
  questionId: string,
  version: string,
): Promise<KitResponse> {
  return send(`/api/kits/${kitId}/questions/${questionId}`, 'DELETE', { version });
}

export function reorderQuestions(
  kitId: string,
  version: string,
  category: QuestionCategory,
  ids: string[],
): Promise<KitResponse> {
  return send(`/api/kits/${kitId}/questions/reorder`, 'POST', { version, category, ids });
}

export function editFlashcard(
  kitId: string,
  flashcardId: string,
  version: string,
  patch: { front?: string; back?: string; pinned?: boolean },
): Promise<KitResponse> {
  return send(`/api/kits/${kitId}/flashcards/${flashcardId}`, 'PATCH', { version, ...patch });
}

export function addFlashcard(
  kitId: string,
  version: string,
  input: { front: string; back: string; requirement_ids: string[] },
): Promise<KitResponse> {
  return send(`/api/kits/${kitId}/flashcards`, 'POST', { version, ...input });
}

export function deleteFlashcard(
  kitId: string,
  flashcardId: string,
  version: string,
): Promise<KitResponse> {
  return send(`/api/kits/${kitId}/flashcards/${flashcardId}`, 'DELETE', { version });
}

export function reorderFlashcards(
  kitId: string,
  version: string,
  ids: string[],
): Promise<KitResponse> {
  return send(`/api/kits/${kitId}/flashcards/reorder`, 'POST', { version, ids });
}

export function editBrief(
  kitId: string,
  version: string,
  patch: { summary?: string; what_they_do?: string },
): Promise<KitResponse> {
  return send(`/api/kits/${kitId}/brief`, 'PATCH', { version, ...patch });
}

export function editRequirement(
  kitId: string,
  requirementId: string,
  version: string,
  patch: { text?: string; kind?: RequirementKind; priority?: RequirementPriority },
): Promise<KitResponse> {
  return send(`/api/kits/${kitId}/requirements/${requirementId}`, 'PATCH', { version, ...patch });
}

export function editScheduleDay(
  kitId: string,
  version: string,
  day: number,
  focus: string,
): Promise<KitResponse> {
  return send(`/api/kits/${kitId}/schedule/day`, 'PATCH', { version, day, focus });
}

export function getRegenerationPlan(
  kitId: string,
  category: QuestionCategory,
): Promise<{ plan: RegenerationPlan }> {
  return apiFetch(`/api/kits/${kitId}/regenerate/questions/${category}/plan`);
}

export function regenerateQuestions(
  kitId: string,
  version: string,
  category: QuestionCategory,
): Promise<RegenerationResponse> {
  return send(`/api/kits/${kitId}/regenerate/questions/${category}`, 'POST', { version });
}

export function regenerateBrief(kitId: string, version: string): Promise<RegenerationResponse> {
  return send(`/api/kits/${kitId}/regenerate/company`, 'POST', { version });
}

export function rebuildSchedule(kitId: string, version: string): Promise<KitResponse> {
  return send(`/api/kits/${kitId}/regenerate/schedule`, 'POST', { version });
}

/** Questions that exist but are not in the plan: the prompt to rebuild it. */
export function unscheduledQuestionIds(kit: Kit): string[] {
  const scheduled = new Set(kit.schedule.days.flatMap((day) => day.question_ids));
  return kit.questions.filter((question) => !scheduled.has(question.id)).map((q) => q.id);
}

/** Why an item survives a regeneration, for the badge beside it. */
export function protectionOf(
  entry: ProvenanceEntry | undefined,
): 'yours' | 'edited' | 'pinned' | null {
  if (!entry) return null;
  if (entry.pinned) return 'pinned';
  if (entry.origin === 'user') return 'yours';
  if (entry.edited) return 'edited';
  return null;
}
