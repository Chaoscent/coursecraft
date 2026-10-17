// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { ident, now, oneOf } from './sql-helpers.js';

const NOTICE_KINDS = ['assigned', 'reminder'] as const;

/** E-mail: password reset tokens and a record of assignment notices (sent once). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('password_resets')
    .addColumn('token_hash', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .execute();
  await db.schema.createIndex('password_resets_user_idx').on('password_resets').column('user_id').execute();

  await db.schema
    .createTable('assignment_notices')
    .addColumn('assignment_id', 'uuid', (c) => c.notNull().references('assignments.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('sent_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addPrimaryKeyConstraint('assignment_notices_pkey', ['assignment_id', 'user_id', 'kind'])
    .addCheckConstraint('assignment_notices_kind_check', oneOf(ident('kind'), NOTICE_KINDS))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('assignment_notices').execute();
  await db.schema.dropTable('password_resets').execute();
}
