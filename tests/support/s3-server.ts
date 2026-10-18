// SPDX-License-Identifier: Apache-2.0
/** A real S3-compatible server (Scality CloudServer, in memory) for tests. */
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { authorization, awsEncode } from '../../packages/storage/src/index.js';

export interface S3Info {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const ACCESS_KEY = 'coursecraft-test';
const SECRET_KEY = 'coursecraft-test-secret';
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export async function startS3Server(): Promise<{ container: StartedTestContainer; info: S3Info }> {
  const container = await new GenericContainer('zenko/cloudserver:latest')
    .withExposedPorts(8000)
    .withEnvironment({
      S3BACKEND: 'mem',
      SCALITY_ACCESS_KEY_ID: ACCESS_KEY,
      SCALITY_SECRET_ACCESS_KEY: SECRET_KEY,
      REMOTE_MANAGEMENT_DISABLE: '1',
    })
    .withWaitStrategy(Wait.forLogMessage(/server started/i))
    .start();
  const info: S3Info = {
    endpoint: `http://127.0.0.1:${container.getMappedPort(8000)}`,
    region: 'us-east-1',
    bucket: 'coursecraft',
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  };
  await createBucket(info);
  return { container, info };
}

/** Bucket creation is outside the storage interface: a plain signed PUT on the bucket. */
async function createBucket(info: S3Info): Promise<void> {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const headers = {
    host: new URL(info.endpoint).host,
    'x-amz-content-sha256': EMPTY_SHA,
    'x-amz-date': amzDate,
  };
  const authHeader = authorization({
    method: 'PUT',
    path: `/${awsEncode(info.bucket)}/`,
    query: {},
    headers,
    payloadHash: EMPTY_SHA,
    region: info.region,
    service: 's3',
    accessKeyId: info.accessKeyId,
    secretAccessKey: info.secretAccessKey,
    amzDate,
  });
  const res = await fetch(`${info.endpoint}/${info.bucket}/`, {
    method: 'PUT',
    headers: { ...headers, authorization: authHeader },
  });
  if (!res.ok) throw new Error(`Bucket could not be created: ${res.status} ${await res.text()}`);
}
