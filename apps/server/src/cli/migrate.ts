// SPDX-License-Identifier: Apache-2.0
import { PGBOSS_SCHEMA, QUEUES } from '@coursecraft/shared';
import { PgBoss } from 'pg-boss';
import { createDatabase } from '../db/connection.js';
import { createMigrator, enforcePrivileges } from '../db/migrations/index.js';
import { lockDownJobQueue, purgeForeignQueueCommands } from '../db/migrations/sql-helpers.js';

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
    await enforcePrivileges(db);

    // Before the pg-boss "bam" runner can execute anything: drop queued maintenance
    // commands that pg-boss did not write (SECURITY_AUDIT.md F-01). Harmless on a fresh
    // install (the pgboss schema does not exist yet).
    await purgeForeignQueueCommands(db);
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
      for (const name of Object.values(QUEUES)) {
        if (!existing.has(name)) await boss.createQueue(name, { partition: false });
      }
      // pg-boss creates or upgrades its tables in start(): narrow the new ones too (fresh installs).
      await lockDownJobQueue(db);
    } finally {
      await boss.stop({ graceful: false });
    }
    return { applied };
  } finally {
    await db.destroy();
  }
}
