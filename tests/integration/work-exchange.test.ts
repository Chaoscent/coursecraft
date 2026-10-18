// SPDX-License-Identifier: Apache-2.0
// The converter exchange through object storage: the app stores the input, the
// converter fetches it, works in a scratch directory and uploads its outputs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StartedTestContainer } from 'testcontainers';
import { S3BlobStore } from '../../packages/storage/src/index.js';
import { loadConfig } from '../../apps/converter/src/config.js';
import { withJobFiles } from '../../apps/converter/src/stage.js';
import { BlobWork } from '../../apps/server/src/jobs/work-dir.js';
import { startS3Server, type S3Info } from '../support/s3-server.js';

let container: StartedTestContainer;
let info: S3Info;
let work: BlobWork;
let converterConfig: ReturnType<typeof loadConfig>;

beforeAll(async () => {
  const server = await startS3Server();
  container = server.container;
  info = server.info;
  work = new BlobWork(new S3BlobStore({ ...info, keyPrefix: 'inst' }));
  converterConfig = loadConfig({
    COURSECRAFT_CONVERTER_DATABASE_URL: 'postgres://unused',
    COURSECRAFT_STORAGE: 's3',
    COURSECRAFT_S3_ENDPOINT: info.endpoint,
    COURSECRAFT_S3_REGION: info.region,
    COURSECRAFT_S3_BUCKET: info.bucket,
    COURSECRAFT_S3_ACCESS_KEY_ID: info.accessKeyId,
    COURSECRAFT_S3_SECRET_ACCESS_KEY: info.secretAccessKey,
    COURSECRAFT_S3_KEY_PREFIX: 'inst',
  });
}, 180_000);
afterAll(() => container?.stop());

const JOB = '7c9c4fba-846a-4e2d-830b-2b3b4c3434b5';

describe('work exchange through object storage', () => {
  it('carries the input to the converter and the outputs back', async () => {
    await work.prepare(JOB, 'source.pptx', Buffer.from('presentation bytes'));
    const result = await withJobFiles(converterConfig, JOB, (root) => {
      expect(readFileSync(join(root, JOB, 'in', 'source.pptx')).toString()).toBe('presentation bytes');
      mkdirSync(join(root, JOB, 'out'), { recursive: true });
      writeFileSync(join(root, JOB, 'out', 'page-0001.png'), 'png one');
      writeFileSync(join(root, JOB, 'out', 'page-0002.png'), 'png two');
      return Promise.resolve({ outputs: ['page-0001.png', 'page-0002.png'] });
    });
    expect(result.outputs).toHaveLength(2);
    expect(await work.outputs(JOB)).toEqual(['page-0001.png', 'page-0002.png']);
    expect((await work.readOutput(JOB, 'page-0002.png', 100))?.toString()).toBe('png two');
    // The app never reads more than it expects, and never names a file outside the pattern.
    expect(await work.readOutput(JOB, 'page-0002.png', 3)).toBeNull();
    expect(await work.readOutput(JOB, '../in/source.pptx', 100)).toBeNull();
    expect(await work.readOutput(JOB, 'missing.png', 100)).toBeNull();
  });

  it('removes everything of a job and refuses bad ids and names', async () => {
    await work.remove(JOB);
    expect(await work.outputs(JOB)).toEqual([]);
    await expect(work.prepare('not-a-job-id', 'source.pptx', Buffer.alloc(1))).rejects.toThrow();
    await expect(work.prepare(JOB, '../source.pptx', Buffer.alloc(1))).rejects.toThrow();
    await expect(
      withJobFiles(converterConfig, '../../etc', () => Promise.resolve({ outputs: [] })),
    ).rejects.toThrow();
  });
});
