// SPDX-License-Identifier: Apache-2.0
/**
 * Verifies the database role model against a real PostgreSQL started with
 * the same role setup as `coursecraft db-bootstrap` (requires Docker).
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Kysely } from 'kysely';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapRoles } from '../../../../tests/support/postgres.js';
import { initSecrets } from '../cli/init-secrets.js';
import { migrate } from '../cli/migrate.js';
import { createDatabase } from './connection.js';
import { createMigrator } from './migrations/index.js';
import { checkReadiness } from './readiness.js';
import type { Database } from './schema.js';

let container: StartedTestContainer;
let secrets: string;
const url = (role: 'migrate' | 'app' | 'converter') =>
  readFileSync(join(secrets, role, 'database_url'), 'utf8')
    .trim()
    .replace('@db:5432', `@${container.getHost()}:${container.getMappedPort(5432)}`);

beforeAll(async () => {
  secrets = mkdtempSync(join(tmpdir(), 'cc-db-'));
  initSecrets({ dir: secrets, dbHost: 'db', dbName: 'coursecraft', chown: false });
  const dbSecrets = join(secrets, 'db');
  container = await new GenericContainer('postgres:17-trixie')
    .withEnvironment({
      POSTGRES_DB: 'coursecraft',
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: readFileSync(join(dbSecrets, 'postgres_password'), 'utf8').trim(),
    })
    .withCopyFilesToContainer([
      ...readdirSync(dbSecrets).map((name) => ({
        source: join(dbSecrets, name),
        target: `/run/coursecraft/${name}`,
        mode: 0o444,
      })),
    ])
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  const read = (name: string) => readFileSync(join(dbSecrets, name), 'utf8').trim();
  await bootstrapRoles(container, {
    migrator: read('migrator_password'),
    app: read('app_password'),
    converter: read('converter_password'),
  });
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

  it('the converter role is bounded in connections and statement time (F-17)', async () => {
    const res = await container.exec([
      'psql',
      '--no-psqlrc',
      '-tA',
      '-U',
      'postgres',
      '-d',
      'coursecraft',
      '-c',
      "select rolconnlimit, array_to_string(rolconfig, ',') from pg_roles where rolname = 'coursecraft_converter'",
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.output.trim()).toContain('4|');
    expect(res.output).toContain('statement_timeout=30s');
  });
});
