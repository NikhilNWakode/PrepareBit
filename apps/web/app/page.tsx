import { redirect } from 'next/navigation';

/**
 * There is no marketing page. Someone arriving at the root wants either their
 * kits or the sign-in that leads to them, and `/dashboard` already sends
 * anonymous visitors to `/login`.
 */
export default function HomePage() {
  redirect('/dashboard');
}
