// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { FsBlobStore, S3BlobStore, type BlobStore } from '@coursecraft/storage';
import type { AppConfig } from './config/env.js';
import { BlobWork, WorkDir, type WorkExchange } from './jobs/work-dir.js';

/** Where files live, chosen by `COURSECRAFT_STORAGE`. */
export function createBlobStore(config: AppConfig): BlobStore {
  if (
    config.storage === 's3' &&
    config.s3Endpoint &&
    config.s3Bucket &&
    config.s3AccessKeyId &&
    config.s3SecretAccessKey
  )
    return new S3BlobStore({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      bucket: config.s3Bucket,
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
      keyPrefix: config.s3KeyPrefix,
      virtualHostedStyle: config.s3VirtualHostedStyle,
    });
  return new FsBlobStore(config.dataDir);
}

/** The converter exchange: a shared directory, or the same object storage. */
export function createWorkExchange(config: AppConfig, blobs: BlobStore): WorkExchange {
  return config.storage === 's3' ? new BlobWork(blobs) : new WorkDir(config.workDir);
}

function envSecret(env: NodeJS.ProcessEnv, name: string): string {
  const file = env[`${name}_FILE`];
  const value = file ? readFileSync(file, 'utf8').trim() : env[name];
  if (!value) throw new Error(`${name} or ${name}_FILE must be set when COURSECRAFT_STORAGE=s3`);
  return value;
}

/** Object storage from the environment (command line, operator console), or null for the data volume. */
export function objectStoreFromEnv(env: NodeJS.ProcessEnv = process.env): S3BlobStore | null {
  if (env['COURSECRAFT_STORAGE'] !== 's3') return null;
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} must be set when COURSECRAFT_STORAGE=s3`);
    return value;
  };
  return new S3BlobStore({
    endpoint: required('COURSECRAFT_S3_ENDPOINT'),
    region: env['COURSECRAFT_S3_REGION'] ?? 'us-east-1',
    bucket: required('COURSECRAFT_S3_BUCKET'),
    accessKeyId: envSecret(env, 'COURSECRAFT_S3_ACCESS_KEY_ID'),
    secretAccessKey: envSecret(env, 'COURSECRAFT_S3_SECRET_ACCESS_KEY'),
    keyPrefix: env['COURSECRAFT_S3_KEY_PREFIX'] ?? '',
    virtualHostedStyle: env['COURSECRAFT_S3_VIRTUAL_HOSTED_STYLE'] === 'true',
  });
}

export function blobStoreFromEnv(env: NodeJS.ProcessEnv = process.env): BlobStore {
  return objectStoreFromEnv(env) ?? new FsBlobStore(env['COURSECRAFT_DATA_DIR'] ?? '/data');
}
