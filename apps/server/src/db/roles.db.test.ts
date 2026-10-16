// SPDX-License-Identifier: Apache-2.0
/**
 * Verifies the database role model against a real PostgreSQL started with
 * the same init script as docker-compose (requires Docker).
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Kysely } from 'kysely';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initSecrets } from '../cli/init-secrets.js';
import { migrate } from '../cli/migrate.js';
import { createDatabase } from './connection.js';
import { createMigrator } from './migrations/index.js';
import { checkReadiness } from './readiness.js';
import type { Database } from './schema.js';

const INIT_DIR = new URL('../../../../docker/postgres-init/', import.meta.url).pathname;

let container: StartedTestContainer;
let secrets: string;
const url = (role: 'migrate' | 'app' | 'converter') =>
  readFileSync(join(secrets, role, 'database_url'), 'utf8')
    .trim()
    .replace('@db:5432', `@${container.getHost()}:${container.getMappedPort(5432)}`);

beforeAll(async () => {
  secrets = mkdtempSync(join(tmpdir(), 'lw-db-'));
  initSecrets({ dir: secrets, dbHost: 'db', dbName: 'lernwerk', chown: false });
  const dbSecrets = join(secrets, 'db');
  container = await new GenericContainer('postgres:17-trixie')
    .withEnvironment({
      POSTGRES_DB: 'lernwerk',
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: readFileSync(join(dbSecrets, 'postgres_password'), 'utf8').trim(),
    })
    .withCopyFilesToContainer([
      ...readdirSync(dbSecrets).map((name) => ({
        source: join(dbSecrets, name),
        target: `/run/lernwerk/${name}`,
        mode: 0o444,
      })),
      ...readdirSync(INIT_DIR).map((name) => ({
        source: join(INIT_DIR, name),
        target: `/docker-entrypoint-initdb.d/${name}`,
        mode: 0o755,
      })),
    ])
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  await migrate(url('migrate'));
});

afterAll(async () => {
  await container?.stop();
});

async function withDb<T>(role: 'migrate' | 'app' | 'converter', fn: (db: Kysely<Database>) => Promise<T>) {
  const db = createDatabase(url(role), { max: 1 });
  try {
    return await fn(db);
  } finally {
    await db.destroy();
  }
}

describe('database roles', () => {
  it('migrations are idempotent', async () => {
    await expect(migrate(url('migrate'))).resolves.toEqual({ applied: [] });
  });

  it('the app role sees a ready database', async () => {
    await expect(withDb('app', checkReadiness)).resolves.toEqual({ database: true, migrations: true });
  });

  it('the app role can read and write application tables', async () => {
    await withDb('app', async (db) => {
      await db
        .insertInto('settings')
        .values({ key: 'probe', value: JSON.stringify({ ok: true }) })
        .execute();
      const row = await db.selectFrom('settings').select('key').where('key', '=', 'probe').executeTakeFirst();
      expect(row?.key).toBe('probe');
    });
  });

  it('the app role cannot change the schema', async () => {
    await withDb('app', async (db) => {
      await expect(db.schema.createTable('evil').addColumn('id', 'integer').execute()).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.schema.dropTable('settings').execute()).rejects.toThrow(/must be owner/);
    });
  });

  it('the app role cannot run migrations', async () => {
    await withDb('app', async (db) => {
      const { error } = await createMigrator(db).migrateDown();
      expect(error).toBeDefined();
    });
  });

  it('the converter role cannot read application tables', async () => {
    await withDb('converter', async (db) => {
      // No USAGE on schema public: tables are not even visible to this role.
      await expect(db.withSchema('public').selectFrom('settings').selectAll().execute()).rejects.toThrow(
        /permission denied for schema public/,
      );
    });
  });
});
