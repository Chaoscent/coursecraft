// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';

/**
 * Marks a registration whose result the server graded itself (SECURITY_AUDIT.md
 * F-07). Only set when every question in the attempt is auto-gradable; a
 * certificate issued for it is "verified" rather than "reported by the course".
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('registrations')
    .addColumn('verified', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('registrations').dropColumn('verified').execute();
}
