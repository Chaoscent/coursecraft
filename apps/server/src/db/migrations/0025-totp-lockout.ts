// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';

/**
 * Per-account second-factor lockout (SECURITY_AUDIT.md F-09). TOTP guesses
 * counted here across login challenges, so an attacker who knows the password
 * cannot keep requesting fresh challenges to brute-force the code. Separate
 * from the password counter (`failed_logins`), which a correct password
 * resets; a correct code resets this one.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('users')
    .addColumn('totp_failed', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('totp_locked_until', 'timestamptz')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('users').dropColumn('totp_locked_until').dropColumn('totp_failed').execute();
}
