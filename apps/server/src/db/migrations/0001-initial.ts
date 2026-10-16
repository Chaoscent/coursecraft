// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { now } from './sql-helpers.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('settings')
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('value', 'jsonb', (col) => col.notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(now()))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('settings').execute();
}
