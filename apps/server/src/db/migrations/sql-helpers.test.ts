// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ident } from './sql-helpers.js';

describe('ident', () => {
  it('accepts literal identifiers', () => {
    expect(ident('users')).toBe('users');
  });

  it('rejects runtime strings at compile time', () => {
    const fromInput: string = 'users';
    // @ts-expect-error runtime strings must not become identifiers
    expect(() => ident(fromInput)).not.toThrow();
  });

  it('rejects malformed identifiers at runtime', () => {
    expect(() => ident('users; drop table x')).toThrow('Invalid SQL identifier');
    expect(() => ident('Users')).toThrow();
  });
});
