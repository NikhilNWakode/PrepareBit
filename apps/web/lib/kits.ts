import type { Kit } from '@prep/shared';

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

export interface StoredKit {
  id: string;
  status: KitStatus;
  input: { jd: string; company_url: string; days: number };
  kit: Kit | null;
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
