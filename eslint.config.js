import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint owns the rules the other two tools cannot express.
 *
 * Prettier is the only formatter, so `eslint-config-prettier` sits last and
 * switches off every stylistic rule. Biome covers fast syntactic lint and
 * accessibility. What is left for ESLint is type-aware analysis, which needs
 * a TypeScript program Biome never builds, plus the React hook rules that
 * have no Biome equivalent.
 *
 * The repo has two TypeScript projects, so each block names the one that
 * includes its files. A block pointed at the wrong project reports every
 * file in it as a parsing error rather than linting it.
 */
export default tseslint.config(
  {
    ignores: [
      // Published bundles ship byte-for-byte from pipeline to browser.
      'games/**',
      'history/**',
      'manifest.json',
      'dist/**',
      'coverage/**',
      '.remember/**',
      '.playwright-mcp/**',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  {
    rules: {
      // `const { controls: _omitted, ...rest }` is how this repo drops a
      // field to test a guard. The rest sibling is the point; the binding
      // it leaves behind is not.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // The Node pipeline, plus the isomorphic lib/ and the tests that run under
  // `node --test`. These are what tsconfig.json includes.
  {
    files: ['scripts/**/*.ts', 'lib/**/*.ts', 'src/**/*.test.ts', 'vite.config.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
  },

  // The browser app. tsconfig.web.json excludes *.test.ts, which runs on the
  // Node side, so this block excludes it too.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/**/*.test.ts'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { project: './tsconfig.web.json', tsconfigRootDir: import.meta.dirname },
    },
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
  },

  // Tooling config that no tsconfig includes, so no type information exists
  // for it and the type-aware rules cannot run.
  {
    files: ['eslint.config.js', 'vitest.config.ts'],
    languageOptions: { globals: globals.node },
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Test-runner idioms that the type-aware rules read as defects.
  //
  // `test()` from node:test returns a promise the runner owns, so every call
  // is a floating promise; its callbacks are `async` whether or not they
  // await. Assertions take values the runners type loosely, which the repo
  // narrows at the boundary in production code instead.
  {
    files: [
      '**/__tests__/**/*.{ts,tsx}',
      '**/*.test.{ts,tsx}',
      '**/testFixtures.ts',
      'src/vitest.setup.ts',
    ],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // A mock implements an async interface, so its methods are `async`
  // whether or not the mock body has anything to await.
  {
    files: ['**/*.mock.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },

  prettier,
);
