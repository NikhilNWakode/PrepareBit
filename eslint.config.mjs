import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/*.d.ts', 'coverage/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },

  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', '*.ts', '*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // A Pages Router rule. This app is App Router only, and the rule cannot
      // locate a `pages/` directory from the monorepo root anyway.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  // Must stay last: turns off every rule that would fight Prettier.
  prettierConfig,
);
