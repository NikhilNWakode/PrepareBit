'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Wordmark } from '@/components/ui/logo';
import { useAuth } from '@/lib/auth-context';

/**
 * The signed-in frame: a thin header and the page beneath it.
 *
 * The header stays out of the way — a wordmark, the account, and nothing else.
 * Product navigation belongs to the page, which knows what it contains.
 *
 * It also holds the client-side guard. The API is the real boundary; this only
 * keeps the interface honest when a session expires while a tab is open,
 * rather than showing a shell full of empty data.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, status, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated' || !user) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-(--container-page) items-center px-5 sm:px-8">
        <p className="text-sm text-muted" role="status">
          Loading…
        </p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-12 max-w-(--container-page) items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/dashboard" className="inline-flex min-h-6 items-center rounded">
            <Wordmark />
          </Link>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted sm:inline">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-(--container-page) px-5 py-10 sm:px-8">{children}</main>
    </div>
  );
}
