// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { currentTenant, ident, isolateTenants } from './sql-helpers.js';

/** Trainers responsible for a group: they see its learners (and those of its subgroups). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('group_managers')
    .addColumn('group_id', 'uuid', (c) => c.notNull().references('groups.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('tenant_id', 'uuid', (c) =>
      c.notNull().defaultTo(currentTenant()).references('tenants.id').onDelete('cascade'),
    )
    .addPrimaryKeyConstraint('group_managers_pkey', ['group_id', 'user_id'])
    .execute();
  await db.schema.createIndex('group_managers_user_idx').on('group_managers').column('user_id').execute();
  await isolateTenants(db, ident('group_managers'));
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('group_managers').execute();
}
