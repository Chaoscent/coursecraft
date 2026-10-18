// SPDX-License-Identifier: Apache-2.0
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
