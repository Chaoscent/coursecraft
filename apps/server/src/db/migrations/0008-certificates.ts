// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { now, randomUuid } from './sql-helpers.js';

/** Issued certificates: a snapshot of name, title and result at the time of issue. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('certificates')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('serial', 'text', (c) => c.notNull().unique())
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('registration_id', 'uuid', (c) =>
      c.notNull().unique().references('registrations.id').onDelete('cascade'),
    )
    .addColumn('library_item_id', 'uuid', (c) =>
      c.notNull().references('library_items.id').onDelete('cascade'),
    )
    .addColumn('learner_name', 'text', (c) => c.notNull())
    .addColumn('item_title', 'text', (c) => c.notNull())
    .addColumn('score_scaled', 'double precision')
    .addColumn('completed_at', 'timestamptz', (c) => c.notNull())
    .addColumn('issued_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .execute();
  await db.schema.createIndex('certificates_user_idx').on('certificates').column('user_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('certificates').execute();
}
