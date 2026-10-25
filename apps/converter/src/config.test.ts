// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { scrubSecretsFromEnv } from './config.js';

describe('scrubSecretsFromEnv (F-15)', () => {
  it('removes the converter secrets from the environment, keeps the rest', () => {
    const env: NodeJS.ProcessEnv = {
      COURSECRAFT_CONVERTER_DATABASE_URL: 'postgres://converter:secret@db/coursecraft',
      COURSECRAFT_S3_ACCESS_KEY_ID: 'AKIA...',
      COURSECRAFT_S3_SECRET_ACCESS_KEY: 'shhh',
      COURSECRAFT_S3_BUCKET: 'bucket',
      COURSECRAFT_WORK_DIR: '/work',
    };
    scrubSecretsFromEnv(env);
    expect(env['COURSECRAFT_CONVERTER_DATABASE_URL']).toBeUndefined();
    expect(env['COURSECRAFT_S3_ACCESS_KEY_ID']).toBeUndefined();
    expect(env['COURSECRAFT_S3_SECRET_ACCESS_KEY']).toBeUndefined();
    // Non-secret configuration stays.
    expect(env['COURSECRAFT_S3_BUCKET']).toBe('bucket');
    expect(env['COURSECRAFT_WORK_DIR']).toBe('/work');
  });
});
