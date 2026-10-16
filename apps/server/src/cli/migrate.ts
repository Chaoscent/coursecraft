// SPDX-License-Identifier: Apache-2.0
import { CONVERTER_QUEUES, PGBOSS_SCHEMA } from '@lernwerk/shared';
import { PgBoss } from 'pg-boss';
import { createDatabase } from '../db/connection.js';
import { createMigrator } from '../db/migrations/index.js';

export interface MigrateResult {
  applied: string[];
}

/**
 * Runs with the migrator role (DDL). Installs application tables and the
 * job queue schema, then creates all queues, because the app and converter
 * roles cannot.
 */
export async function migrate(connectionString: string): Promise<MigrateResult> {
  const db = createDatabase(connectionString, { max: 1 });
  try {
    const { error, results } = await createMigrator(db).migrateToLatest();
    if (error) throw error instanceof Error ? error : new Error('Migration failed', { cause: error });
    const applied = (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);

    const boss = new PgBoss({
      connectionString,
      schema: PGBOSS_SCHEMA,
      max: 1,
      supervise: false,
      schedule: false,
    });
    await boss.start();
    try {
      const existing = new Set((await boss.getQueues()).map((q) => q.name));
      for (const name of CONVERTER_QUEUES) {
        if (!existing.has(name)) await boss.createQueue(name, { partition: false });
      }
    } finally {
      await boss.stop({ graceful: false });
    }
    return { applied };
  } finally {
    await db.destroy();
  }
}
