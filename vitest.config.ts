import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/src/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
    /**
     * Live provider tests are run deliberately with `npm run test:live`, never
     * as part of a routine `npm test`: they spend real free-tier tokens and
     * depend on a third party being up.
     */
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.live.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
