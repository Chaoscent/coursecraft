// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';

/**
 * Per-account password-reset throttle (SECURITY_AUDIT.md F-10). Reset requests
 * were limited per IP only, so a victim's mailbox could be flooded from many
 * addresses. These columns cap how often a reset mail is sent to one account.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('users')
    .addColumn('reset_requested_at', 'timestamptz')
    .addColumn('reset_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('reset_count_since', 'timestamptz')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('users')
    .dropColumn('reset_count_since')
    .dropColumn('reset_count')
    .dropColumn('reset_requested_at')
    .execute();
}
