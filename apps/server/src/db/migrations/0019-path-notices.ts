// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { currentTenant, ident, isolateTenants, now, oneOf } from './sql-helpers.js';

/** Mails sent for learning path assignments: one of each kind per learner. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('path_notices')
    .addColumn('path_assignment_id', 'uuid', (c) =>
      c.notNull().references('path_assignments.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('sent_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('tenant_id', 'uuid', (c) =>
      c.notNull().defaultTo(currentTenant()).references('tenants.id').onDelete('cascade'),
    )
    .addPrimaryKeyConstraint('path_notices_pkey', ['path_assignment_id', 'user_id', 'kind'])
    .addCheckConstraint('path_notices_kind_check', oneOf(ident('kind'), ['assigned', 'reminder']))
    .execute();
  await isolateTenants(db, ident('path_notices'));
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('path_notices').execute();
}
