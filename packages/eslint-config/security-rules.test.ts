// SPDX-License-Identifier: Apache-2.0
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { securityRules } from './index.js';

const linter = new Linter({ configType: 'flat' });
const config = [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: securityRules,
  },
];

const violations = (code: string, filename = 'repo.ts') =>
  linter.verify(code, config, { filename }).map((m) => m.ruleId);

describe('raw SQL is a lint error', () => {
  it.each([
    ["import { sql } from 'kysely';"],
    ["import { sql as q } from 'kysely';"],
    ["import * as k from 'kysely';"],
    ["import { Pool } from 'pg';"],
    ["import postgres from 'postgres';"],
    ["const pg = await import('pg');"],
    ["import { sql } from 'kysely/dist/raw-builder/sql.js';"],
    ['db.selectFrom(t).select(db.dynamic.ref(input));'],
    ['sql.raw(input);'],
    ['sql.ref(column);'],
    ['db.unsafe(`SELECT ${x}`);'],
  ])('%s', (code) => {
    expect(violations(code).length).toBeGreaterThan(0);
  });

  it('allows the query builder', () => {
    expect(
      violations("import { Kysely } from 'kysely';\ndb.selectFrom('users').where('id', '=', id);"),
    ).toEqual([]);
  });
});

describe('HTML string sinks are lint errors', () => {
  it.each([
    ['el.innerHTML = value;'],
    ['el.outerHTML = value;'],
    ["el.insertAdjacentHTML('beforeend', value);"],
    ['document.write(value);'],
    ['range.createContextualFragment(value);'],
    ['new Function(value);'],
    ['eval(value);'],
  ])('%s', (code) => {
    expect(violations(code).length).toBeGreaterThan(0);
  });

  it('dangerouslySetInnerHTML', () => {
    expect(violations('const a = <div dangerouslySetInnerHTML={{ __html: x }} />;', 'c.tsx')).not.toEqual([]);
  });

  it('allows textContent', () => {
    expect(violations('el.textContent = value;')).toEqual([]);
  });
});
