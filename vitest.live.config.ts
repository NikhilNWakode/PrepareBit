import { defineConfig } from 'vitest/config';

/**
 * The live provider checks only. Separate from the default config so a routine
 * `npm test` never spends real tokens, and so running these is always a
 * deliberate act.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/src/**/*.live.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Real network calls against a rate-limited free tier: never in parallel.
    fileParallelism: false,
  },
});
