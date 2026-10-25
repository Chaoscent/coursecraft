// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';

/**
 * Certificate honesty flag (SECURITY_AUDIT.md F-07). Completions are reported
 * by the course content today (the player scores and reports via xAPI/SCORM),
 * so a certificate is not an independently verified result. `verified` stays
 * false until the server scores own courses itself; certificates and the
 * public verify page say so.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('certificates')
    .addColumn('verified', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('certificates').dropColumn('verified').execute();
}
