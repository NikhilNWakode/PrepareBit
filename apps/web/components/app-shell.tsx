'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';

/**
 * The signed-in frame: a thin header and the page beneath it.
 *
 * It also holds the client-side guard. The API is the real boundary — this only
 * keeps the interface honest when a session expires while a tab is open, rather
 * than showing a shell full of empty data.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, status, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated' || !user) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-5xl items-center px-4">
        <p className="text-sm text-muted" role="status">
          Loading…
        </p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/dashboard" className="text-sm font-medium tracking-tight hover:text-accent">
            Interview Prep Kit
          </Link>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted sm:inline">{user.email}</span>
            <Button variant="secondary" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
