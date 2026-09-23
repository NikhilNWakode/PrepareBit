'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { ApiError } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

interface AuthFormProps {
  mode: 'login' | 'register';
  onSubmit: (email: string, password: string) => Promise<void>;
}

const COPY = {
  login: {
    title: 'Sign in',
    action: 'Sign in',
    prompt: 'Need an account?',
    linkLabel: 'Create one',
    href: '/register',
    passwordAutoComplete: 'current-password',
  },
  register: {
    title: 'Create an account',
    action: 'Create account',
    prompt: 'Already have an account?',
    linkLabel: 'Sign in',
    href: '/login',
    passwordAutoComplete: 'new-password',
  },
} as const;

export function AuthForm({ mode, onSubmit }: AuthFormProps) {
  const copy = COPY[mode];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setError(null);
    setPending(true);

    try {
      await onSubmit(email, password);
      // On success the provider navigates away, so `pending` stays true and the
      // form cannot be submitted twice during the transition.
    } catch (submitError: unknown) {
      setError(
        submitError instanceof ApiError
          ? submitError.message
          : 'Something went wrong. Please try again.',
      );
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-12">
      <h1 className="text-xl font-medium tracking-tight">{copy.title}</h1>

      <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}

        <Field
          label="Email"
          type="email"
          name="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          autoFocus
          required
          disabled={pending}
          placeholder="you@example.com"
        />

        <Field
          label="Password"
          type="password"
          name="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={copy.passwordAutoComplete}
          required
          disabled={pending}
          {...(mode === 'register' ? { hint: 'At least 8 characters.' } : {})}
        />

        <Button type="submit" pending={pending} className="mt-1">
          {pending ? 'Working…' : copy.action}
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted">
        {copy.prompt}{' '}
        <Link href={copy.href} className="text-accent underline underline-offset-2">
          {copy.linkLabel}
        </Link>
      </p>
    </main>
  );
}
