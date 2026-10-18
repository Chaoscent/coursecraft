// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const schema = z.object({
  databaseUrl: z.string().min(1),
  workDir: z.string().default('/work'),
  /** `s3`: inputs and outputs travel through object storage instead of the shared directory. */
  storage: z.enum(['fs', 's3']).default('fs'),
  s3Endpoint: z.url().optional(),
  s3Region: z.string().min(1).default('us-east-1'),
  s3Bucket: z.string().min(1).optional(),
  s3AccessKeyId: z.string().min(1).optional(),
  s3SecretAccessKey: z.string().min(1).optional(),
  s3KeyPrefix: z.string().default(''),
  s3VirtualHostedStyle: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  heartbeatFile: z.string().default('/tmp/converter-heartbeat'),
  concurrency: z.coerce.number().int().min(1).max(4).default(1),
});

export type ConverterConfig = z.infer<typeof schema>;

function secret(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const file = env[`${name}_FILE`];
  return file ? readFileSync(file, 'utf8').trim() : env[name];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConverterConfig {
  const file = env['COURSECRAFT_CONVERTER_DATABASE_URL_FILE'];
  const result = schema.safeParse({
    databaseUrl: file ? readFileSync(file, 'utf8').trim() : env['COURSECRAFT_CONVERTER_DATABASE_URL'],
    workDir: env['COURSECRAFT_WORK_DIR'],
    storage: env['COURSECRAFT_STORAGE'],
    s3Endpoint: env['COURSECRAFT_S3_ENDPOINT'] || undefined,
    s3Region: env['COURSECRAFT_S3_REGION'],
    s3Bucket: env['COURSECRAFT_S3_BUCKET'] || undefined,
    s3AccessKeyId: secret(env, 'COURSECRAFT_S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: secret(env, 'COURSECRAFT_S3_SECRET_ACCESS_KEY'),
    s3KeyPrefix: env['COURSECRAFT_S3_KEY_PREFIX'],
    s3VirtualHostedStyle: env['COURSECRAFT_S3_VIRTUAL_HOSTED_STYLE'],
    heartbeatFile: env['COURSECRAFT_HEARTBEAT_FILE'],
    concurrency: env['COURSECRAFT_CONVERTER_CONCURRENCY'],
  });
  const data = result.success ? result.data : null;
  if (
    data?.storage === 's3' &&
    !(data.s3Endpoint && data.s3Bucket && data.s3AccessKeyId && data.s3SecretAccessKey)
  )
    throw new Error(
      'Invalid configuration:\n  storage: S3 storage needs an endpoint, a bucket and access keys',
    );
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}
