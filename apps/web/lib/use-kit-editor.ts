'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from './api-client';
import type { KitResponse, StoredKit } from './kits';

/**
 * The editing session for one kit.
 *
 * It owns three things the sections should not each reinvent: the kit itself,
 * the version every write is made against, and which section is currently
 * busy. Keeping the version here rather than in each component is what makes
 * it impossible to write against a version the page has already replaced.
 */

export interface KitEditor {
  kit: StoredKit;
  /** The section mid-request, so one pending action does not grey out the page. */
  busy: string | null;
  isBusy: (key: string) => boolean;
  error: string | null;
  /** True when the kit moved on elsewhere and this page is out of date. */
  stale: boolean;
  /**
   * True briefly after a section saves, so the change can settle visibly
   * instead of needing a banner to announce it.
   */
  justSaved: (key: string) => boolean;
  dismissError: () => void;
  /**
   * Runs one change. The version is supplied, the result replaces the kit, and
   * failures are turned into something a person can read.
   */
  run: <T extends KitResponse>(
    key: string,
    action: (version: string) => Promise<T>,
  ) => Promise<T | null>;
}

export function useKitEditor(initial: StoredKit): KitEditor {
  const [kit, setKit] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The highlight is decoration with a job, and it must not outlive the page.
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const run = useCallback(
    async <T extends KitResponse>(
      key: string,
      action: (version: string) => Promise<T>,
    ): Promise<T | null> => {
      // One change at a time. Two concurrent writes would race on the same
      // version and the second would be refused anyway.
      if (busy) return null;

      setBusy(key);
      setError(null);

      try {
        const result = await action(kit.updatedAt);
        setKit(result.kit);

        setSaved(key);
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(null), 900);

        return result;
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'CONFLICT') {
          setStale(true);
        }

        setError(caught instanceof ApiError ? caught.message : 'That change could not be saved.');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [busy, kit.updatedAt],
  );

  return {
    kit,
    busy,
    isBusy: (key: string) => busy === key,
    justSaved: (key: string) => saved === key,
    error,
    stale,
    dismissError: () => setError(null),
    run,
  };
}
