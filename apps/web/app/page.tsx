import { ApiStatus } from '@/components/api-status';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-16">
      <h1 className="text-2xl font-medium tracking-tight">AI Interview Prep Kit</h1>
      <p className="mt-2 text-muted">Foundation build is running.</p>

      <div className="mt-8 border-t border-border pt-4">
        <ApiStatus />
      </div>
    </main>
  );
}
