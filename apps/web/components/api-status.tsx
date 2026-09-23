'use client';

import { useEffect, useState } from 'react';

type Status = 'checking' | 'ok' | 'unreachable';

const LABELS: Record<Status, string> = {
  checking: 'Checking API…',
  ok: 'API reachable',
  unreachable: 'API unreachable',
};

const DOT_CLASSES: Record<Status, string> = {
  checking: 'bg-muted',
  ok: 'bg-accent',
  unreachable: 'bg-red-600',
};

/**
 * Proves the Next.js → Express rewrite end to end from the browser. It grows
 * into the cold-start indicator once the API is deployed on a free tier that
 * sleeps.
 */
export function ApiStatus() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/health', { signal: controller.signal })
      .then((response) => setStatus(response.ok ? 'ok' : 'unreachable'))
      .catch(() => {
        if (!controller.signal.aborted) setStatus('unreachable');
      });

    return () => controller.abort();
  }, []);

  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <span
        aria-hidden="true"
        className={`inline-block size-1.5 rounded-full ${DOT_CLASSES[status]}`}
      />
      <span role="status">{LABELS[status]}</span>
    </p>
  );
}
