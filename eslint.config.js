import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import { includeIgnoreFile } from '@eslint/compat';
import { fileURLToPath } from 'node:url';

export default ts.config(
  // .gitignore is the single list of generated/vendored paths
  includeIgnoreFile(fileURLToPath(new URL('./.gitignore', import.meta.url))),
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
    },
  },
  {
    // Tests poke at untyped globals and internals on purpose.
    files: ['e2e/**', 'src/__tests__/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
);
