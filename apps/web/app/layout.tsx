import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AuthProvider } from '@/lib/auth-context';

import './globals.css';

export const metadata: Metadata = {
  title: 'AI Interview Prep Kit',
  description:
    'Turn a job description and a company website into a structured interview preparation kit.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
