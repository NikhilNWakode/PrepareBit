'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';

/**
 * A placeholder that proves the guard works end to end. Phase 9 replaces it
 * with the real dashboard.
 */
export default function DashboardPage() {
  const { user, status, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // The API is the boundary; this only keeps the UI honest if the session
    // expired while the tab was open.
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated' || !user) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl items-center px-4">
        <p className="text-sm text-muted" role="status">
          Loading your account…
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <header className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-medium tracking-tight">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted">{user.email}</p>
        </div>

        <Button variant="secondary" onClick={() => void logout()}>
          Sign out
        </Button>
      </header>

      <p className="mt-6 text-sm text-muted">Signed in. Kit creation arrives in a later phase.</p>
    </main>
  );
}
