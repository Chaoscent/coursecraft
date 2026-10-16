// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Secrets may be given directly (`NAME`) or as a file path (`NAME_FILE`,
 * e.g. a Docker secret). The file variant wins.
 */
function readSecret(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const file = env[`${name}_FILE`];
  if (file) return readFileSync(file, 'utf8').trim();
  return env[name];
}

const httpsOrLocalhost = z
  .url()
  .transform((value) => new URL(value))
  .refine((url) => url.protocol === 'https:' || url.hostname === 'localhost', {
    message: 'Must use https (http is allowed only for localhost)',
  })
  .refine((url) => url.pathname === '/' && !url.search && !url.hash, {
    message: 'Must be an origin without path, query or fragment',
  });

const configSchema = z
  .object({
    publicUrl: httpsOrLocalhost,
    contentUrl: httpsOrLocalhost.optional(),
    host: z.string().default('0.0.0.0'),
    port: z.coerce.number().int().min(1).max(65535).default(3000),
    logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    databaseUrl: z.string().min(1),
    dataDir: z.string().default('/data'),
    trustProxy: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .refine((c) => !c.contentUrl || c.contentUrl.origin !== c.publicUrl.origin, {
    message: 'Content origin must differ from the public origin (host or port)',
    path: ['contentUrl'],
  });

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse({
    publicUrl: env['LERNWERK_PUBLIC_URL'],
    contentUrl: env['LERNWERK_CONTENT_URL'] || undefined,
    host: env['LERNWERK_HOST'],
    port: env['LERNWERK_PORT'],
    logLevel: env['LERNWERK_LOG_LEVEL'],
    databaseUrl: readSecret(env, 'LERNWERK_DATABASE_URL'),
    dataDir: env['LERNWERK_DATA_DIR'],
    trustProxy: env['LERNWERK_TRUST_PROXY'],
  });
  if (!result.success) {
    // Paths only: values may contain secrets.
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}
