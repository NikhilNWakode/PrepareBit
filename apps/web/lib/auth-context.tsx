'use client';

import type { AuthUser, AuthUserResponse } from '@prep/shared';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ApiError, apiFetch } from './api-client';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  user: AuthUser | null;
  status: Status;
  register: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the session for the client. It starts in `loading` and resolves once
 * `/api/auth/me` answers, so a protected screen can wait rather than flashing
 * a signed-out state at someone who is signed in.
 *
 * This is convenience, not security: the API decides every request on its own.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const router = useRouter();

  useEffect(() => {
    let active = true;

    apiFetch<AuthUserResponse>('/api/auth/me')
      .then((response) => {
        if (!active) return;
        setUser(response.user);
        setStatus('authenticated');
      })
      .catch((error: unknown) => {
        if (!active) return;
        // A 401 here is the normal signed-out case, not a failure worth showing.
        if (!(error instanceof ApiError)) throw error;
        setUser(null);
        setStatus('anonymous');
      });

    return () => {
      active = false;
    };
  }, []);

  const authenticate = useCallback(
    async (path: string, email: string, password: string) => {
      const response = await apiFetch<AuthUserResponse>(path, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      setUser(response.user);
      setStatus('authenticated');
      router.push('/dashboard');
    },
    [router],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      register: (email, password) => authenticate('/api/auth/register', email, password),
      login: (email, password) => authenticate('/api/auth/login', email, password),
      logout: async () => {
        // The cookie is cleared server-side; clear local state either way so the
        // UI can never show a signed-in shell with a dead session behind it.
        try {
          await apiFetch<void>('/api/auth/logout', { method: 'POST' });
        } finally {
          setUser(null);
          setStatus('anonymous');
          router.push('/login');
        }
      },
    }),
    [user, status, authenticate, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
