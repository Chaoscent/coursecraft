// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { now } from './sql-helpers.js';

/** Tables that let several app replicas share work: request counters and periodic job leases. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('rate_limits')
    .addColumn('key', 'text', (c) => c.primaryKey())
    .addColumn('count', 'integer', (c) => c.notNull())
    .addColumn('reset_at', 'timestamptz', (c) => c.notNull())
    .execute();
  await db.schema.createIndex('rate_limits_reset_idx').on('rate_limits').column('reset_at').execute();

  // One row per periodic job; the replica that holds the lease runs it.
  await db.schema
    .createTable('periodic_jobs')
    .addColumn('name', 'text', (c) => c.primaryKey())
    .addColumn('locked_until', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('periodic_jobs').execute();
  await db.schema.dropTable('rate_limits').execute();
}
