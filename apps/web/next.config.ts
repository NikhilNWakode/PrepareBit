import type { NextConfig } from 'next';

/**
 * The browser only ever talks to the Next.js origin. `/api/*` is proxied to the
 * Express service, which keeps the session cookie same-origin (SameSite=Lax)
 * in both local development and the deployed split of Vercel + Render.
 */
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // Next 16 writes AGENTS.md / CLAUDE.md into the repo on dev start. This is a
  // source tree, not a scratch pad.
  agentRules: false,

  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
