// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const base = {
  LERNWERK_PUBLIC_URL: 'https://lernwerk.example.org',
  LERNWERK_DATABASE_URL: 'postgres://app:secret@db/lernwerk',
  LERNWERK_MASTER_KEY: KEY,
  LERNWERK_IP_PEPPER: KEY,
};

describe('loadConfig', () => {
  it('requires 32-byte keys', () => {
    expect(() => loadConfig({ ...base, LERNWERK_MASTER_KEY: 'c2hvcnQ=' })).toThrow('masterKey');
  });

  it('applies defaults', () => {
    const config = loadConfig(base);
    expect(config.port).toBe(3000);
    expect(config.contentUrl).toBeUndefined();
  });

  it('rejects plain http except for localhost', () => {
    expect(() => loadConfig({ ...base, LERNWERK_PUBLIC_URL: 'http://lernwerk.lan' })).toThrow('https');
    expect(loadConfig({ ...base, LERNWERK_PUBLIC_URL: 'http://localhost:3000' }).publicUrl.port).toBe('3000');
  });

  it('accepts a content origin on another port', () => {
    const config = loadConfig({ ...base, LERNWERK_CONTENT_URL: 'https://lernwerk.example.org:8443' });
    expect(config.contentUrl?.origin).toBe('https://lernwerk.example.org:8443');
  });

  it('rejects a content origin equal to the public origin', () => {
    expect(() => loadConfig({ ...base, LERNWERK_CONTENT_URL: 'https://lernwerk.example.org' })).toThrow(
      'Content origin',
    );
  });

  it('reads secrets from *_FILE and never echoes values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lw-'));
    const file = join(dir, 'db');
    writeFileSync(file, 'postgres://app:from-file@db/lernwerk\n');
    const config = loadConfig({
      ...base,
      LERNWERK_DATABASE_URL: undefined,
      LERNWERK_DATABASE_URL_FILE: file,
    });
    expect(config.databaseUrl).toBe('postgres://app:from-file@db/lernwerk');

    expect(() =>
      loadConfig({ ...base, LERNWERK_PUBLIC_URL: 'nope', LERNWERK_DATABASE_URL: 'secret-value' }),
    ).toThrow(/^(?!.*secret-value)/s);
  });
});
