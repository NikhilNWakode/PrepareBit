import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

import { AuthProvider } from '@/lib/auth-context';

import './globals.css';

/**
 * Inter, self-hosted by `next/font` so there is no request to a third party and
 * no flash of unstyled text.
 *
 * The system stack was serviceable but rendered differently on every machine,
 * which makes a typographic hierarchy something you can only hope for. Loaded
 * as a variable font, so the weights the scale uses cost one file.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'PrepareBit',
  description:
    'Turn a job description and a company website into a structured interview preparation kit.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
