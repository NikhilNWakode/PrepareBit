'use client';

import { AuthForm } from '@/components/auth-form';
import { useAuth } from '@/lib/auth-context';

export default function RegisterPage() {
  const { register } = useAuth();
  return <AuthForm mode="register" onSubmit={register} />;
}
