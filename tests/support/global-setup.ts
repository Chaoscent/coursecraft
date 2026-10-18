// SPDX-License-Identifier: Apache-2.0
import type { TestProject } from 'vitest/node';
import { startPostgres, type PgInfo } from './postgres.js';
import { startS3Server, type S3Info } from './s3-server.js';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: PgInfo;
    /** Set when the suite runs against object storage (`CC_TEST_STORAGE=s3`). */
    s3: S3Info | null;
  }
}

export default async function setup(project: TestProject) {
  const { container, info } = await startPostgres();
  project.provide('pg', info);
  const s3 = process.env['CC_TEST_STORAGE'] === 's3' ? await startS3Server() : null;
  project.provide('s3', s3?.info ?? null);
  return async () => {
    await container.stop();
    await s3?.container.stop();
  };
}
