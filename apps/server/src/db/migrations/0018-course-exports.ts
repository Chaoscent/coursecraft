// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { currentTenant, ident, isolateTenants, now, oneOf, randomUuid } from './sql-helpers.js';

const STATUSES = ['pending', 'done', 'failed'] as const;

/** Export archives built in the background and kept for a day. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('course_exports')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('course_id', 'uuid', (c) => c.notNull().references('courses.id').onDelete('cascade'))
    .addColumn('format', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('pending'))
    .addColumn('error', 'text')
    .addColumn('file_name', 'text')
    .addColumn('size', 'bigint')
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('finished_at', 'timestamptz')
    .addColumn('tenant_id', 'uuid', (c) =>
      c.notNull().defaultTo(currentTenant()).references('tenants.id').onDelete('cascade'),
    )
    .addCheckConstraint('course_exports_status_check', oneOf(ident('status'), STATUSES))
    .execute();
  await db.schema
    .createIndex('course_exports_created_idx')
    .on('course_exports')
    .column('created_at')
    .execute();
  await isolateTenants(db, ident('course_exports'));
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('course_exports').execute();
}
