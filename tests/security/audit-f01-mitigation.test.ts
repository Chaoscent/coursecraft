// SPDX-License-Identifier: Apache-2.0
// Security audit (SECURITY_AUDIT.md, F-01): regression test for mitigation
// M-1. The throwaway database (testcontainers) is migrated by the real
// `migrate()` path, which locks down the pg-boss privileges. It checks that
// (1) the converter's real pg-boss client still completes its work, (2) the
// app's client still works, and (3) the owner-level escalation through
// pgboss.bam is closed for both roles. Never point this at a real installation.
import { PGBOSS_SCHEMA, QUEUES } from '@coursecraft/shared';
// eslint-disable-next-line no-restricted-imports -- audit test: the bam-insert probes need raw SQL; constant statements only
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { PgBoss } from '../../apps/converter/node_modules/pg-boss/dist/index.js';
import { migrate } from '../../apps/server/src/cli/migrate.js';
import { createBoss } from '../../apps/server/src/jobs/queue.js';
import { createTestDatabase } from '../support/database.js';
import { pgUrl } from '../support/postgres.js';

const pgInfo = inject('pg');
let drop: () => Promise<void>;
let appUrl: string;
let migratorUrl: string;
let converterUrl: string;

async function run(url: string, statements: readonly string[]): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

/** The converter's client, configured exactly as in apps/converter/src/main.ts. */
function converterBoss(errors: Error[]): PgBoss {
  const boss = new PgBoss({
    connectionString: converterUrl,
    schema: PGBOSS_SCHEMA,
    max: 2,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
  });
  boss.on('error', (error: Error) => errors.push(error));
  return boss;
}

beforeAll(async () => {
  const created = await createTestDatabase(pgInfo);
  drop = created.drop;
  appUrl = created.url;
  migratorUrl = created.migratorUrl;
  converterUrl = pgUrl(pgInfo, 'coursecraft_converter', new URL(appUrl).pathname.slice(1));
  // The cloned template was already migrated; running migrate() here is idempotent and ties
  // the test to the real lockdown path (migrations/index.ts, migrate.ts, db-bootstrap.ts).
  await migrate(migratorUrl);
});

afterAll(async () => {
  await drop?.();
});

describe('F-01 mitigation M-1: pg-boss privileges', () => {
  it('the converter still takes a media job, completes it and reports convert.done', async () => {
    const app = createBoss(appUrl);
    const appErrors: Error[] = [];
    app.on('error', (error: Error) => appErrors.push(error));
    await app.start();
    const errors: Error[] = [];
    const converter = converterBoss(errors);
    try {
      const jobId = randomUUID();
      const mediaJob = await app.send(QUEUES.media, { jobId, target: 'audio', normalize: false });
      expect(mediaJob).toBeTruthy();

      await converter.start();
      const handled = new Promise<void>((resolve, reject) => {
        void converter
          .work(QUEUES.media, { batchSize: 1, localConcurrency: 1 }, async ([job]) => {
            try {
              // What main.ts does after converting: report to the app.
              await converter.send(
                QUEUES.convertDone,
                { jobId: (job?.data as { jobId: string }).jobId, queue: QUEUES.media, ok: true, outputs: [] },
                { retryLimit: 3, retryDelay: 5 },
              );
              resolve();
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          })
          .catch(reject);
      });
      await handled;

      // The app receives the report.
      let done: { data: unknown }[] = [];
      for (let i = 0; i < 20 && !done.length; i++) {
        done = await app.fetch(QUEUES.convertDone);
        if (!done.length) await new Promise((r) => setTimeout(r, 250));
      }
      expect(done[0]?.data).toMatchObject({ jobId, ok: true });

      // And the converter's job ends as completed (pg-boss completes it after the handler returns).
      let state: string | undefined;
      for (let i = 0; i < 20 && state !== 'completed'; i++) {
        state = (await app.getJobById(QUEUES.media, mediaJob as string))?.state;
        if (state !== 'completed') await new Promise((r) => setTimeout(r, 250));
      }
      expect(state).toBe('completed');
      expect(errors).toEqual([]);
      expect(appErrors).toEqual([]);
    } finally {
      await converter.stop({ graceful: false });
      await app.stop({ graceful: false });
    }
  }, 60_000);

  it('the converter can no longer queue maintenance SQL or lift the bam interval gate', async () => {
    const client = new pg.Client({ connectionString: converterUrl });
    await client.connect();
    try {
      await expect(
        client.query(
          "INSERT INTO pgboss.bam (name, version, status, table_name, command) VALUES ('x', 0, 'pending', 'job', 'SELECT 1')",
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(client.query('UPDATE pgboss.version SET bam_on = NULL')).rejects.toThrow(
        /permission denied/,
      );
      await expect(client.query('UPDATE pgboss.queue SET retention_seconds = 1')).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await client.end();
    }
  });

  it('the app can no longer queue maintenance SQL either', async () => {
    await expect(
      run(appUrl, [
        "INSERT INTO pgboss.bam (name, version, status, table_name, command) VALUES ('x', 0, 'pending', 'job', 'SELECT 1')",
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it('migrate still runs afterwards (and keeps the converter locked out of bam)', async () => {
    await expect(migrate(migratorUrl)).resolves.toBeDefined();
    await expect(
      run(converterUrl, [
        "INSERT INTO pgboss.bam (name, version, status, table_name, command) VALUES ('x', 0, 'pending', 'job', 'SELECT 1')",
      ]),
    ).rejects.toThrow(/permission denied/);
  });
});
