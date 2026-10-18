// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { now } from './sql-helpers.js';

/** Failed directory sign-ins per account, so guessing cannot lock accounts in the directory. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('directory_attempts')
    .addColumn('provider_id', 'uuid', (c) => c.notNull().references('sso_providers.id').onDelete('cascade'))
    // Keyed hash of the typed name: the table never holds account names.
    .addColumn('account_hash', 'text', (c) => c.notNull())
    .addColumn('failures', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('locked_until', 'timestamptz')
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addPrimaryKeyConstraint('directory_attempts_pkey', ['provider_id', 'account_hash'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('directory_attempts').execute();
}
