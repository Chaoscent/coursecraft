// SPDX-License-Identifier: Apache-2.0
import { S3BlobStore } from '@coursecraft/storage';
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  createReadStream,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ConverterConfig } from './config.js';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/**
 * Runs `work` on the job directory layout `<root>/<jobId>/{in,out}`. With a
 * shared directory that is the directory itself. With object storage the
 * input is fetched into a scratch directory first and the outputs are
 * uploaded afterwards, before the job is reported done.
 */
export async function withJobFiles<T extends { outputs: string[] }>(
  config: ConverterConfig,
  jobId: string,
  work: (root: string) => Promise<T>,
): Promise<T> {
  if (config.storage !== 's3') return work(config.workDir);
  if (!JOB_ID.test(jobId)) throw new Error('Invalid job id');
  if (!(config.s3Endpoint && config.s3Bucket && config.s3AccessKeyId && config.s3SecretAccessKey))
    throw new Error('Object storage is not configured');
  const store = new S3BlobStore({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    bucket: config.s3Bucket,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
    keyPrefix: config.s3KeyPrefix,
    virtualHostedStyle: config.s3VirtualHostedStyle,
  });
  const scratch = mkdtempSync(join(tmpdir(), 'cc-job-'));
  try {
    const inDir = join(scratch, jobId, 'in');
    const outDir = join(scratch, jobId, 'out');
    mkdirSync(inDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });
    for (const name of await store.list(`work/${jobId}/in`)) {
      if (!FILE_NAME.test(name)) continue;
      await pipeline(await store.read(`work/${jobId}/in/${name}`), createWriteStream(join(inDir, name)));
    }
    const result = await work(scratch);
    for (const name of readdirSync(outDir)) {
      if (!FILE_NAME.test(name)) continue;
      const path = join(outDir, name);
      await store.put(`work/${jobId}/out/${name}`, {
        stream: createReadStream(path),
        size: statSync(path).size,
      });
    }
    return result;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
