// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { checkListing, pgEnv } from './backup.js';

const line = (type: string, name: string) => `${type}rw-r----- 10001/10000 12 2026-10-17 12:00 ${name}`;

describe('backup archive', () => {
  it('accepts manifest, dump and regular data entries', () => {
    expect(() =>
      checkListing(
        [
          line('-', 'manifest.json'),
          line('-', 'database.dump'),
          line('d', 'data/assets/'),
          line('-', 'data/assets/ab/abcd'),
        ].join('\n'),
      ),
    ).not.toThrow();
  });

  it.each([
    [line('l', 'data/evil -> /etc/passwd'), 'type "l"'],
    [line('h', 'data/hard link to manifest.json'), 'type "h"'],
    [line('-', '/etc/cron.d/x'), 'Refusing archive entry'],
    [line('-', 'data/../../etc/x'), 'Refusing archive entry'],
    [line('-', 'other.txt'), 'Refusing archive entry'],
  ])('refuses %s', (entry, message) => {
    expect(() => checkListing(entry)).toThrow(message);
  });

  it('passes credentials through the environment, not arguments', () => {
    const env = pgEnv('postgres://coursecraft_app:p%40ss@db:5433/coursecraft?sslmode=disable');
    expect(env).toMatchObject({
      PGHOST: 'db',
      PGPORT: '5433',
      PGUSER: 'coursecraft_app',
      PGPASSWORD: 'p@ss',
      PGDATABASE: 'coursecraft',
      PGSSLMODE: 'disable',
    });
  });
});
