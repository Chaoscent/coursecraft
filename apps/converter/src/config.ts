// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const schema = z.object({
  databaseUrl: z.string().min(1),
  workDir: z.string().default('/work'),
  heartbeatFile: z.string().default('/tmp/converter-heartbeat'),
  concurrency: z.coerce.number().int().min(1).max(4).default(1),
});

export type ConverterConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConverterConfig {
  const file = env['COURSECRAFT_CONVERTER_DATABASE_URL_FILE'];
  const result = schema.safeParse({
    databaseUrl: file ? readFileSync(file, 'utf8').trim() : env['COURSECRAFT_CONVERTER_DATABASE_URL'],
    workDir: env['COURSECRAFT_WORK_DIR'],
    heartbeatFile: env['COURSECRAFT_HEARTBEAT_FILE'],
    concurrency: env['COURSECRAFT_CONVERTER_CONCURRENCY'],
  });
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}
