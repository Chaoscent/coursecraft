// SPDX-License-Identifier: Apache-2.0
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { initSecrets } from './init-secrets.js';

describe('initSecrets', () => {
  const dirs: string[] = [];
  const layout = () => {
    const dir = mkdtempSync(join(tmpdir(), 'lw-secrets-'));
    dirs.push(dir);
    return { dir, dbHost: 'db', dbName: 'lernwerk', chown: false };
  };

  afterAll(() => {
    for (const dir of dirs) {
      for (const sub of readdirSync(dir)) chmodSync(join(dir, sub), 0o700);
      rmSync(dir, { recursive: true });
    }
  });

  it('separates secrets per consumer and links passwords into URLs', () => {
    const l = layout();
    const created = initSecrets(l);
    expect(created).toContain('converter/database_url');
    const password = readFileSync(join(l.dir, 'db', 'converter_password'), 'utf8').trim();
    expect(password).toMatch(/^[0-9a-f]{48}$/);
    expect(readFileSync(join(l.dir, 'converter', 'database_url'), 'utf8').trim()).toBe(
      `postgres://lernwerk_converter:${password}@db:5432/lernwerk`,
    );
    expect(statSync(join(l.dir, 'app', 'master_key')).mode & 0o777).toBe(0o400);
  });

  it('keeps existing secrets on a second run', () => {
    const l = layout();
    initSecrets(l);
    const key = readFileSync(join(l.dir, 'app', 'master_key'), 'utf8');
    expect(initSecrets(l)).toEqual([]);
    expect(readFileSync(join(l.dir, 'app', 'master_key'), 'utf8')).toBe(key);
  });
});
