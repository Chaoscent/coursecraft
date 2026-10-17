// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { emptyJsonObject, ident, now, oneOf, randomUuid } from './sql-helpers.js';

const KINDS = ['pptx-import', 'media'] as const;
const STATUSES = ['pending', 'done', 'failed'] as const;

/**
 * Conversions run in the isolated converter. The row id is also the job
 * directory name in the work volume.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('conversions')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('pending'))
    .addColumn('created_by', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('course_id', 'uuid', (c) => c.references('courses.id').onDelete('cascade'))
    .addColumn('input_name', 'text', (c) => c.notNull())
    .addColumn('payload', 'jsonb', (c) => c.notNull().defaultTo(emptyJsonObject()))
    .addColumn('result', 'jsonb', (c) => c.notNull().defaultTo(emptyJsonObject()))
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('finished_at', 'timestamptz')
    .addCheckConstraint('conversions_kind_check', oneOf(ident('kind'), KINDS))
    .addCheckConstraint('conversions_status_check', oneOf(ident('status'), STATUSES))
    .execute();
  await db.schema
    .createIndex('conversions_pending_idx')
    .on('conversions')
    .columns(['status', 'created_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('conversions').execute();
}
