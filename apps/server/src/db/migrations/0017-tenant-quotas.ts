// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';

/** Limits per organisation, set by the operator; null means unlimited. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('tenants')
    .addColumn('max_users', 'integer')
    .addColumn('max_storage_mb', 'integer')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('tenants').dropColumn('max_users').dropColumn('max_storage_mb').execute();
}
