// SPDX-License-Identifier: Apache-2.0
import js from '@eslint/js';
import i18next from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** The only file allowed to use Kysely's `sql`. */
export const SQL_HELPERS_FILE = 'apps/server/src/db/migrations/sql-helpers.ts';
/** The only file allowed to import the pg driver (to create the pool). */
export const DB_CONNECTION_FILE = 'apps/server/src/db/connection.ts';
/** Test-only: creates and drops per-test databases (no user input). */
export const TEST_DATABASE_FILE = 'tests/support/database.ts';

const DB_ESCAPE_HATCHES = {
  paths: [
    {
      name: 'kysely',
      importNames: ['sql', 'RawBuilder', 'CompiledQuery'],
      message: `Raw SQL is forbidden. Use the query builder; identifiers go through ${SQL_HELPERS_FILE}.`,
    },
    { name: 'pg', message: 'Use the Kysely instance from db/, never the pg driver.' },
    { name: 'postgres', message: 'Use the Kysely instance from db/.' },
  ],
  patterns: [
    {
      group: ['kysely/*', '!kysely/migration', '!kysely/helpers/postgres'],
      message: 'Only kysely, kysely/migration and kysely/helpers/postgres may be imported.',
    },
  ],
};

const DB_ESCAPE_SYNTAX = [
  {
    selector: "ImportDeclaration[source.value='kysely'] > ImportNamespaceSpecifier",
    message: 'Namespace imports of kysely would bypass the sql import ban.',
  },
  {
    selector: 'ImportExpression[source.value=/^(kysely|pg|postgres)$/]',
    message: 'Dynamic imports of database drivers are forbidden.',
  },
  {
    selector: "MemberExpression[property.name='dynamic']",
    message: 'Dynamic references are forbidden; map user input through a whitelist.',
  },
  {
    selector: "CallExpression[callee.property.name='unsafe']",
    message: 'Unsafe query APIs are forbidden.',
  },
  {
    selector: "MemberExpression[object.name='sql'][property.name=/^(raw|id|ref|lit|join|table)$/]",
    message: 'sql.raw/id/ref/lit are allowed only in the SQL helpers file.',
  },
];

const DOM_SINKS = [
  {
    selector: 'AssignmentExpression > MemberExpression[property.name=/^(innerHTML|outerHTML)$/]',
    message: 'Build DOM with createElement/textContent; never assign HTML strings.',
  },
  {
    selector: 'CallExpression[callee.property.name=/^(insertAdjacentHTML|write|writeln)$/]',
    message: 'HTML string sinks are forbidden.',
  },
  {
    selector: "CallExpression[callee.property.name='createContextualFragment']",
    message: 'HTML string sinks are forbidden.',
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML is forbidden.',
  },
  {
    selector: "NewExpression[callee.name='Function']",
    message: 'Dynamic code evaluation is forbidden.',
  },
];

/** Rules that make raw SQL and HTML string sinks build failures. */
export const securityRules = {
  'no-eval': 'error',
  'no-restricted-imports': ['error', DB_ESCAPE_HATCHES],
  'no-restricted-syntax': ['error', ...DB_ESCAPE_SYNTAX, ...DOM_SINKS],
};

export function createConfig({ tsconfigRootDir }) {
  return tseslint.config(
    {
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/coverage/**',
        'packages/course-model/schema/**',
        'docs/design/**/*.js',
        'test-results/**',
        'playwright-report/**',
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      rules: {
        ...securityRules,
        'no-implied-eval': 'off',
        '@typescript-eslint/no-implied-eval': 'error',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/ban-ts-comment': [
          'error',
          { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true },
        ],
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      },
    },
    {
      files: [SQL_HELPERS_FILE],
      rules: {
        'no-restricted-imports': 'off',
        'no-restricted-syntax': ['error', ...DOM_SINKS],
      },
    },
    {
      files: [DB_CONNECTION_FILE, TEST_DATABASE_FILE],
      rules: {
        'no-restricted-imports': [
          'error',
          { ...DB_ESCAPE_HATCHES, paths: DB_ESCAPE_HATCHES.paths.filter((p) => p.name !== 'pg') },
        ],
      },
    },
    {
      // Tests inspect untyped JSON responses; `any` itself stays forbidden.
      files: ['**/*.test.ts', 'tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
      },
    },
    {
      files: ['**/*.js', '**/*.mjs'],
      ...tseslint.configs.disableTypeChecked,
    },
    {
      files: ['**/*.js', '**/*.mjs'],
      ignores: ['apps/web/**', 'packages/player/**', 'tests/e2e/harness/**'],
      languageOptions: { globals: globals.node },
    },
    {
      files: ['apps/web/**', 'packages/player/**', 'tests/e2e/harness/**'],
      languageOptions: { globals: globals.browser },
    },
    {
      files: ['apps/web/src/**/*.tsx', 'apps/web/src/**/*.ts'],
      plugins: { 'react-hooks': reactHooks, i18next },
      rules: {
        ...reactHooks.configs.recommended.rules,
        // UI text comes from the locale files (de, en).
        'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],
        'no-restricted-globals': [
          'error',
          { name: 'fetch', message: 'Use api() from src/api/client.ts.' },
          { name: 'XMLHttpRequest', message: 'Use api() from src/api/client.ts.' },
        ],
      },
    },
    {
      files: ['apps/web/src/api/client.ts'],
      rules: { 'no-restricted-globals': 'off' },
    },
  );
}
