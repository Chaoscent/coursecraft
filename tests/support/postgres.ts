// SPDX-License-Identifier: Apache-2.0
/**
 * Starts PostgreSQL with the production init script and secrets layout, runs
 * all migrations, and leaves the migrated database as a template.
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { initSecrets } from '../../apps/server/src/cli/init-secrets.js';
import { migrate } from '../../apps/server/src/cli/migrate.js';

const INIT_DIR = new URL('../../docker/postgres-init/', import.meta.url).pathname;

export interface PgInfo {
  host: string;
  port: number;
  passwords: { postgres: string; migrator: string; app: string; converter: string };
  template: string;
}

export async function startPostgres(): Promise<{ container: StartedTestContainer; info: PgInfo }> {
  const secrets = mkdtempSync(join(tmpdir(), 'cc-pg-'));
  initSecrets({ dir: secrets, dbHost: 'db', dbName: 'coursecraft', chown: false });
  const dbSecrets = join(secrets, 'db');
  const read = (name: string) => readFileSync(join(dbSecrets, name), 'utf8').trim();
  const container = await new GenericContainer('postgres:17-trixie')
    .withEnvironment({
      POSTGRES_DB: 'coursecraft',
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: read('postgres_password'),
    })
    .withCopyFilesToContainer([
      ...readdirSync(dbSecrets).map((name) => ({
        source: join(dbSecrets, name),
        target: `/run/coursecraft/${name}`,
        mode: 0o444,
      })),
      ...readdirSync(INIT_DIR).map((name) => ({
        source: join(INIT_DIR, name),
        target: `/docker-entrypoint-initdb.d/${name}`,
        mode: 0o755,
      })),
    ])
    .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'max_connections=300'])
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  const info: PgInfo = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    passwords: {
      postgres: read('postgres_password'),
      migrator: read('migrator_password'),
      app: read('app_password'),
      converter: read('converter_password'),
    },
    template: 'coursecraft',
  };
  await migrate(pgUrl(info, 'coursecraft_migrator', info.template));
  return { container, info };
}

export function pgUrl(info: PgInfo, role: string, database: string): string {
  const password =
    role === 'postgres'
      ? info.passwords.postgres
      : role === 'coursecraft_migrator'
        ? info.passwords.migrator
        : role === 'coursecraft_app'
          ? info.passwords.app
          : info.passwords.converter;
  return `postgres://${role}:${password}@${info.host}:${info.port}/${database}`;
}
