// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { now } from './sql-helpers.js';

/** Customer details kept by the operator, and a log of operator actions. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('tenants')
    .addColumn('contact_name', 'text')
    .addColumn('contact_email', 'text')
    .addColumn('plan', 'text')
    .addColumn('notes', 'text')
    .execute();
  // Platform table: written by the operator console only (table owner), never by the app.
  await db.schema
    .createTable('operator_log')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('action', 'text', (c) => c.notNull())
    // No foreign key: entries outlive deleted organisations.
    .addColumn('tenant_id', 'uuid')
    .addColumn('tenant_name', 'text')
    .addColumn('details', 'jsonb')
    .execute();
  await db.schema.createIndex('operator_log_at_idx').on('operator_log').column('at').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('operator_log').execute();
  await db.schema
    .alterTable('tenants')
    .dropColumn('notes')
    .dropColumn('plan')
    .dropColumn('contact_email')
    .dropColumn('contact_name')
    .execute();
}
