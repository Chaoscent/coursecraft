// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPlaybackOrigin, loadConfig } from './env.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const base = {
  COURSECRAFT_PUBLIC_URL: 'https://coursecraft.example.org',
  COURSECRAFT_DATABASE_URL: 'postgres://app:secret@db/coursecraft',
  COURSECRAFT_MASTER_KEY: KEY,
  COURSECRAFT_IP_PEPPER: KEY,
};

describe('loadConfig', () => {
  it('requires 32-byte keys', () => {
    expect(() => loadConfig({ ...base, COURSECRAFT_MASTER_KEY: 'c2hvcnQ=' })).toThrow('masterKey');
  });

  it('applies defaults', () => {
    const config = loadConfig(base);
    expect(config.port).toBe(3000);
    expect(config.contentUrl).toBeUndefined();
  });

  it('rejects plain http except for localhost', () => {
    expect(() => loadConfig({ ...base, COURSECRAFT_PUBLIC_URL: 'http://coursecraft.lan' })).toThrow('https');
    expect(loadConfig({ ...base, COURSECRAFT_PUBLIC_URL: 'http://localhost:3000' }).publicUrl.port).toBe(
      '3000',
    );
  });

  it('accepts a content origin on another port', () => {
    const config = loadConfig({ ...base, COURSECRAFT_CONTENT_URL: 'https://coursecraft.example.org:8443' });
    expect(config.contentUrl?.origin).toBe('https://coursecraft.example.org:8443');
  });

  it('rejects a content origin equal to the public origin', () => {
    expect(() => loadConfig({ ...base, COURSECRAFT_CONTENT_URL: 'https://coursecraft.example.org' })).toThrow(
      'Content origin',
    );
  });

  it('reads secrets from *_FILE and never echoes values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-'));
    const file = join(dir, 'db');
    writeFileSync(file, 'postgres://app:from-file@db/coursecraft\n');
    const config = loadConfig({
      ...base,
      COURSECRAFT_DATABASE_URL: undefined,
      COURSECRAFT_DATABASE_URL_FILE: file,
    });
    expect(config.databaseUrl).toBe('postgres://app:from-file@db/coursecraft');

    expect(() =>
      loadConfig({ ...base, COURSECRAFT_PUBLIC_URL: 'nope', COURSECRAFT_DATABASE_URL: 'secret-value' }),
    ).toThrow(/^(?!.*secret-value)/s);
  });
});

describe('assertPlaybackOrigin (F-12)', () => {
  const content = new URL('https://content.example.org');

  it('refuses single mode without a content origin', () => {
    expect(() => assertPlaybackOrigin({ contentUrl: undefined, tenancy: 'single' }, {})).toThrow(
      'COURSECRAFT_CONTENT_URL is required',
    );
  });

  it('allows a content origin', () => {
    expect(() => assertPlaybackOrigin({ contentUrl: content, tenancy: 'single' }, {})).not.toThrow();
  });

  it('allows the explicit local-trial opt-out', () => {
    expect(() =>
      assertPlaybackOrigin(
        { contentUrl: undefined, tenancy: 'single' },
        { COURSECRAFT_ALLOW_SAME_ORIGIN_PLAYBACK: 'true' },
      ),
    ).not.toThrow();
  });

  it('does not require it for several organisations (own origins per tenant)', () => {
    expect(() => assertPlaybackOrigin({ contentUrl: undefined, tenancy: 'multi' }, {})).not.toThrow();
  });
});
