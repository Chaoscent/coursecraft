// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { z } from 'zod';

function secret(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const file = env[`${name}_FILE`];
  return file ? readFileSync(file, 'utf8').trim() : env[name];
}

const schema = z.object({
  /** Owner of the tables: the only role that may create and change organisations. */
  migratorDatabaseUrl: z.string().min(1),
  /** App role, for setup tokens and usage figures inside each organisation. */
  databaseUrl: z.string().min(1),
  /** Operator password; at least 16 characters. */
  password: z.string().min(16),
  host: z.string().default('0.0.0.0'),
  port: z.coerce.number().int().min(1).max(65535).default(3002),
  webDir: z.string().default('/app/public'),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});
export type OperatorConfig = z.infer<typeof schema>;

export function loadOperatorConfig(env: NodeJS.ProcessEnv = process.env): OperatorConfig {
  const result = schema.safeParse({
    migratorDatabaseUrl: secret(env, 'COURSECRAFT_MIGRATOR_DATABASE_URL'),
    databaseUrl: secret(env, 'COURSECRAFT_DATABASE_URL'),
    password: secret(env, 'COURSECRAFT_OPERATOR_PASSWORD'),
    host: env['COURSECRAFT_OPERATOR_HOST'],
    port: env['COURSECRAFT_OPERATOR_PORT'],
    webDir: env['COURSECRAFT_WEB_DIR'],
    logLevel: env['COURSECRAFT_LOG_LEVEL'],
  });
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid operator configuration:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}
